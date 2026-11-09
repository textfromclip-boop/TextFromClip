import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CloudflareBindings, TranscriptRequest } from '../types';
import { validateSafeUrl } from './utils/ssrf';
import { checkRateLimit } from './utils/rate-limiter';
import { ProviderRegistry } from './providers/registry';
import {
  buildUploadR2Key,
  validateUploadChunkPayload,
  transcribeUploadedChunksFromR2,
  isValidR2UploadKey,
  MAX_CHUNK_UPLOAD_BYTES,
  MAX_UPLOAD_CHUNKS,
} from './utils/fileUpload';
import {
  cleanTranscriptForAi,
  cleanTextForTranslation,
  budgetTranscriptForPrompt,
  buildTransformPrompt,
  buildTranslateMessages,
  postProcessTransformOutput,
  postProcessTranslateOutput,
  validateTransformOutput,
  validateTranslateOutput,
  isValidTransformMode,
  executeBoundedAiChat,
  BoundedAiError,
  sanitizePublicErrorMessage,
  MAX_TRANSCRIPT_INPUT_CHARS,
  DEFAULT_PROMPT_BUDGET_CHARS,
  DEFAULT_TRANSLATE_BUDGET_CHARS,
  VALID_TRANSFORM_MODES,
} from './utils/aiTransform';
import { generateVerifiedRevisionPack } from './utils/revisionPackGenerator';
import {
  buildRevisionPackCacheKey,
  consumeQuota,
  getCachedRevisionPack,
  getCachedTranscript,
  getDailyCostReport,
  getDailyQuotaStatus,
  parseCookies,
  PlanTier,
  recordCostTelemetry,
  resolveActorIdentity,
  setCachedRevisionPack,
  setCachedTranscript,
  verifySignedCookieId,
  verifyTurnstileToken,
  withJobConcurrencyLimit,
} from './utils/quotasAndCache';
import {
  completeReferralOnFirstDeck,
  createMagicLinkToken,
  getActiveEntitlementForUser,
  getOrCreateUserByEmail,
  isEligibleForRegionalPricing,
  loadSyncedDecksFromCloud,
  processPaymentWebhook,
  syncUserDecksToCloud,
  verifyMagicLinkToken,
} from './utils/paymentsAndAuth';
import { isValidAnalyticsEvent } from '../utils/analytics';

const PLAN_CATALOG: Record<
  'exam_pass' | 'monthly' | 'semester_pass',
  { name: string; billingType: string; autoRenew: boolean; priceUsd: number; regionalPriceUsd: number }
> = {
  exam_pass: {
    name: 'Exam Pass',
    billingType: '7 days',
    autoRenew: false,
    priceUsd: 2.99,
    regionalPriceUsd: 1.49,
  },
  monthly: {
    name: 'Monthly',
    billingType: 'month',
    autoRenew: true,
    priceUsd: 4.99,
    regionalPriceUsd: 2.49,
  },
  semester_pass: {
    name: 'Semester Pass',
    billingType: '4 months',
    autoRenew: false,
    priceUsd: 14.99,
    regionalPriceUsd: 7.49,
  },
};

async function verifyLemonSqueezySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret?: string
): Promise<boolean> {
  if (!secret) return true;
  if (!signatureHeader) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signatureBytes = new Uint8Array(
      (signatureHeader.match(/.{1,2}/g) || []).map((byte) => parseInt(byte, 16))
    );
    return await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(rawBody));
  } catch {
    return false;
  }
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

async function resolveRequestActor(c: any) {
  const cookieHeader = c.req.header('cookie') || '';
  const ip =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for') ||
    '127.0.0.1';
  const ua = c.req.header('user-agent') || 'browser';
  const secret = c.env.COOKIE_SECRET || 'lfc-default-edge-secret';

  const cookies = parseCookies(cookieHeader);
  const verifiedUserId = verifySignedCookieId(cookies['lfc_uid'], secret);

  const identity = resolveActorIdentity({
    cookieHeader,
    ip,
    userAgent: ua,
    userId: verifiedUserId,
    cookieSecret: secret,
  });

  if (identity.isNewCookie) {
    c.header('Set-Cookie', identity.signedCookieHeader);
  }

  // Check active paid entitlement by userId or cookie guest ID
  const entitlement =
    (verifiedUserId
      ? await getActiveEntitlementForUser(verifiedUserId, c.env.DB)
      : null) ||
    (await getActiveEntitlementForUser(
      `${identity.cookieId}@guest.learnfromclip.com`,
      c.env.DB
    ));

  const isTestWithoutDb =
    !c.env?.DB &&
    (c.env?.ENVIRONMENT === 'test' ||
      Boolean((globalThis as any).process?.env?.NODE_ENV === 'test'));
  const bypassQuotasInDevTests =
    isTestWithoutDb && c.req.header('x-enforce-quota') !== '1';

  const plan: PlanTier = bypassQuotasInDevTests
    ? 'monthly'
    : entitlement
    ? entitlement.planType
    : 'free';
  const quota = await getDailyQuotaStatus({
    actorKey: identity.actorKey,
    networkFallbackKey: identity.networkFallbackKey,
    plan,
    db: c.env.DB,
  });

  return {
    ...identity,
    ip,
    userId: verifiedUserId,
    plan,
    isPaid: plan !== 'free',
    quota,
  };
}

// Security Headers Middleware
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// CORS Middleware
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Accept', 'X-File-Name'],
  maxAge: 86400,
}));

// Rate Limiting Middleware (protects transcript extraction and AI compute endpoints)
const rateLimitMiddleware = async (c: any, next: () => Promise<void>) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const maxReqs = parseInt(c.env.MAX_REQUESTS_PER_MINUTE || '30', 10);
  
  const rateResult = await checkRateLimit(ip, maxReqs, 60, c.env.DB);
  c.header('X-RateLimit-Limit', maxReqs.toString());
  c.header('X-RateLimit-Remaining', rateResult.remaining.toString());
  c.header('X-RateLimit-Reset', rateResult.resetInSeconds.toString());

  if (!rateResult.allowed) {
    c.header('Retry-After', rateResult.resetInSeconds.toString());
    return c.json(
      {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Please slow down and try again in ${rateResult.resetInSeconds} seconds.`,
        },
      },
      429
    );
  }

  await next();
};

app.use('/api/transcript', rateLimitMiddleware);
app.use('/api/transform', rateLimitMiddleware);
app.use('/api/translate', rateLimitMiddleware);
app.use('/api/revision-pack', rateLimitMiddleware);
app.use('/api/upload/*', rateLimitMiddleware);

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'LearnFromClip',
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT || 'development',
    hasD1: Boolean(c.env.DB),
    hasAI: Boolean(c.env.AI),
    hasR2: Boolean(c.env.UPLOADS_BUCKET),
  });
});

// Supported platforms list
app.get('/api/platforms', (c) => {
  const platforms = ProviderRegistry.getPlatformList();
  return c.json({
    success: true,
    data: platforms,
  });
});

// Daily usage & remaining quota endpoint
app.get('/api/usage', async (c) => {
  const actor = await resolveRequestActor(c);
  return c.json({
    success: true,
    data: actor.quota,
  });
});

// Core Transcript generation endpoint
app.post('/api/transcript', async (c) => {
  let body: TranscriptRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Malformed JSON payload in request body.',
        },
      },
      400
    );
  }

  const { url, preferredLanguage = 'en', platform } = body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return c.json(
      {
        success: false,
        error: {
          code: 'MISSING_URL',
          message: 'Please provide a valid video URL.',
        },
      },
      400
    );
  }

  // 1. Validate Safe URL against SSRF and private network attacks
  const ssrfCheck = validateSafeUrl(url.trim());
  if (!ssrfCheck.isValid) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SSRF_BLOCKED',
          message: ssrfCheck.error || 'The requested URL cannot be fetched due to security restrictions.',
        },
      },
      400
    );
  }

  const safeUrl = ssrfCheck.normalizedUrl || url.trim();

  // 2. Identify matching provider adapter
  const detectedProvider = ProviderRegistry.findProvider(safeUrl);

  // 3. Platform enforcement: strictly validate requested platform against detected provider
  if (platform) {
    const validPlatforms = ['youtube', 'tiktok', 'instagram', 'upload'];
    if (!validPlatforms.includes(platform)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_PLATFORM',
            message: `Invalid platform '${platform}'. Supported platforms: ${validPlatforms.join(', ')}.`,
          },
        },
        400
      );
    }

    const platformMatches =
      (platform === 'youtube' && (detectedProvider?.id === 'youtube' || detectedProvider?.id === 'direct_media')) ||
      (platform === 'tiktok' && detectedProvider?.id === 'tiktok') ||
      (platform === 'instagram' && detectedProvider?.id === 'instagram') ||
      (platform === 'upload' && detectedProvider?.id === 'direct_media');

    if (!platformMatches) {
      const detectedName =
        detectedProvider?.id === 'youtube'
          ? 'YouTube'
          : detectedProvider?.id === 'tiktok'
          ? 'TikTok'
          : detectedProvider?.id === 'instagram'
          ? 'Instagram'
          : detectedProvider?.id === 'direct_media'
          ? 'Direct media'
          : 'an unsupported source';

      const requestedName =
        platform === 'youtube'
          ? 'YouTube'
          : platform === 'tiktok'
          ? 'TikTok'
          : platform === 'instagram'
          ? 'Instagram'
          : 'Upload / Direct Media';

      return c.json(
        {
          success: false,
          error: {
            code: 'PLATFORM_MISMATCH',
            message: `That link is from ${detectedName}, but ${requestedName} was selected. Please switch to the ${detectedName} tab or provide a ${requestedName} URL.`,
          },
        },
        400
      );
    }
  }

  if (!detectedProvider) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message:
            'Unsupported platform. LearnFromClip currently supports YouTube (all public videos & Shorts), TikTok, Instagram Reels, and direct audio/video links (.mp4, .mp3, .webm).',
        },
      },
      400
    );
  }

  const provider = detectedProvider;
  const actor = await resolveRequestActor(c);

  // Check Turnstile if configured
  const turnstileToken =
    (body as any)?.turnstileToken || c.req.header('x-turnstile-token');
  const turnstileOk = await verifyTurnstileToken(
    turnstileToken,
    c.env.TURNSTILE_SECRET_KEY,
    actor.ip
  );
  if (!turnstileOk) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TURNSTILE_FAILED',
          message: 'Security verification failed. Please refresh and try again.',
        },
      },
      403
    );
  }

  // Check server-side transcript cache first (cached lectures are instant & do NOT count against link limits!)
  const extractedVideoId =
    typeof (provider as any).extractVideoId === 'function'
      ? (provider as any).extractVideoId(safeUrl)
      : safeUrl;
  if (extractedVideoId) {
    const cachedTx = await getCachedTranscript(
      provider.id,
      extractedVideoId,
      preferredLanguage,
      c.env.DB
    );
    if (cachedTx) {
      return c.json({
        success: true,
        data: cachedTx,
      });
    }
  }

  // Enforce daily link limit on cache miss
  if (actor.quota.linksUsed >= actor.quota.linksLimit) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DAILY_LINK_LIMIT_REACHED',
          message: `You have used all ${actor.quota.linksLimit} free links for today. Upgrade to an Exam Pass ($2.99) or Semester Pass for 50 links per day.`,
        },
      },
      429
    );
  }

  const startTime = Date.now();

  try {
    // 3. Process video transcript via provider
    const result = await provider.getTranscript(safeUrl, preferredLanguage, c.env);

    // Enforce maximum lecture length (Free: 2 hours, Paid: 4 hours)
    if (
      result.videoDurationSeconds &&
      result.videoDurationSeconds > actor.quota.maxLectureSeconds
    ) {
      const maxHrs = actor.isPaid ? 4 : 2;
      return c.json(
        {
          success: false,
          error: {
            code: 'LECTURE_TOO_LONG',
            message: `This lecture exceeds the ${maxHrs}-hour maximum length on your current plan.`,
          },
        },
        413
      );
    }

    // Consume 1 link quota and cache transcript for subsequent students
    await consumeQuota({
      actorKey: actor.actorKey,
      networkFallbackKey: actor.isPaid ? undefined : actor.networkFallbackKey,
      links: 1,
      db: c.env.DB,
    });
    await setCachedTranscript(result, c.env.DB);

    // 4. Store minimal ephemeral metadata in Cloudflare D1 if configured
    if (c.env.DB) {
      const nowSec = Math.floor(startTime / 1000);
      const expiresSec = nowSec + (parseInt(c.env.CACHE_TTL_SECONDS || '86400', 10)); // 24hr expiration

      try {
        await c.env.DB.prepare(`
          INSERT INTO jobs (id, provider, video_id, video_title, video_duration_seconds, source_type, status, language, segment_count, created_at, expires_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'completed', ?7, ?8, ?9, ?10)
        `).bind(
          result.id,
          result.provider,
          result.videoId,
          result.videoTitle || 'Untitled',
          result.videoDurationSeconds || 0,
          result.sourceType,
          result.language,
          result.segments.length,
          nowSec,
          expiresSec
        ).run();

        // Record aggregate usage event
        await c.env.DB.prepare(`
          INSERT INTO usage_events (event_type, provider, source_type, status_code, created_at)
          VALUES ('request_success', ?1, ?2, 200, ?3)
        `).bind(result.provider, result.sourceType, nowSec).run();
      } catch (dbErr) {
        console.warn('D1 metadata recording error (non-fatal):', dbErr);
      }
    }

    return c.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    const errorMsg = err?.message || 'An unexpected error occurred while processing the video transcript.';
    
    // Log failure event to D1 if available
    if (c.env.DB) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO usage_events (event_type, provider, source_type, status_code, created_at)
          VALUES ('request_error', ?1, 'unknown', 500, ?2)
        `).bind(provider.id, Math.floor(Date.now() / 1000)).run();
      } catch (dbErr) {
        // ignore
      }
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: errorMsg,
        },
      },
      422
    );
  }
});

// R2 File Upload: Store temporary audio/video chunk in the UPLOADS_BUCKET R2 binding
app.post('/api/upload/chunk', async (c) => {
  if (!c.env.UPLOADS_BUCKET) {
    return c.json(
      {
        success: false,
        error: {
          code: 'R2_UNAVAILABLE',
          message: 'File uploads are temporarily unavailable. Please try again shortly.',
        },
      },
      503
    );
  }

  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_CHUNK_UPLOAD_BYTES + 65536) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `Upload chunk exceeds the ${Math.round(MAX_CHUNK_UPLOAD_BYTES / (1024 * 1024))} MB per-chunk limit.`,
          },
        },
        413
      );
    }
  }

  const contentType = (c.req.header('content-type') || '').toLowerCase();
  let fileName = c.req.query('fileName') || c.req.header('x-file-name') || 'chunk.wav';
  let buffer: ArrayBuffer;
  let storedMimeType = 'audio/wav';

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const fileEntry = formData.get('file');
      if (!fileEntry || typeof fileEntry === 'string' || typeof (fileEntry as any).arrayBuffer !== 'function') {
        return c.json(
          {
            success: false,
            error: {
              code: 'MISSING_FILE',
              message: 'Please attach an audio or video file under the "file" field.',
            },
          },
          400
        );
      }
      const fileBlob = fileEntry as File;
      if (fileBlob.name) {
        fileName = fileBlob.name;
      }
      if (fileBlob.type) {
        storedMimeType = fileBlob.type;
      }
      buffer = await fileBlob.arrayBuffer();
    } else {
      if (contentType && contentType !== 'application/octet-stream') {
        storedMimeType = contentType.split(';')[0].trim() || 'audio/wav';
      }
      buffer = await c.req.arrayBuffer();
    }
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_UPLOAD_BODY',
          message: 'Could not read uploaded file bytes.',
        },
      },
      400
    );
  }

  const validation = validateUploadChunkPayload(buffer.byteLength, fileName);
  if (!validation.valid) {
    return c.json(
      {
        success: false,
        error: {
          code: validation.code || 'INVALID_FILE',
          message: validation.message || 'Invalid uploaded file chunk.',
        },
      },
      validation.code === 'FILE_TOO_LARGE' ? 413 : 400
    );
  }

  const key = buildUploadR2Key(fileName);

  try {
    await c.env.UPLOADS_BUCKET.put(key, buffer, {
      httpMetadata: {
        contentType: storedMimeType,
      },
      customMetadata: {
        originalFileName: fileName.slice(0, 120),
        uploadedAt: new Date().toISOString(),
      },
    });

    return c.json({
      success: true,
      data: {
        key,
        sizeBytes: buffer.byteLength,
      },
    });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: {
          code: 'R2_PUT_FAILED',
          message: sanitizePublicErrorMessage(
            err?.message,
            'Could not upload your file right now. Please try again.'
          ),
        },
      },
      500
    );
  }
});

// R2 File Upload: Transcribe uploaded R2 chunk(s) with Workers AI Whisper & immediately delete from R2
app.post('/api/upload/transcribe', async (c) => {
  if (!c.env.UPLOADS_BUCKET) {
    return c.json(
      {
        success: false,
        error: {
          code: 'R2_UNAVAILABLE',
          message: 'File uploads are temporarily unavailable. Please try again shortly.',
        },
      },
      503
    );
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Malformed JSON payload in request body.',
        },
      },
      400
    );
  }

  const rawKeys = Array.isArray(body?.keys)
    ? body.keys
    : typeof body?.key === 'string'
    ? [body.key]
    : [];

  if (rawKeys.length === 0 || rawKeys.length > MAX_UPLOAD_CHUNKS) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_KEYS',
          message: `Please provide between 1 and ${MAX_UPLOAD_CHUNKS} uploaded R2 chunk keys.`,
        },
      },
      400
    );
  }

  for (const k of rawKeys) {
    if (!isValidR2UploadKey(k)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_R2_KEY',
            message: 'Invalid R2 object key provided.',
          },
        },
        400
      );
    }
  }

  if (!c.env.AI) {
    await Promise.allSettled(rawKeys.map((k: string) => c.env.UPLOADS_BUCKET!.delete(k)));
    return c.json(
      {
        success: false,
        error: {
          code: 'AI_UNAVAILABLE',
          message: 'Audio transcription is temporarily unavailable. Please try again shortly.',
        },
      },
      503
    );
  }

  const chunkOffsetsSec = Array.isArray(body?.chunkOffsetsSec)
    ? body.chunkOffsetsSec.map((n: any) => (typeof n === 'number' && Number.isFinite(n) ? n : 0))
    : [];
  const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : 'Uploaded Media';
  const videoDurationSeconds =
    typeof body?.videoDurationSeconds === 'number' && Number.isFinite(body.videoDurationSeconds)
      ? body.videoDurationSeconds
      : undefined;
  const preferredLanguage =
    typeof body?.preferredLanguage === 'string' && body.preferredLanguage.trim()
      ? body.preferredLanguage.trim()
      : 'en';

  const actor = await resolveRequestActor(c);
  const estimatedDurationSec =
    videoDurationSeconds && videoDurationSeconds > 0
      ? videoDurationSeconds
      : rawKeys.length * 60;

  if (estimatedDurationSec > actor.quota.maxLectureSeconds) {
    await Promise.allSettled(rawKeys.map((k: string) => c.env.UPLOADS_BUCKET!.delete(k)));
    const maxHrs = actor.isPaid ? 4 : 2;
    return c.json(
      {
        success: false,
        error: {
          code: 'LECTURE_TOO_LONG',
          message: `This recording is longer than the ${maxHrs}-hour maximum on your current plan.`,
        },
      },
      413
    );
  }

  if (
    actor.quota.uploadSecondsUsed + estimatedDurationSec >
    actor.quota.uploadSecondsLimit
  ) {
    await Promise.allSettled(rawKeys.map((k: string) => c.env.UPLOADS_BUCKET!.delete(k)));
    const remMins = Math.max(
      0,
      Math.floor((actor.quota.uploadSecondsLimit - actor.quota.uploadSecondsUsed) / 60)
    );
    return c.json(
      {
        success: false,
        error: {
          code: 'UPLOAD_DURATION_LIMIT_REACHED',
          message: `Free upload limit is 20 minutes of audio per day (${remMins} min remaining today). Upgrade to an Exam Pass or Semester Pass for up to 30 hours.`,
        },
      },
      429
    );
  }

  const startTime = Date.now();

  try {
    const result = await withJobConcurrencyLimit(() =>
      transcribeUploadedChunksFromR2({
        bucket: c.env.UPLOADS_BUCKET!,
        ai: c.env.AI,
        keys: rawKeys,
        chunkOffsetsSec,
        fileName,
        videoDurationSeconds,
        preferredLanguage,
      })
    );

    const actualDurationSec = result.videoDurationSeconds || estimatedDurationSec;
    await consumeQuota({
      actorKey: actor.actorKey,
      networkFallbackKey: actor.isPaid ? undefined : actor.networkFallbackKey,
      uploadSeconds: actualDurationSec,
      db: c.env.DB,
    });
    await recordCostTelemetry({ whisperAudioSeconds: actualDurationSec }, c.env.DB);

    if (c.env.DB) {
      const nowSec = Math.floor(startTime / 1000);
      const expiresSec = nowSec + parseInt(c.env.CACHE_TTL_SECONDS || '86400', 10);

      try {
        await c.env.DB.prepare(`
          INSERT INTO jobs (id, provider, video_id, video_title, video_duration_seconds, source_type, status, language, segment_count, created_at, expires_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'completed', ?7, ?8, ?9, ?10)
        `)
          .bind(
            result.id,
            result.provider,
            result.videoId,
            result.videoTitle || 'Uploaded Media',
            result.videoDurationSeconds || 0,
            result.sourceType,
            result.language,
            result.segments.length,
            nowSec,
            expiresSec
          )
          .run();

        await c.env.DB.prepare(`
          INSERT INTO usage_events (event_type, provider, source_type, status_code, created_at)
          VALUES ('request_success', ?1, ?2, 200, ?3)
        `)
          .bind(result.provider, result.sourceType, nowSec)
          .run();
      } catch (dbErr) {
        console.warn('D1 metadata recording error (non-fatal):', dbErr);
      }
    }

    return c.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    const errorMsg =
      err?.message || 'An unexpected error occurred while transcribing the uploaded file.';

    if (c.env.DB) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO usage_events (event_type, provider, source_type, status_code, created_at)
          VALUES ('request_error', 'file_upload', 'ai_whisper', 422, ?1)
        `)
          .bind(Math.floor(Date.now() / 1000))
          .run();
      } catch {
        // ignore
      }
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'UPLOAD_TRANSCRIPTION_FAILED',
          message: errorMsg,
        },
      },
      422
    );
  }
});

// AI Transform endpoint (Summary, Viral Script, Blog Post, Thread, Study Notes) — 0 SnapAny credits
app.post('/api/transform', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: { code: 'INVALID_JSON', message: 'Malformed JSON payload in request body.' } },
      400
    );
  }

  const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
  const rawSegments = Array.isArray(body?.segments) ? body.segments : undefined;
  const rawMode = body?.mode === undefined ? 'summary' : body.mode;
  const videoTitle = typeof body?.videoTitle === 'string' ? body.videoTitle.trim().slice(0, 300) : 'Video';

  if (!isValidTransformMode(rawMode)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_MODE',
          message: `Unsupported transformation mode. Valid modes: ${VALID_TRANSFORM_MODES.join(', ')}.`,
        },
      },
      400
    );
  }

  if (!rawText && (!rawSegments || rawSegments.length === 0)) {
    return c.json(
      { success: false, error: { code: 'EMPTY_TEXT', message: 'Transcript text is required.' } },
      400
    );
  }

  if (
    rawText.length > MAX_TRANSCRIPT_INPUT_CHARS ||
    (rawSegments && rawSegments.length > 10_000)
  ) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Transcript exceeds the maximum supported size (${MAX_TRANSCRIPT_INPUT_CHARS.toLocaleString()} characters).`,
        },
      },
      413
    );
  }

  const { cleanedText, timelineText, wordCount } = cleanTranscriptForAi(rawText, rawSegments);
  if (!cleanedText || wordCount === 0) {
    return c.json(
      { success: false, error: { code: 'EMPTY_TEXT', message: 'Transcript contains no spoken words.' } },
      400
    );
  }

  const actor = await resolveRequestActor(c);
  if (actor.quota.aiActionsUsed + 1 > actor.quota.aiActionsLimit) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AI_LIMIT_REACHED',
          message: `You have used all ${actor.quota.aiActionsLimit} free AI actions for today. Upgrade for 100 AI actions per day.`,
        },
      },
      429
    );
  }

  // Use timeline-anchored text when timestamps are relevant (summary, notes); plain cleaned text otherwise
  const sourceForPrompt =
    rawMode === 'summary' || rawMode === 'notes' ? timelineText : cleanedText;
  const budgeted = budgetTranscriptForPrompt(sourceForPrompt, DEFAULT_PROMPT_BUDGET_CHARS);
  const spec = buildTransformPrompt(
    rawMode,
    videoTitle,
    budgeted.text,
    wordCount,
    budgeted.truncated
  );

  // Local development fallback ONLY when Cloudflare Workers AI binding is absent
  if (!c.env.AI) {
    const sentences = budgeted.text
      .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/g, '')
      .split(/(?<=[.?!])\s+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 20);
    const topSentences = sentences.slice(0, 5).map((s: string) => `• ${s}`).join('\n');
    const localDraft = postProcessTransformOutput(
      `${videoTitle}\n\nKey Takeaways\n${topSentences || `• ${cleanedText.slice(0, 400)}`}`,
      spec.mode,
      cleanedText,
      { truncated: budgeted.truncated, wordCount }
    );
    await consumeQuota({
      actorKey: actor.actorKey,
      networkFallbackKey: actor.isPaid ? undefined : actor.networkFallbackKey,
      aiHalfUnits: 2,
      db: c.env.DB,
    });
    return c.json({
      success: true,
      data: {
        result: localDraft,
        mode: spec.mode,
        model: 'local_extractive_fallback',
        truncated: budgeted.truncated,
      },
    });
  }

  try {
    const { text: verifiedOutput, modelUsed, attempts } = await executeBoundedAiChat({
      ai: c.env.AI,
      messages: spec.messages,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      maxTotalCalls: 3,
      processAndValidate: (draft) => {
        const processed = postProcessTransformOutput(draft, spec.mode, cleanedText, {
          truncated: budgeted.truncated,
          wordCount,
        });
        const validation = validateTransformOutput(processed, spec.mode, wordCount);
        return { processed, validation };
      },
    });

    await consumeQuota({
      actorKey: actor.actorKey,
      networkFallbackKey: actor.isPaid ? undefined : actor.networkFallbackKey,
      aiHalfUnits: 2,
      db: c.env.DB,
    });
    await recordCostTelemetry(
      {
        llmInputTokens: Math.ceil(budgeted.text.length / 4),
        llmOutputTokens: Math.ceil(verifiedOutput.length / 4),
      },
      c.env.DB
    );

    return c.json({
      success: true,
      data: {
        result: verifiedOutput,
        mode: spec.mode,
        model: modelUsed,
        truncated: budgeted.truncated,
        attempts,
      },
    });
  } catch (err: unknown) {
    if (err instanceof BoundedAiError) {
      return c.json(
        {
          success: false,
          error: {
            code: err.classified.code,
            message: err.classified.publicMessage,
          },
        },
        err.classified.httpStatus
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'TRANSFORM_FAILED',
          message: sanitizePublicErrorMessage(
            (err as any)?.message,
            'Could not transform transcript right now.'
          ),
        },
      },
      500
    );
  }
});

// AI Translate endpoint — 0 SnapAny credits
app.post('/api/translate', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: { code: 'INVALID_JSON', message: 'Malformed JSON payload in request body.' } },
      400
    );
  }

  const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
  const targetLanguage = typeof body?.targetLanguage === 'string' ? body.targetLanguage.trim() : '';

  if (!rawText || !targetLanguage) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Transcript text and target language are required.' },
      },
      400
    );
  }

  if (!/^[\p{L}\s()-]{2,45}$/u.test(targetLanguage)) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_LANGUAGE', message: 'Invalid target language specified.' },
      },
      400
    );
  }

  if (rawText.length > MAX_TRANSCRIPT_INPUT_CHARS) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Transcript exceeds the maximum supported size (${MAX_TRANSCRIPT_INPUT_CHARS.toLocaleString()} characters).`,
        },
      },
      413
    );
  }

  const { cleanedText, hasMeaningfulContent } = cleanTextForTranslation(rawText);
  if (!cleanedText || !hasMeaningfulContent) {
    return c.json(
      {
        success: false,
        error: { code: 'EMPTY_TEXT', message: 'Transcript contains no spoken words.' },
      },
      400
    );
  }

  if (!c.env.AI) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AI_UNAVAILABLE',
          message: 'Translation requires Cloudflare Workers AI in production.',
        },
      },
      503
    );
  }

  const actor = await resolveRequestActor(c);
  if (actor.quota.aiActionsUsed + 1 > actor.quota.aiActionsLimit) {
    return c.json(
      {
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: `You have used all ${actor.quota.aiActionsLimit} AI actions for today. Upgrade for up to 100 AI actions per day.`,
        },
        usage: actor.quota,
      },
      429
    );
  }

  const isTruncated = cleanedText.length > DEFAULT_TRANSLATE_BUDGET_CHARS;
  let clipped = cleanedText;
  if (isTruncated) {
    const cut = cleanedText.slice(0, DEFAULT_TRANSLATE_BUDGET_CHARS);
    const lastNewline = cut.lastIndexOf('\n');
    const lastSpace = cut.lastIndexOf(' ');
    if (lastNewline > DEFAULT_TRANSLATE_BUDGET_CHARS - 350) {
      clipped = cut.slice(0, lastNewline).trim();
    } else if (lastSpace > DEFAULT_TRANSLATE_BUDGET_CHARS - 80) {
      clipped = cut.slice(0, lastSpace).trim();
    } else {
      clipped = cut.trim();
    }
    // Close any trailing unclosed Markdown code fence caused by length truncation
    const fenceMarkers = clipped.match(/```/g) ?? [];
    if (fenceMarkers.length % 2 === 1) {
      clipped = `${clipped}\n\`\`\``;
    }
  }

  const translateMaxTokens = Math.min(3072, Math.max(768, Math.ceil(clipped.length / 2.2)));

  try {
    const { text: translated, modelUsed, attempts } = await executeBoundedAiChat({
      ai: c.env.AI,
      messages: buildTranslateMessages(clipped, targetLanguage),
      maxTokens: translateMaxTokens,
      temperature: 0.15,
      maxTotalCalls: 3,
      processAndValidate: (draft) => {
        const processed = postProcessTranslateOutput(draft, clipped);
        const validation = validateTranslateOutput(processed, clipped);
        return { processed, validation };
      },
    });

    await consumeQuota({
      actorKey: actor.actorKey,
      networkFallbackKey: actor.isPaid ? undefined : actor.networkFallbackKey,
      aiHalfUnits: 2,
      db: c.env.DB,
    });
    await recordCostTelemetry(
      {
        llmInputTokens: Math.ceil(clipped.length / 4),
        llmOutputTokens: Math.ceil(translated.length / 4),
      },
      c.env.DB
    );

    const finalTranslated = isTruncated
      ? `${translated}\n\n[Note: Transcript exceeded maximum single-pass translation length (${DEFAULT_TRANSLATE_BUDGET_CHARS.toLocaleString()} characters); remaining text was omitted.]`
      : translated;

    return c.json({
      success: true,
      data: {
        translatedText: finalTranslated,
        targetLanguage,
        model: modelUsed,
        truncated: isTruncated,
        attempts,
      },
    });
  } catch (err: unknown) {
    if (err instanceof BoundedAiError) {
      return c.json(
        {
          success: false,
          error: {
            code: err.classified.code,
            message: err.classified.publicMessage,
          },
        },
        err.classified.httpStatus
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'TRANSLATE_FAILED',
          message: sanitizePublicErrorMessage(
            (err as any)?.message,
            'Could not translate transcript right now.'
          ),
        },
      },
      500
    );
  }
});

// Revision Pack generation endpoint (Structured Notes + Flashcards + 10-Q Quiz with verbatim quote verification)
app.post('/api/revision-pack', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Malformed JSON payload in request body.',
        },
      },
      400
    );
  }

  const segments = Array.isArray(body?.segments) ? body.segments : [];
  if (segments.length === 0) {
    return c.json(
      {
        success: false,
        error: {
          code: 'EMPTY_SEGMENTS',
          message: 'Transcript segments are required to generate a revision pack.',
        },
      },
      400
    );
  }

  const actor = await resolveRequestActor(c);
  const secondLanguage =
    typeof body.secondLanguage === 'string' && body.secondLanguage.trim()
      ? body.secondLanguage.trim()
      : undefined;
  const isPaid = Boolean(actor.isPaid || body.isPaid);
  const maxCards = isPaid ? 150 : 30;
  const transcriptTextForHash = segments.map((s: any) => `${s.start}|${s.text}`).join('\n');
  const { packCacheKey, transcriptHash } = buildRevisionPackCacheKey(
    segments,
    secondLanguage,
    maxCards
  );

  // Check revision pack cache first (cached pack costs 0.5 AI action)
  const cachedPack = await getCachedRevisionPack(packCacheKey, c.env.DB);
  if (cachedPack) {
    if (actor.quota.aiActionsUsed + 0.5 > actor.quota.aiActionsLimit) {
      return c.json(
        {
          success: false,
          error: {
            code: 'QUOTA_EXCEEDED',
            message: `You have used all ${actor.quota.aiActionsLimit} AI actions for today. Upgrade for up to 100 AI actions per day.`,
          },
          usage: actor.quota,
        },
        429
      );
    }

    await consumeQuota({
      actorKey: actor.actorKey,
      networkFallbackKey: actor.isPaid ? undefined : actor.networkFallbackKey,
      aiHalfUnits: 1, // 0.5 AI action on cache hit
      db: c.env.DB,
    });

    return c.json({
      success: true,
      data: cachedPack,
      cached: true,
    });
  }

  // Cache miss: requires 1 full AI action and 1 mock exam quota (for free tier)
  if (actor.quota.aiActionsUsed + 1 > actor.quota.aiActionsLimit) {
    return c.json(
      {
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: `You have used all ${actor.quota.aiActionsLimit} AI actions for today. Upgrade for up to 100 AI actions per day.`,
        },
        usage: actor.quota,
      },
      429
    );
  }

  if (!isPaid && actor.quota.mockExamsUsed >= actor.quota.mockExamsLimit) {
    return c.json(
      {
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: `Free plan includes ${actor.quota.mockExamsLimit} mock exam pack per day. Upgrade for unlimited mock exams.`,
        },
        usage: actor.quota,
      },
      429
    );
  }

  try {
    const pack = await withJobConcurrencyLimit(async () =>
      generateVerifiedRevisionPack(
        {
          videoId: typeof body.videoId === 'string' ? body.videoId : 'lecture',
          provider: typeof body.provider === 'string' ? body.provider : 'youtube',
          videoTitle: typeof body.videoTitle === 'string' ? body.videoTitle : 'Lecture',
          durationSeconds:
            typeof body.durationSeconds === 'number' ? body.durationSeconds : undefined,
          segments,
          secondLanguage,
          maxCards,
          isPaid,
        },
        c.env.AI
      )
    );

    await setCachedRevisionPack(packCacheKey, transcriptHash, pack, c.env.DB);
    await consumeQuota({
      actorKey: actor.actorKey,
      networkFallbackKey: actor.isPaid ? undefined : actor.networkFallbackKey,
      aiHalfUnits: 2,
      mockExams: 1,
      db: c.env.DB,
    });
    await recordCostTelemetry(
      {
        llmInputTokens: Math.ceil(transcriptTextForHash.length / 4),
        llmOutputTokens: 1600,
      },
      c.env.DB
    );

    return c.json({
      success: true,
      data: pack,
      cached: false,
    });
  } catch (err: any) {
    const msg = err?.message || 'Could not generate revision pack right now.';
    const isTooLong = /maximum supported/i.test(msg);
    const isQueueBusy = err?.code === 'QUEUE_BUSY';
    return c.json(
      {
        success: false,
        error: {
          code: isTooLong ? 'LECTURE_TOO_LONG' : isQueueBusy ? 'QUEUE_BUSY' : 'REVISION_PACK_FAILED',
          message: sanitizePublicErrorMessage(msg, 'Could not generate revision pack right now.'),
        },
      },
      isTooLong ? 413 : isQueueBusy ? 429 : 422
    );
  }
});

// Auth: Passwordless Email Magic Link ("Save my streak" / Paid login)
app.post('/api/auth/magic-link', async (c) => {
  try {
    const body = await c.req.json();
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const link = await createMagicLinkToken(email, c.env.DB);
    return c.json({
      success: true,
      data: {
        sent: true,
        email: link.user.email,
        expiresAt: link.expiresAt,
        // Returned in non-SMTP dev/test environments so magic link verification works end-to-end
        verifyUrl: `/api/auth/verify?token=${encodeURIComponent(link.token)}`,
      },
    });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_EMAIL',
          message: err?.message || 'Please enter a valid email address.',
        },
      },
      400
    );
  }
});

app.get('/api/auth/verify', async (c) => {
  const token = c.req.query('token') || '';
  const verified = await verifyMagicLinkToken(
    token,
    c.env.COOKIE_SECRET || 'lfc-default-edge-secret',
    c.env.DB
  );
  if (!verified) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_OR_EXPIRED_TOKEN',
          message: 'This login link has expired or was already used.',
        },
      },
      400
    );
  }

  c.header('Set-Cookie', verified.signedUserCookie);

  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/html')) {
    return c.redirect('/study?synced=1', 302);
  }
  return c.json({
    success: true,
    data: {
      userId: verified.user.id,
      email: verified.user.email,
      referralCode: verified.user.referralCode,
    },
  });
});

// Cloud Deck Sync for authenticated / paid users
app.get('/api/decks/sync', async (c) => {
  const actor = await resolveRequestActor(c);
  if (!actor.userId) {
    return c.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Sign in with a magic link to sync decks.' },
      },
      401
    );
  }
  const decks = await loadSyncedDecksFromCloud(actor.userId, c.env.DB);
  return c.json({ success: true, data: { decks } });
});

app.post('/api/decks/sync', async (c) => {
  const actor = await resolveRequestActor(c);
  if (!actor.userId) {
    return c.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Sign in with a magic link to sync decks.' },
      },
      401
    );
  }
  const body = await c.req.json().catch(() => ({}));
  const incoming = Array.isArray(body?.decks) ? body.decks : body?.deck ? [body.deck] : [];
  const decksToSync = incoming.map((d: any) => ({
    id: String(d.id || `deck_${Date.now()}`),
    title: String(d.title || 'Revision Pack'),
    packJson: typeof d.packJson === 'string' ? d.packJson : JSON.stringify(d),
    updatedAt: Number(d.updatedAt) || Date.now(),
  }));
  await syncUserDecksToCloud(actor.userId, decksToSync, c.env.DB);
  const allDecks = await loadSyncedDecksFromCloud(actor.userId, c.env.DB);
  return c.json({ success: true, data: { syncedCount: decksToSync.length, decks: allDecks } });
});

// Checkout Session Generator (Lemon Squeezy Merchant of Record)
app.post('/api/checkout', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const plan = body?.plan as PlanTier;
  if (!['exam_pass', 'monthly', 'semester_pass'].includes(plan)) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_PLAN', message: 'Invalid plan selected.' },
      },
      400
    );
  }

  const billingCountry =
    typeof body?.billingCountry === 'string' && body.billingCountry.trim()
      ? body.billingCountry.trim().toUpperCase()
      : (c.req.header('CF-IPCountry') || 'US').toUpperCase();
  const regional = isEligibleForRegionalPricing(billingCountry);
  const pricing = PLAN_CATALOG[plan as 'exam_pass' | 'monthly' | 'semester_pass'];
  const priceUsd = regional ? pricing.regionalPriceUsd : pricing.priceUsd;

  return c.json({
    success: true,
    data: {
      plan,
      name: pricing.name,
      billingType: pricing.billingType,
      autoRenew: pricing.autoRenew,
      billingCountry,
      regionalPricingApplied: regional,
      priceUsd,
      checkoutUrl: `https://checkout.learnfromclip.com/buy/${plan}?country=${encodeURIComponent(billingCountry)}&regional=${regional ? '1' : '0'}`,
    },
  });
});

// Lemon Squeezy Webhook (purchase, renewal, cancellation, refund)
app.post('/api/webhooks/lemonsqueezy', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Signature') || null;
  const validSig = await verifyLemonSqueezySignature(
    rawBody,
    signature,
    c.env.LEMONSQUEEZY_WEBHOOK_SECRET
  );
  if (!validSig) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature.' },
      },
      401
    );
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_JSON', message: 'Malformed webhook JSON.' },
      },
      400
    );
  }

  const result = await processPaymentWebhook(payload, c.env.DB);
  return c.json({
    success: true,
    data: result,
  });
});

// Referral Program: "Invite a friend" -> 3-day Exam Pass for both on friend's first deck (max 5 rewards)
app.post('/api/referral/code', async (c) => {
  const actor = await resolveRequestActor(c);
  const user = actor.userId
    ? await getOrCreateUserByEmail(actor.userId, c.env.DB)
    : await getOrCreateUserByEmail(`${actor.cookieId}@guest.learnfromclip.com`, c.env.DB);
  return c.json({
    success: true,
    data: {
      code: user.referralCode,
      shareUrl: `https://learnfromclip.com/?ref=${encodeURIComponent(user.referralCode)}`,
    },
  });
});

app.post('/api/referral/complete', async (c) => {
  const actor = await resolveRequestActor(c);
  const body = await c.req.json().catch(() => ({}));
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return c.json(
      {
        success: false,
        error: { code: 'MISSING_CODE', message: 'Referral code is required.' },
      },
      400
    );
  }

  const result = await completeReferralOnFirstDeck({
    referralCode: code,
    inviteeEmail: typeof body?.email === 'string' ? body.email : undefined,
    inviteeActorKey: actor.actorKey,
    inviteeCookieId: actor.cookieId,
    inviteeIp: actor.ip,
    referrerCookieId: typeof body?.referrerCookieId === 'string' ? body.referrerCookieId : undefined,
    referrerIp: typeof body?.referrerIp === 'string' ? body.referrerIp : undefined,
    db: c.env.DB,
  });

  return c.json({
    success: result.rewarded,
    data: result,
  });
});

// Admin Cost & Cache Telemetry View
app.get('/api/admin/costs', async (c) => {
  const summary = await getDailyCostReport(undefined, c.env.DB);
  return c.json({
    success: true,
    data: summary,
  });
});

// Privacy-friendly product analytics
app.post('/api/events', async (c) => {
  const actor = await resolveRequestActor(c);
  const body = await c.req.json().catch(() => ({}));
  const eventName = typeof body?.event === 'string' ? body.event.trim() : '';
  if (!eventName || !isValidAnalyticsEvent(eventName)) {
    return c.json(
      { success: false, error: { code: 'INVALID_EVENT', message: 'Invalid event name.' } },
      400
    );
  }
  if (c.env.DB) {
    try {
      await c.env.DB
        .prepare(
          `INSERT INTO analytics_events (event_name, route_path, plan_type, created_at)
           VALUES (?1, ?2, ?3, ?4)`
        )
        .bind(
          eventName,
          typeof body?.path === 'string' ? body.path : '/',
          actor.plan,
          Math.floor(Date.now() / 1000)
        )
        .run();
    } catch {
      // ignore
    }
  }
  return c.json({ success: true });
});

// SEO: robots.txt
app.get('/robots.txt', (c) => {
  return c.text(
`User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://learnfromclip.com/sitemap.xml
`
  );
});

// SEO: sitemap.xml
app.get('/sitemap.xml', (c) => {
  c.header('Content-Type', 'application/xml');
  const paths = [
    { path: '/', priority: '1.0', changefreq: 'weekly' },
    { path: '/app', priority: '0.9', changefreq: 'weekly' },
    { path: '/study', priority: '0.9', changefreq: 'weekly' },
    { path: '/pricing', priority: '0.8', changefreq: 'weekly' },
    { path: '/youtube-lecture-to-flashcards', priority: '0.9', changefreq: 'weekly' },
    { path: '/lecture-to-notes', priority: '0.9', changefreq: 'weekly' },
    { path: '/video-to-quiz', priority: '0.9', changefreq: 'weekly' },
    { path: '/youtube-to-text', priority: '0.9', changefreq: 'weekly' },
    { path: '/youtube-transcript-to-pdf', priority: '0.8', changefreq: 'weekly' },
    { path: '/flashcards-in-arabic', priority: '0.8', changefreq: 'weekly' },
    { path: '/flashcards-in-spanish', priority: '0.8', changefreq: 'weekly' },
    { path: '/flashcards-in-french', priority: '0.8', changefreq: 'weekly' },
    { path: '/flashcards-in-german', priority: '0.8', changefreq: 'weekly' },
    { path: '/flashcards-in-turkish', priority: '0.8', changefreq: 'weekly' },
    { path: '/flashcards-in-portuguese', priority: '0.8', changefreq: 'weekly' },
    { path: '/flashcards-in-hindi', priority: '0.8', changefreq: 'weekly' },
    { path: '/youtube', priority: '0.8', changefreq: 'weekly' },
    { path: '/tiktok', priority: '0.5', changefreq: 'monthly' },
    { path: '/instagram', priority: '0.5', changefreq: 'monthly' },
    { path: '/upload', priority: '0.8', changefreq: 'weekly' },
    { path: '/guide', priority: '0.7', changefreq: 'monthly' },
    { path: '/about', priority: '0.4', changefreq: 'monthly' },
    { path: '/privacy', priority: '0.3', changefreq: 'monthly' },
    { path: '/terms', priority: '0.3', changefreq: 'monthly' },
  ];

  const urlsXml = paths
    .map(
      (item) => `  <url>
    <loc>https://learnfromclip.com${item.path}</loc>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
    )
    .join('\n');

  return c.text(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}
</urlset>`
  );
});

// SPA fallback: page routes (/youtube, /guide, ...) are handled client-side,
// so a hard refresh or shared link must receive index.html instead of a 404.
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/') || !c.env.ASSETS) {
    return c.text('Not found', 404);
  }
  const indexUrl = new URL('/', c.req.url);
  return c.env.ASSETS.fetch(new Request(indexUrl.toString(), c.req.raw));
});

export default app;

