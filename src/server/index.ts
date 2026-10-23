import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CloudflareBindings, TranscriptRequest } from '../types';
import { validateSafeUrl } from './utils/ssrf';
import { checkRateLimit } from './utils/rate-limiter';
import { ProviderRegistry } from './providers/registry';

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

  const { url, preferredLanguage = 'en' } = body;

  if (!url || typeof url !== 'string') {
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
  const ssrfCheck = validateSafeUrl(url);
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

  const safeUrl = ssrfCheck.normalizedUrl || url;

  // 2. Identify matching provider adapter
  const provider = ProviderRegistry.findProvider(safeUrl);
  if (!provider) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message:
            'Unsupported platform. TextFromClip currently supports YouTube (all public videos & Shorts) and direct audio/video links (.mp4, .mp3, .webm).',
        },
      },
      400
    );
  }

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

