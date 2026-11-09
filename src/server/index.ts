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
  cookieAttributes,
  DEV_ONLY_COOKIE_SECRET,
  getCachedRevisionPack,
  getCachedTranscript,
  getDailyCostReport,
  getDailyQuotaStatus,
  parseCookies,
  PlanTier,
  consumeQuota,
  QueueBusyError,
  QuotaDelta,
  recordCostTelemetry,
  reserveQuota,
  resolveActorIdentity,
  resolveIpCeiling,
  setCachedRevisionPack,
  setCachedTranscript,
  signCookieValue,
  verifySignedCookieValue,
  verifyTurnstileToken,
  withJobConcurrencyLimit,
} from './utils/quotasAndCache';
import {
  completeReferralOnFirstDeck,
  countSyncedDecks,
  createLemonSqueezyCheckout,
  createMagicLinkToken,
  getActiveEntitlementForUser,
  getReferralCodeForIdentity,
  getUserById,
  guestEmailForCookie,
  isEligibleForRegionalPricing,
  isValidEmail,
  loadSyncedDecksFromCloud,
  MAX_SYNCED_DECKS_PER_USER,
  PaidPlan,
  processPaymentWebhook,
  readLemonSqueezyConfig,
  sendMagicLinkEmail,
  syncUserDecksToCloud,
  verifyMagicLinkToken,
} from './utils/paymentsAndAuth';
import { sha256Hex, timingSafeEqual, verifyHmacSha256Hex } from './utils/crypto';
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

const app = new Hono<{ Bindings: CloudflareBindings }>();

class ServerMisconfiguredError extends Error {}

/**
 * Cookie-signing secret. Production MUST set COOKIE_SECRET (>= 32 chars): without it anyone could
 * forge login cookies. Outside production a fixed dev-only secret is used.
 */
function getCookieSecret(c: any): string {
  const secret = c.env?.COOKIE_SECRET;
  if (typeof secret === 'string' && secret.length >= 32) return secret;
  if (isProduction(c)) {
    throw new ServerMisconfiguredError('COOKIE_SECRET is not configured (min 32 chars).');
  }
  return DEV_ONLY_COOKIE_SECRET;
}

function isProduction(c: any): boolean {
  return (c.env?.ENVIRONMENT || '').toLowerCase() === 'production';
}

function isSecureRequest(c: any): boolean {
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

function getClientIp(c: any): string {
  // cf-connecting-ip is set by Cloudflare and cannot be spoofed by the client. x-forwarded-for is
  // only trusted outside production (local dev / tests).
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  if (!isProduction(c)) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
  }
  return '127.0.0.1';
}

function appendSetCookie(c: any, cookie: string) {
  c.header('Set-Cookie', cookie, { append: true });
}

async function resolveRequestActor(c: any) {
  if (c.get && c.get('actor')) return c.get('actor');
  const cookieHeader = c.req.header('cookie') || '';
  const ip = getClientIp(c);
  const ua = c.req.header('user-agent') || 'browser';
  const secret = getCookieSecret(c);
  const secure = isSecureRequest(c);

  const cookies = parseCookies(cookieHeader);
  const verifiedUserId = await verifySignedCookieValue(cookies['lfc_uid'], secret, 'uid');

  const identity = await resolveActorIdentity({
    cookieHeader,
    ip,
    userAgent: ua,
    userId: verifiedUserId,
    cookieSecret: secret,
    secureCookies: secure,
  });

  if (identity.isNewCookie) {
    appendSetCookie(c, identity.signedCookieHeader);
  }

  // Paid entitlement: by logged-in user id, or by the anonymous browser that bought the pass
  const entitlement =
    (verifiedUserId ? await getActiveEntitlementForUser(verifiedUserId, c.env.DB) : null) ||
    (await getActiveEntitlementForUser(guestEmailForCookie(identity.cookieId), c.env.DB));

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
  const ipCeiling = resolveIpCeiling(c.env);
  const quota = await getDailyQuotaStatus({
    actorKey: identity.actorKey,
    networkFallbackKey: identity.networkFallbackKey,
    plan,
    db: c.env.DB,
    ipCeiling,
  });

  const ipHash = identity.networkFallbackKey;
  const deviceHash = (await sha256Hex(`dev:${ip}:${ua.slice(0, 200)}`)).slice(0, 32);

  const actor = {
    ...identity,
    ip,
    ipHash,
    deviceHash,
    userId: verifiedUserId,
    plan,
    isPaid: plan !== 'free',
    entitlementExpiresAt: entitlement?.expiresAt,
    quota,
    ipCeiling,
  };
  if (c.set) c.set('actor', actor);
  return actor;
}

type Actor = Awaited<ReturnType<typeof resolveRequestActor>>;

/** Reserves quota up-front (atomic), returning a 429 response if any limit would be exceeded. */
async function reserveOr429(c: any, actor: Actor, delta: QuotaDelta) {
  const reservation = await reserveQuota({
    actorKey: actor.actorKey,
    networkFallbackKey: actor.networkFallbackKey,
    plan: actor.plan,
    delta,
    db: c.env.DB,
    ipCeiling: actor.ipCeiling,
  });
  if (reservation.ok) return { reservation, response: null as Response | null };
  const q = reservation.status;
  const upgrade = actor.isPaid ? '' : ' Upgrade to an Exam Pass or Semester Pass for higher limits.';
  const shared = q.ipCeilingReached
    ? ' Your network has reached its shared daily free limit.'
    : '';
  const messages: Record<string, { code: string; message: string }> = {
    links: {
      code: 'DAILY_LINK_LIMIT_REACHED',
      message: `You have used all ${q.linksLimit} lecture links for today (resets 00:00 UTC).${shared}${upgrade}`,
    },
    upload: {
      code: 'UPLOAD_DURATION_LIMIT_REACHED',
      message: `Upload limit reached: ${Math.round(q.uploadSecondsLimit / 60)} minutes of audio per ${q.uploadWindow} (${Math.max(0, Math.floor((q.uploadSecondsLimit - q.uploadSecondsUsed) / 60))} min left).${shared}${upgrade}`,
    },
    ai: {
      code: 'QUOTA_EXCEEDED',
      message: `You have used all ${q.aiActionsLimit} AI actions for today (resets 00:00 UTC).${shared}${upgrade}`,
    },
    mockExams: {
      code: 'QUOTA_EXCEEDED',
      message: `The free plan includes ${q.mockExamsLimit} quiz per day (resets 00:00 UTC).${shared}${upgrade}`,
    },
  };
  const m = messages[reservation.exceeded || 'ai'];
  return {
    reservation,
    response: c.json({ success: false, error: m, usage: q }, 429) as Response,
  };
}

const TURNSTILE_HUMAN_COOKIE_TTL = 24 * 3600;

/**
 * Turnstile gate for cost-bearing endpoints. When TURNSTILE_SECRET_KEY is set, the browser must
 * either present a fresh Turnstile token (x-turnstile-token header / turnstileToken body field) or
 * an lfc_hv cookie proving it passed Turnstile in the last 24h. Returns a 403 response when it fails.
 */
async function requireHuman(c: any, actor: Actor, bodyToken?: string): Promise<Response | null> {
  const secretKey = c.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) return null;
  const cookieSecret = getCookieSecret(c);
  const cookies = parseCookies(c.req.header('cookie'));
  const hv = await verifySignedCookieValue(cookies['lfc_hv'], cookieSecret, 'hv');
  if (hv) {
    const [cookieId, expStr] = hv.split('_x');
    if (cookieId === actor.cookieId.replace(/[^a-zA-Z0-9]/g, '') && Number(expStr) > Date.now() / 1000) {
      return null;
    }
  }
  const token = c.req.header('x-turnstile-token') || bodyToken;
  const ok = await verifyTurnstileToken(token, secretKey, actor.ip);
  if (!ok) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TURNSTILE_REQUIRED',
          message: 'Please complete the quick security check and try again.',
        },
      },
      403
    );
  }
  const exp = Math.floor(Date.now() / 1000) + TURNSTILE_HUMAN_COOKIE_TTL;
  const signed = await signCookieValue(
    `${actor.cookieId.replace(/[^a-zA-Z0-9]/g, '')}_x${exp}`,
    cookieSecret,
    'hv'
  );
  appendSetCookie(
    c,
    `lfc_hv=${encodeURIComponent(signed)}; ${cookieAttributes(TURNSTILE_HUMAN_COOKIE_TTL, isSecureRequest(c))}`
  );
  return null;
}

app.onError((err, c) => {
  if (err instanceof ServerMisconfiguredError) {
    console.error('[LearnFromClip] SERVER MISCONFIGURED:', err.message);
    return c.json(
      { success: false, error: { code: 'SERVER_MISCONFIGURED', message: 'Service temporarily unavailable.' } },
      503
    );
  }
  console.error('[LearnFromClip] Unhandled error:', err);
  return c.json(
    { success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
    500
  );
});

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
  allowHeaders: ['Content-Type', 'Accept', 'X-File-Name', 'X-Turnstile-Token'],
  maxAge: 86400,
}));

// Rate Limiting Middleware (protects transcript extraction and AI compute endpoints)
const RATE_LIMIT_BUCKETS: Array<{ prefix: string; bucket: string; perMinute: (env: any) => number }> = [
  // Expensive: transcription / AI
  { prefix: '/api/transcript', bucket: 'heavy', perMinute: (e) => parseInt(e.MAX_REQUESTS_PER_MINUTE || '30', 10) },
  { prefix: '/api/transform', bucket: 'heavy', perMinute: (e) => parseInt(e.MAX_REQUESTS_PER_MINUTE || '30', 10) },
  { prefix: '/api/translate', bucket: 'heavy', perMinute: (e) => parseInt(e.MAX_REQUESTS_PER_MINUTE || '30', 10) },
  { prefix: '/api/revision-pack', bucket: 'heavy', perMinute: (e) => parseInt(e.MAX_REQUESTS_PER_MINUTE || '30', 10) },
  { prefix: '/api/upload/transcribe', bucket: 'heavy', perMinute: (e) => parseInt(e.MAX_REQUESTS_PER_MINUTE || '30', 10) },
  // Uploads arrive as many chunks
  { prefix: '/api/upload/chunk', bucket: 'upload', perMinute: () => 120 },
  // Auth & payments: low ceilings (email bombing / enumeration)
  { prefix: '/api/auth/', bucket: 'auth', perMinute: () => 5 },
  { prefix: '/api/checkout', bucket: 'auth', perMinute: () => 10 },
  { prefix: '/api/referral', bucket: 'auth', perMinute: () => 10 },
  { prefix: '/api/admin', bucket: 'auth', perMinute: () => 10 },
  // Everything else under /api (usage, events, deck sync, platforms)
  { prefix: '/api/', bucket: 'light', perMinute: () => 120 },
];

const rateLimitMiddleware = async (c: any, next: () => Promise<void>) => {
  const path = c.req.path;
  if (path === '/api/health' || path.startsWith('/api/webhooks/') || c.req.method === 'OPTIONS') {
    return next();
  }
  const rule = RATE_LIMIT_BUCKETS.find((r) => path.startsWith(r.prefix))!;
  const ip = getClientIp(c);
  const maxReqs = rule.perMinute(c.env || {});

  const rateResult = await checkRateLimit(`${rule.bucket}:${ip}`, maxReqs, 60, c.env.DB, rule.bucket !== 'light');
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

app.use('/api/*', rateLimitMiddleware);

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

  const humanCheck = await requireHuman(c, actor, (body as any)?.turnstileToken);
  if (humanCheck) return humanCheck;

  const tooLong = (durationSec?: number) => {
    if (durationSec && durationSec > actor.quota.maxLectureSeconds) {
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
    return null;
  };

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
      const blocked = tooLong(cachedTx.videoDurationSeconds);
      if (blocked) return blocked;
      return c.json({
        success: true,
        data: cachedTx,
      });
    }
  }

  // Cache miss: reserve 1 link up-front (atomic; released again if transcription fails)
  const { reservation, response: limitResponse } = await reserveOr429(c, actor, { links: 1 });
  if (limitResponse) return limitResponse;

  const startTime = Date.now();

  try {
    // 3. Process video transcript via provider
    const result = await withJobConcurrencyLimit(() =>
      provider.getTranscript(safeUrl, preferredLanguage, c.env)
    );

    // Enforce maximum lecture length (Free: 2 hours, Paid: 4 hours)
    const blocked = tooLong(result.videoDurationSeconds);
    if (blocked) {
      await reservation.release();
      return blocked;
    }

    if (result.sourceType === 'ai_whisper' && result.videoDurationSeconds) {
      await recordCostTelemetry({ whisperAudioSeconds: result.videoDurationSeconds }, c.env.DB);
    }
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
    await reservation.release();
    if (err instanceof QueueBusyError) {
      return c.json({ success: false, error: { code: 'QUEUE_BUSY', message: err.message } }, 429);
    }
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
  const humanCheck = await requireHuman(c, actor, body?.turnstileToken);
  if (humanCheck) {
    await Promise.allSettled(rawKeys.map((k: string) => c.env.UPLOADS_BUCKET!.delete(k)));
    return humanCheck;
  }

  // Quota is charged by AUDIO DURATION measured on the server, not by MB and not by the client's
  // claim: 16 kHz mono PCM16 WAV chunks are exactly 32,000 bytes per second.
  let measuredBatchSec = 0;
  let unmeasurable = false;
  for (const k of rawKeys as string[]) {
    const head = await c.env.UPLOADS_BUCKET.head(k);
    if (!head) continue;
    if (k.endsWith('.wav')) {
      measuredBatchSec += Math.max(0, head.size - 44) / 32000;
    } else {
      unmeasurable = true;
    }
  }
  const clientBatchSec =
    typeof body?.batchDurationSeconds === 'number' && Number.isFinite(body.batchDurationSeconds)
      ? Math.max(0, body.batchDurationSeconds)
      : 0;
  const estimatedDurationSec = Math.ceil(
    unmeasurable
      ? Math.max(measuredBatchSec, clientBatchSec, videoDurationSeconds || 0, 60)
      : measuredBatchSec
  );
  const lectureEndSec = Math.max(
    videoDurationSeconds || 0,
    (chunkOffsetsSec.length ? Math.max(...chunkOffsetsSec) : 0) + (estimatedDurationSec / Math.max(1, rawKeys.length))
  );

  if (lectureEndSec > actor.quota.maxLectureSeconds) {
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

  const { reservation, response: limitResponse } = await reserveOr429(c, actor, {
    uploadSeconds: estimatedDurationSec,
  });
  if (limitResponse) {
    await Promise.allSettled(rawKeys.map((k: string) => c.env.UPLOADS_BUCKET!.delete(k)));
    return limitResponse;
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

    // For files we could not measure up-front, charge any extra audio actually transcribed.
    let actualDurationSec = estimatedDurationSec;
    if (unmeasurable && result.segments.length > 0) {
      const last = result.segments[result.segments.length - 1];
      const firstOffset = chunkOffsetsSec.length ? Math.min(...chunkOffsetsSec) : 0;
      const spoken = Math.ceil(last.start + last.duration - firstOffset);
      if (spoken > estimatedDurationSec) {
        await consumeQuota({
          actorKey: actor.actorKey,
          networkFallbackKey: actor.isPaid ? undefined : actor.networkFallbackKey,
          uploadSeconds: spoken - estimatedDurationSec,
          db: c.env.DB,
        });
        actualDurationSec = spoken;
      }
    }
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
    await reservation.release();
    if (err instanceof QueueBusyError) {
      return c.json({ success: false, error: { code: 'QUEUE_BUSY', message: err.message } }, 429);
    }
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
  const humanCheck = await requireHuman(c, actor, body?.turnstileToken);
  if (humanCheck) return humanCheck;
  const { reservation, response: limitResponse } = await reserveOr429(c, actor, { aiHalfUnits: 2 });
  if (limitResponse) return limitResponse;

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
    await reservation.release();
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
  const humanCheck = await requireHuman(c, actor, body?.turnstileToken);
  if (humanCheck) return humanCheck;
  const { reservation, response: limitResponse } = await reserveOr429(c, actor, { aiHalfUnits: 2 });
  if (limitResponse) return limitResponse;

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
    await reservation.release();
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

  if (segments.length > 20_000) {
    return c.json(
      { success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Transcript is too large.' } },
      413
    );
  }

  const actor = await resolveRequestActor(c);
  const humanCheck = await requireHuman(c, actor, body?.turnstileToken);
  if (humanCheck) return humanCheck;

  const secondLanguage =
    typeof body.secondLanguage === 'string' && body.secondLanguage.trim()
      ? body.secondLanguage.trim()
      : undefined;
  // Plan comes ONLY from the server-side entitlement (never from the request body).
  const isPaid = actor.isPaid;
  const maxCards = actor.quota.maxCardsPerPack;
  const transcriptTextForHash = segments.map((s: any) => `${s.start}|${s.text}`).join('\n');
  const { packCacheKey, transcriptHash } = buildRevisionPackCacheKey(
    segments,
    secondLanguage,
    maxCards
  );
  const referralCode = typeof body.referralCode === 'string' ? body.referralCode.trim() : '';

  const maybeCompleteReferral = async () => {
    if (!referralCode) return undefined;
    try {
      return await completeReferralOnFirstDeck({
        referralCode,
        inviteeIdentityEmail: actor.userId
          ? (await getUserById(actor.userId, c.env.DB))?.email || guestEmailForCookie(actor.cookieId)
          : guestEmailForCookie(actor.cookieId),
        inviteeActorKey: actor.actorKey,
        inviteeIpHash: actor.ipHash,
        inviteeDeviceHash: actor.deviceHash,
        db: c.env.DB,
      });
    } catch (err) {
      console.warn('[LearnFromClip] referral completion failed:', err);
      return undefined;
    }
  };

  // Cached pack: costs half an AI action (+ the day's quiz for free users)
  const cachedPack = await getCachedRevisionPack(packCacheKey, c.env.DB);
  if (cachedPack) {
    const { response: limitResponse } = await reserveOr429(c, actor, {
      aiHalfUnits: 1,
      mockExams: 1,
    });
    if (limitResponse) return limitResponse;
    const referral = await maybeCompleteReferral();
    return c.json({
      success: true,
      data: cachedPack,
      cached: true,
      referral: referral ? { rewarded: referral.rewarded, reason: referral.reason } : undefined,
    });
  }

  // Cache miss: 1 full AI action + 1 quiz
  const { reservation, response: limitResponse } = await reserveOr429(c, actor, {
    aiHalfUnits: 2,
    mockExams: 1,
  });
  if (limitResponse) return limitResponse;

  try {
    const pack = await withJobConcurrencyLimit(async () =>
      generateVerifiedRevisionPack(
        {
          videoId: typeof body.videoId === 'string' ? body.videoId.slice(0, 120) : 'lecture',
          provider: typeof body.provider === 'string' ? body.provider.slice(0, 40) : 'youtube',
          videoTitle: typeof body.videoTitle === 'string' ? body.videoTitle.slice(0, 300) : 'Lecture',
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
    await recordCostTelemetry(
      {
        llmInputTokens: Math.ceil(transcriptTextForHash.length / 4),
        llmOutputTokens: 1600 * Math.max(1, pack.metadata.totalChunks),
      },
      c.env.DB
    );
    const referral = await maybeCompleteReferral();

    return c.json({
      success: true,
      data: pack,
      cached: false,
      referral: referral ? { rewarded: referral.rewarded, reason: referral.reason } : undefined,
    });
  } catch (err: any) {
    await reservation.release();
    const msg = err?.message || 'Could not generate revision pack right now.';
    const isTooLong = /maximum supported/i.test(msg);
    const isQueueBusy = err instanceof QueueBusyError;
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

function appBaseUrl(c: any): string {
  // Never build emailed links from the Host header (host-header injection would let an attacker
  // receive someone else's login link). Production uses APP_BASE_URL or the canonical domain.
  const configured = typeof c.env?.APP_BASE_URL === 'string' ? c.env.APP_BASE_URL.trim().replace(/\/+$/, '') : '';
  if (configured) return configured;
  if (isProduction(c)) return 'https://learnfromclip.com';
  try {
    return new URL(c.req.url).origin;
  } catch {
    return 'http://localhost:8787';
  }
}

// Auth: Passwordless Email Magic Link ("Save my streak" / Paid login)
app.post('/api/auth/magic-link', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) {
    return c.json(
      { success: false, error: { code: 'INVALID_EMAIL', message: 'Please enter a valid email address.' } },
      400
    );
  }

  const resendKey = c.env.RESEND_API_KEY;
  if (!resendKey && isProduction(c)) {
    console.error('[LearnFromClip] RESEND_API_KEY is not configured: cannot send magic links.');
    return c.json(
      {
        success: false,
        error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email sign-in is temporarily unavailable.' },
      },
      503
    );
  }

  const link = await createMagicLinkToken(email, c.env.DB);
  const verifyUrl = `${appBaseUrl(c)}/api/auth/verify?token=${encodeURIComponent(link.token)}`;

  if (resendKey) {
    try {
      await sendMagicLinkEmail({ to: email, link: verifyUrl, apiKey: resendKey, from: c.env.EMAIL_FROM });
    } catch (err) {
      console.error('[LearnFromClip] magic link email failed:', err);
      return c.json(
        { success: false, error: { code: 'EMAIL_SEND_FAILED', message: 'Could not send the email. Please try again.' } },
        502
      );
    }
    return c.json({ success: true, data: { sent: true, email, expiresAt: link.expiresAt } });
  }

  // Development fallback ONLY (never in production): log the link so the flow can be tested.
  console.log(`[LearnFromClip DEV] Magic link for ${email}: ${verifyUrl}`);
  return c.json({
    success: true,
    data: { sent: true, email, expiresAt: link.expiresAt, devVerifyUrl: verifyUrl },
  });
});

// GET only shows a confirmation button: email security scanners pre-fetch links, and a GET that
// consumed the single-use token would log the student out of their own link.
app.get('/api/auth/verify', (c) => {
  const token = (c.req.query('token') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — LearnFromClip</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#FEFEFE;color:#021433;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}main{max-width:420px;text-align:center}button{margin-top:16px;padding:12px 20px;border:0;border-radius:12px;background:#2E62F4;color:#fff;font-weight:700;font-size:16px;cursor:pointer}</style></head>
<body><main><h1>Sign in to LearnFromClip</h1><p>Tap the button to finish signing in and sync your decks.</p>
<form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${token}"><button type="submit">Sign in</button></form></main></body></html>`);
});

app.post('/api/auth/verify', async (c) => {
  const contentType = c.req.header('content-type') || '';
  let token = '';
  if (contentType.includes('application/json')) {
    const body = await c.req.json().catch(() => ({}));
    token = typeof body?.token === 'string' ? body.token : '';
  } else {
    const form = await c.req.parseBody().catch(() => ({} as Record<string, any>));
    token = typeof form?.token === 'string' ? form.token : '';
  }
  const verified = await verifyMagicLinkToken(token, getCookieSecret(c), c.env.DB, isSecureRequest(c));
  if (!verified) {
    if (!contentType.includes('application/json')) {
      return c.redirect('/study?login=expired', 303);
    }
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

  appendSetCookie(c, verified.signedUserCookie);
  if (!contentType.includes('application/json')) {
    return c.redirect('/study?synced=1', 303);
  }
  return c.json({
    success: true,
    data: { userId: verified.user.id, email: verified.user.email },
  });
});

app.post('/api/auth/logout', (c) => {
  appendSetCookie(c, `lfc_uid=; ${cookieAttributes(0, isSecureRequest(c))}`);
  return c.json({ success: true });
});

// Who am I (used by Study page to decide whether cloud sync is available)
app.get('/api/me', async (c) => {
  const actor = await resolveRequestActor(c);
  const user = actor.userId ? await getUserById(actor.userId, c.env.DB) : null;
  return c.json({
    success: true,
    data: {
      signedIn: Boolean(user),
      email: user?.email || null,
      plan: actor.plan,
      isPaid: actor.isPaid,
      planExpiresAt: actor.entitlementExpiresAt || null,
      cloudSync: Boolean(user && actor.isPaid),
    },
  });
});

// Cloud Deck Sync: signed-in PAID users only; every query is scoped to the caller's own user id.
async function requireSyncUser(c: any): Promise<{ userId: string } | Response> {
  const actor = await resolveRequestActor(c);
  if (!actor.userId) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Sign in with a magic link to sync decks.' } },
      401
    );
  }
  if (!actor.isPaid) {
    return c.json(
      { success: false, error: { code: 'PAID_PLAN_REQUIRED', message: 'Cloud sync is included with paid passes.' } },
      403
    );
  }
  return { userId: actor.userId };
}

app.get('/api/decks/sync', async (c) => {
  const auth = await requireSyncUser(c);
  if (auth instanceof Response) return auth;
  const decks = await loadSyncedDecksFromCloud(auth.userId, c.env.DB);
  return c.json({ success: true, data: { decks } });
});

app.post('/api/decks/sync', async (c) => {
  const auth = await requireSyncUser(c);
  if (auth instanceof Response) return auth;
  const body = await c.req.json().catch(() => ({}));
  const incoming = Array.isArray(body?.decks) ? body.decks : body?.deck ? [body.deck] : [];
  const decksToSync = incoming
    .filter((d: any) => d && typeof d.id === 'string' && d.id.trim())
    .map((d: any) => ({
      id: String(d.id).slice(0, 120),
      title: String(d.title || 'Revision Pack').slice(0, 300),
      packJson: typeof d.packJson === 'string' ? d.packJson : JSON.stringify(d.pack ?? d),
      updatedAt: Number(d.updatedAt) || Date.now(),
    }));
  const existing = await countSyncedDecks(auth.userId, c.env.DB);
  if (existing + decksToSync.length > MAX_SYNCED_DECKS_PER_USER + 50) {
    return c.json(
      { success: false, error: { code: 'TOO_MANY_DECKS', message: `Cloud sync holds up to ${MAX_SYNCED_DECKS_PER_USER} decks.` } },
      413
    );
  }
  const syncedCount = await syncUserDecksToCloud(auth.userId, decksToSync, c.env.DB);
  const allDecks = await loadSyncedDecksFromCloud(auth.userId, c.env.DB);
  return c.json({ success: true, data: { syncedCount, decks: allDecks } });
});

// Checkout Session (Lemon Squeezy Merchant of Record) — creates a real hosted checkout via the API
app.post('/api/checkout', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const plan = (body?.plan || body?.planType) as PaidPlan;
  if (!['exam_pass', 'monthly', 'semester_pass'].includes(plan)) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_PLAN', message: 'Invalid plan selected.' },
      },
      400
    );
  }

  const actor = await resolveRequestActor(c);
  const email = typeof body?.email === 'string' && isValidEmail(body.email.trim()) ? body.email.trim().toLowerCase() : undefined;
  // Regional price is OFFERED from the request's IP country, and then VALIDATED against the
  // customer's billing country in the webhook (a VPN alone cannot unlock the regional price).
  const ipCountry = (c.req.header('CF-IPCountry') || '').toUpperCase();
  const regional = isEligibleForRegionalPricing(ipCountry);
  const pricing = PLAN_CATALOG[plan];
  const config = readLemonSqueezyConfig(c.env as any);

  try {
    const checkout = await createLemonSqueezyCheckout({
      config,
      plan,
      regional,
      email,
      countryHint: /^[A-Z]{2}$/.test(ipCountry) && ipCountry !== 'XX' && ipCountry !== 'T1' ? ipCountry : undefined,
      customData: {
        aid: actor.cookieId,
        ...(actor.userId ? { user_id: actor.userId } : {}),
        plan,
      },
      redirectUrl: `${appBaseUrl(c)}/study?purchase=success`,
    });
    return c.json({
      success: true,
      data: {
        plan,
        name: pricing.name,
        billingType: pricing.billingType,
        autoRenew: pricing.autoRenew,
        regionalPricingApplied: regional && Boolean(config.variantsByPlan[plan].regional),
        priceUsd: regional && config.variantsByPlan[plan].regional ? pricing.regionalPriceUsd : pricing.priceUsd,
        checkoutUrl: checkout.url,
      },
    });
  } catch (err: any) {
    const notConfigured = err?.code === 'CHECKOUT_NOT_CONFIGURED';
    return c.json(
      {
        success: false,
        error: {
          code: notConfigured ? 'CHECKOUT_NOT_CONFIGURED' : 'CHECKOUT_FAILED',
          message: notConfigured
            ? 'Payments are not available yet. Please try again soon.'
            : 'Could not start checkout right now. Please try again.',
        },
      },
      notConfigured ? 503 : 502
    );
  }
});

// Lemon Squeezy Webhook (purchase, subscription lifecycle, refunds). Signature is REQUIRED.
app.post('/api/webhooks/lemonsqueezy', async (c) => {
  const secret = c.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[LearnFromClip] LEMONSQUEEZY_WEBHOOK_SECRET not configured: rejecting webhook.');
    return c.json(
      { success: false, error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook secret not configured.' } },
      503
    );
  }
  const rawBody = await c.req.text();
  const validSig = await verifyHmacSha256Hex(secret, rawBody, c.req.header('X-Signature'));
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

  try {
    const result = await processPaymentWebhook(payload, {
      db: c.env.DB,
      eventHash: await sha256Hex(rawBody),
      config: readLemonSqueezyConfig(c.env as any),
    });
    return c.json({ success: true, data: { handled: result.handled, duplicate: Boolean(result.duplicate), event: result.eventName, reason: result.reason } });
  } catch (err) {
    // Non-2xx makes Lemon Squeezy retry the delivery later (e.g. transient D1 / API failure).
    console.error('[LearnFromClip] webhook processing failed:', err);
    return c.json({ success: false, error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'Retry later.' } }, 500);
  }
});

// Referral Program: "Invite a friend" -> 3-day Exam Pass for both when the friend creates their
// first deck (completed server-side inside /api/revision-pack). Max 5 rewards.
app.post('/api/referral/code', async (c) => {
  const actor = await resolveRequestActor(c);
  const identityEmail = actor.userId
    ? (await getUserById(actor.userId, c.env.DB))?.email || guestEmailForCookie(actor.cookieId)
    : guestEmailForCookie(actor.cookieId);
  const user = await getReferralCodeForIdentity(identityEmail, actor.deviceHash, c.env.DB);
  return c.json({
    success: true,
    data: {
      code: user.referralCode,
      referralCode: user.referralCode,
      rewardsUsed: user.referralRewardsCount,
      shareUrl: `${appBaseUrl(c)}/?ref=${encodeURIComponent(user.referralCode)}`,
    },
  });
});

// Admin Cost & Cache Telemetry View — requires ADMIN_TOKEN (Authorization: Bearer <token>)
app.get('/api/admin/costs', async (c) => {
  const adminToken = c.env.ADMIN_TOKEN;
  const auth = c.req.header('authorization') || '';
  const presented = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!adminToken || adminToken.length < 24) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access is disabled.' } }, 403);
  }
  if (!presented || !timingSafeEqual(presented, adminToken)) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Admin token required.' } }, 401);
  }
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
          typeof body?.path === 'string' && /^\/[a-z0-9\-\/]{0,80}$/i.test(body.path) ? body.path : '/',
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

