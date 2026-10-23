import { describe, it, expect, vi } from 'vitest';
import app from '../server/index';
import { ProviderRegistry } from '../server/providers/registry';

describe('Server Platform Routing & Enforcement (/api/transcript)', () => {
  const mockEnv = {
    ENVIRONMENT: 'test',
    MAX_REQUESTS_PER_MINUTE: '60',
    MAX_VIDEO_DURATION_SECONDS: '14400',
    CACHE_TTL_SECONDS: '86400',
  };

  describe('Bug 1: Platform Mismatch Rejection', () => {
    it('rejects YouTube URL when Instagram platform is requested', async () => {
      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
            platform: 'instagram',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PLATFORM_MISMATCH');
      expect(body.error.message).toContain('That link is from YouTube, but Instagram was selected');
    });

    it('rejects TikTok URL when Instagram platform is requested', async () => {
      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.tiktok.com/@user/video/7123456789012345678',
            platform: 'instagram',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PLATFORM_MISMATCH');
      expect(body.error.message).toContain('That link is from TikTok, but Instagram was selected');
    });

    it('rejects YouTube URL when TikTok platform is requested', async () => {
      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
            platform: 'tiktok',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PLATFORM_MISMATCH');
      expect(body.error.message).toContain('That link is from YouTube, but TikTok was selected');
    });

    it('rejects Instagram URL when TikTok platform is requested', async () => {
      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.instagram.com/reel/Dd1gQBsCWE8/',
            platform: 'tiktok',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PLATFORM_MISMATCH');
      expect(body.error.message).toContain('That link is from Instagram, but TikTok was selected');
    });

    it('rejects TikTok URL when YouTube platform is requested', async () => {
      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.tiktok.com/@user/video/7123456789012345678',
            platform: 'youtube',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PLATFORM_MISMATCH');
      expect(body.error.message).toContain('That link is from TikTok, but YouTube was selected');
    });

    it('rejects Instagram URL when YouTube platform is requested', async () => {
      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.instagram.com/reel/Dd1gQBsCWE8/',
            platform: 'youtube',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PLATFORM_MISMATCH');
      expect(body.error.message).toContain('That link is from Instagram, but YouTube was selected');
    });
  });

  describe('Invalid or Unsupported Platform/URL Requests', () => {
    it('rejects unknown platform identifier', async () => {
      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
            platform: 'vimeo',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_PLATFORM');
    });

    it('rejects empty or whitespace-only URL', async () => {
      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: '   ',
            platform: 'youtube',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISSING_URL');
    });
  });

  describe('Correct Platform Routing', () => {
    it('routes matching YouTube platform and URL to YouTubeProvider', async () => {
      const providers = ProviderRegistry.getProviders();
      const ytProvider = providers.find((p) => p.id === 'youtube')!;
      const spy = vi.spyOn(ytProvider, 'getTranscript').mockResolvedValueOnce({
        id: 'test-job-yt',
        provider: 'youtube',
        videoId: 'jNQXAC9IVRw',
        videoTitle: 'Me at the zoo',
        sourceType: 'captions',
        language: 'en',
        segments: [{ id: 1, start: 0, duration: 2, text: 'Hello zoo' }],
        fullText: 'Hello zoo',
        srt: '1\n00:00:00,000 --> 00:00:02,000\nHello zoo\n',
        vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello zoo\n',
        createdAt: Date.now(),
      });

      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
            platform: 'youtube',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe('youtube');
      expect(body.data.fullText).toBe('Hello zoo');
      expect(spy).toHaveBeenCalled();
    });

    it('routes matching TikTok platform and URL to TikTokProvider', async () => {
      const providers = ProviderRegistry.getProviders();
      const ttProvider = providers.find((p) => p.id === 'tiktok')!;
      const spy = vi.spyOn(ttProvider, 'getTranscript').mockResolvedValueOnce({
        id: 'test-job-tt',
        provider: 'tiktok',
        videoId: '7123456789012345678',
        videoTitle: '@creator: TikTok Title',
        sourceType: 'captions',
        language: 'en',
        segments: [{ id: 1, start: 0, duration: 3, text: 'TikTok speech' }],
        fullText: 'TikTok speech',
        srt: '1\n00:00:00,000 --> 00:00:03,000\nTikTok speech\n',
        vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nTikTok speech\n',
        createdAt: Date.now(),
      });

      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.tiktok.com/@creator/video/7123456789012345678',
            platform: 'tiktok',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe('tiktok');
      expect(body.data.fullText).toBe('TikTok speech');
      expect(spy).toHaveBeenCalled();
    });

    it('routes matching Instagram platform and URL to InstagramProvider', async () => {
      const providers = ProviderRegistry.getProviders();
      const igProvider = providers.find((p) => p.id === 'instagram')!;
      const spy = vi.spyOn(igProvider, 'getTranscript').mockResolvedValueOnce({
        id: 'test-job-ig',
        provider: 'instagram',
        videoId: 'Dd1gQBsCWE8',
        videoTitle: '@nasa: Asteroid Reel',
        sourceType: 'ai_whisper',
        language: 'en',
        segments: [{ id: 1, start: 0, duration: 4, text: 'Asteroid approaching' }],
        fullText: 'Asteroid approaching',
        srt: '1\n00:00:00,000 --> 00:00:04,000\nAsteroid approaching\n',
        vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nAsteroid approaching\n',
        createdAt: Date.now(),
      });

      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.instagram.com/reel/Dd1gQBsCWE8/',
            platform: 'instagram',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe('instagram');
      expect(body.data.fullText).toBe('Asteroid approaching');
      expect(spy).toHaveBeenCalled();
    });

    it('surfaces user-friendly error message when provider throws', async () => {
      const providers = ProviderRegistry.getProviders();
      const ytProvider = providers.find((p) => p.id === 'youtube')!;
      vi.spyOn(ytProvider, 'getTranscript').mockRejectedValueOnce(
        new Error('This YouTube video is unavailable or private.')
      );

      const res = await app.request(
        '/api/transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.youtube.com/watch?v=private12345',
            platform: 'youtube',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(422);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('TRANSCRIPTION_FAILED');
      expect(body.error.message).toBe('This YouTube video is unavailable or private.');
    });
  });
});

