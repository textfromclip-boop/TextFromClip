import { describe, it, expect } from 'vitest';
import app from '../server/index';

describe('Backend API Endpoints', () => {
  const mockEnv = {
    ENVIRONMENT: 'test',
    MAX_REQUESTS_PER_MINUTE: '60',
    MAX_VIDEO_DURATION_SECONDS: '14400',
    CACHE_TTL_SECONDS: '86400',
  };

  it('GET /api/health returns operational status', async () => {
    const res = await app.request('/api/health', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('TextFromClip');
  });

  it('GET /api/platforms returns registered platform adapters', async () => {
    const res = await app.request('/api/platforms', {}, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    const youtube = body.data.find((p: any) => p.id === 'youtube');
    expect(youtube).toBeDefined();
    expect(youtube.isFullyOperational).toBe(true);
  });

  it('POST /api/transcript rejects requests with missing or empty URL', async () => {
    const res = await app.request(
      '/api/transcript',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      mockEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('MISSING_URL');
  });

  it('POST /api/transcript rejects SSRF loopback URLs', async () => {
    const res = await app.request(
      '/api/transcript',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:8080/secret' }),
      },
      mockEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SSRF_BLOCKED');
  });

  it('POST /api/transcript rejects unsupported platforms gracefully', async () => {
    const res = await app.request(
      '/api/transcript',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://vimeo.com/987654321' }),
      },
      mockEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNSUPPORTED_PROVIDER');
  });

  it('GET /robots.txt returns valid search engine directives', async () => {
    const res = await app.request('/robots.txt', {}, mockEnv);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Sitemap:');
  });

  it('GET /sitemap.xml returns valid XML sitemap', async () => {
    const res = await app.request('/sitemap.xml', {}, mockEnv);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<urlset');
    expect(xml).toContain('https://textfromclip.com/');
  });
});
