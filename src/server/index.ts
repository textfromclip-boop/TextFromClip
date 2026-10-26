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

const app = new Hono<{ Bindings: CloudflareBindings }>();

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
app.use('/api/upload/*', rateLimitMiddleware);

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'TextFromClip',
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
            'Unsupported platform. TextFromClip currently supports YouTube (all public videos & Shorts), TikTok, Instagram Reels, and direct audio/video links (.mp4, .mp3, .webm).',
        },
      },
      400
    );
  }

  const provider = detectedProvider;

  const startTime = Date.now();

  try {
    // 3. Process video transcript via provider
    const result = await provider.getTranscript(safeUrl, preferredLanguage, c.env);

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

// R2 File Upload: Store temporary audio/video chunk in R2 bucket (textfromclip-uploads)
app.post('/api/upload/chunk', async (c) => {
  if (!c.env.UPLOADS_BUCKET) {
    return c.json(
      {
        success: false,
        error: {
          code: 'R2_UNAVAILABLE',
          message: 'R2 upload storage is not bound in this environment.',
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
            'Failed to store temporary audio chunk in R2.'
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
          message: 'R2 upload storage is not bound in this environment.',
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
          message: 'File transcription requires Cloudflare Workers AI (env.AI) to run Whisper.',
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

  const startTime = Date.now();

  try {
    const result = await transcribeUploadedChunksFromR2({
      bucket: c.env.UPLOADS_BUCKET,
      ai: c.env.AI,
      keys: rawKeys,
      chunkOffsetsSec,
      fileName,
      videoDurationSeconds,
      preferredLanguage,
    });

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

// SEO: robots.txt
app.get('/robots.txt', (c) => {
  return c.text(
`User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://textfromclip.com/sitemap.xml
`
  );
});

// SEO: sitemap.xml
app.get('/sitemap.xml', (c) => {
  c.header('Content-Type', 'application/xml');
  return c.text(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://textfromclip.com/youtube</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://textfromclip.com/tiktok</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://textfromclip.com/instagram</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://textfromclip.com/upload</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://textfromclip.com/guide</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://textfromclip.com/about</loc>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
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

