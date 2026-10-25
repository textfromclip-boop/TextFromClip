import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CloudflareBindings, TranscriptRequest } from '../types';
import { validateSafeUrl } from './utils/ssrf';
import { checkRateLimit } from './utils/rate-limiter';
import { ProviderRegistry } from './providers/registry';
import {
  cleanTranscriptForAi,
  budgetTranscriptForPrompt,
  buildTransformPrompt,
  postProcessTransformOutput,
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
  allowHeaders: ['Content-Type', 'Accept'],
  maxAge: 86400,
}));

// Rate Limiting Middleware
app.use('/api/transcript', async (c, next) => {
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
});

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'TextFromClip',
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT || 'development',
    hasD1: Boolean(c.env.DB),
    hasAI: Boolean(c.env.AI),
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
    const validPlatforms = ['youtube', 'tiktok', 'instagram'];
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
      (platform === 'instagram' && detectedProvider?.id === 'instagram');

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
        platform === 'youtube' ? 'YouTube' : platform === 'tiktok' ? 'TikTok' : 'Instagram';

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

// Helper to run Cloudflare Workers AI text generation across active (non-deprecated) models
const ACTIVE_TEXT_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.2-3b-instruct',
];

async function runWorkersAiChat(
  ai: any,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1024,
  temperature = 0.2
): Promise<{ text: string; modelUsed: string }> {
  let lastError: any = null;
  for (const model of ACTIVE_TEXT_MODELS) {
    try {
      const res = await ai.run(model, {
        messages,
        max_tokens: maxTokens,
        temperature,
      });
      const text = (res?.response ?? res?.result?.response ?? '').trim();
      if (text) return { text, modelUsed: model };
    } catch (err: any) {
      lastError = err;
    }
  }
  throw lastError || new Error('Workers AI returned an empty response.');
}

// AI Transform endpoint (Summary, Viral Script, Blog Post, Thread, Study Notes) — 0 SnapAny credits
app.post('/api/transform', async (c) => {
  try {
    const body = await c.req.json();
    const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
    const rawMode = typeof body?.mode === 'string' ? body.mode : 'summary';
    const videoTitle = typeof body?.videoTitle === 'string' ? body.videoTitle : 'Video';

    if (!rawText) {
      return c.json(
        { success: false, error: { code: 'EMPTY_TEXT', message: 'Transcript text is required.' } },
        400
      );
    }

    const { cleanedText, wordCount } = cleanTranscriptForAi(rawText);
    if (!cleanedText) {
      return c.json(
        { success: false, error: { code: 'EMPTY_TEXT', message: 'Transcript contains no spoken words.' } },
        400
      );
    }

    const { text: budgetedText } = budgetTranscriptForPrompt(cleanedText, 14000);
    const spec = buildTransformPrompt(rawMode, videoTitle, budgetedText, wordCount);

    if (c.env.AI) {
      const { text: rawOutput, modelUsed } = await runWorkersAiChat(
        c.env.AI,
        spec.messages,
        spec.maxTokens,
        spec.temperature
      );

      const processed = postProcessTransformOutput(rawOutput, spec.mode, cleanedText);
      if (processed) {
        return c.json({
          success: true,
          data: { result: processed, mode: spec.mode, model: modelUsed },
        });
      }
    }

    // Fallback extractive summary if AI binding is unavailable in local dev
    const sentences = budgetedText
      .split(/(?<=[.?!])\s+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 25);
    const topSentences = sentences.slice(0, 5).map((s: string) => `• ${s}`).join('\n');
    return c.json({
      success: true,
      data: {
        result: `${videoTitle}\n\nKey Points:\n${topSentences || budgetedText.slice(0, 600)}`,
        mode: spec.mode,
      },
    });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TRANSFORM_FAILED',
          message: err?.message || 'Could not transform transcript right now.',
        },
      },
      500
    );
  }
});

// AI Translate endpoint — 0 SnapAny credits
app.post('/api/translate', async (c) => {
  try {
    const body = await c.req.json();
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

    const { cleanedText } = cleanTranscriptForAi(rawText);
    const clipped = (cleanedText || rawText).slice(0, 12000);

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

    const { text: translated } = await runWorkersAiChat(
      c.env.AI,
      [
        {
          role: 'system',
          content: `You are a professional translator. Translate the user's transcript accurately and naturally into ${targetLanguage}. Output ONLY the translated text without any introductory or concluding remarks.`,
        },
        {
          role: 'user',
          content: clipped,
        },
      ],
      1536,
      0.15
    );

    if (!translated) {
      throw new Error('Empty translation returned.');
    }

    return c.json({
      success: true,
      data: {
        translatedText: translated,
        targetLanguage,
      },
    });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TRANSLATE_FAILED',
          message: err?.message || 'Could not translate transcript right now.',
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

