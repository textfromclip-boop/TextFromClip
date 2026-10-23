import { describe, it, expect } from 'vitest';
import { validateUrlForPlatform, detectPlatformFromUrl } from '../utils/validation';

describe('UI Platform Validation (detectPlatformFromUrl & validateUrlForPlatform)', () => {
  describe('Platform Detection', () => {
    it('detects YouTube URLs correctly', () => {
      expect(detectPlatformFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatformFromUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatformFromUrl('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatformFromUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    });

    it('detects TikTok URLs correctly', () => {
      expect(detectPlatformFromUrl('https://www.tiktok.com/@user/video/7123456789012345678')).toBe('tiktok');
      expect(detectPlatformFromUrl('https://tiktok.com/@user/video/7123456789012345678')).toBe('tiktok');
      expect(detectPlatformFromUrl('https://vm.tiktok.com/ZM12345/')).toBe('tiktok');
      expect(detectPlatformFromUrl('https://vt.tiktok.com/ZS12345/')).toBe('tiktok');
    });

    it('detects Instagram URLs correctly', () => {
      expect(detectPlatformFromUrl('https://www.instagram.com/reel/Dd1gQBsCWE8/')).toBe('instagram');
      expect(detectPlatformFromUrl('https://instagram.com/reel/Dd1gQBsCWE8/')).toBe('instagram');
      expect(detectPlatformFromUrl('https://www.instagram.com/p/Dd1gQBsCWE8/')).toBe('instagram');
    });

    it('detects direct media files correctly', () => {
      expect(detectPlatformFromUrl('https://example.com/audio.mp3')).toBe('direct_media');
      expect(detectPlatformFromUrl('https://example.com/video.mp4?token=123')).toBe('direct_media');
      expect(detectPlatformFromUrl('https://example.com/clip.webm')).toBe('direct_media');
    });

    it('returns unknown for unsupported domains or non-URLs', () => {
      expect(detectPlatformFromUrl('https://vimeo.com/123456')).toBe('unknown');
      expect(detectPlatformFromUrl('not-a-url')).toBe('unknown');
    });
  });

  describe('Strict Platform Matching & Validation', () => {
    it('allows valid YouTube links on YouTube tab', () => {
      const result = validateUrlForPlatform('https://www.youtube.com/watch?v=jNQXAC9IVRw', 'youtube');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('allows direct media files on YouTube tab', () => {
      const result = validateUrlForPlatform('https://cdn.example.com/speech.mp3', 'youtube');
      expect(result.isValid).toBe(true);
    });

    it('allows valid TikTok links on TikTok tab', () => {
      const result = validateUrlForPlatform('https://www.tiktok.com/@user/video/7123456789012345678', 'tiktok');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('allows valid Instagram links on Instagram tab', () => {
      const result = validateUrlForPlatform('https://www.instagram.com/reel/Dd1gQBsCWE8/', 'instagram');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects TikTok URL on YouTube tab with clear guidance', () => {
      const result = validateUrlForPlatform('https://www.tiktok.com/@user/video/12345', 'youtube');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('That link is from TikTok');
      expect(result.error).toContain('switch to the TikTok tab');
    });

    it('rejects Instagram URL on YouTube tab with clear guidance', () => {
      const result = validateUrlForPlatform('https://www.instagram.com/reel/12345/', 'youtube');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('That link is from Instagram');
      expect(result.error).toContain('switch to the Instagram tab');
    });

    it('rejects YouTube URL on TikTok tab with clear guidance', () => {
      const result = validateUrlForPlatform('https://www.youtube.com/watch?v=jNQXAC9IVRw', 'tiktok');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('That link is from YouTube');
      expect(result.error).toContain('switch to the YouTube tab');
    });

    it('rejects Instagram URL on TikTok tab with clear guidance', () => {
      const result = validateUrlForPlatform('https://www.instagram.com/reel/12345/', 'tiktok');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('That link is from Instagram');
      expect(result.error).toContain('switch to the Instagram tab');
    });

    it('rejects YouTube URL on Instagram tab with clear guidance', () => {
      const result = validateUrlForPlatform('https://www.youtube.com/watch?v=jNQXAC9IVRw', 'instagram');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('That link is from YouTube');
      expect(result.error).toContain('switch to the YouTube tab');
    });

    it('rejects TikTok URL on Instagram tab with clear guidance', () => {
      const result = validateUrlForPlatform('https://www.tiktok.com/@user/video/12345', 'instagram');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('That link is from TikTok');
      expect(result.error).toContain('switch to the TikTok tab');
    });

    it('rejects direct media on Instagram tab', () => {
      const result = validateUrlForPlatform('https://example.com/audio.mp3', 'instagram');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Unsupported platform');
    });

    it('rejects direct media on TikTok tab', () => {
      const result = validateUrlForPlatform('https://example.com/audio.mp3', 'tiktok');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Unsupported platform');
    });

    it('rejects empty and whitespace inputs', () => {
      const emptyYt = validateUrlForPlatform('', 'youtube');
      expect(emptyYt.isValid).toBe(false);
      expect(emptyYt.error).toContain('Please enter a YouTube link');

      const spaceTt = validateUrlForPlatform('   ', 'tiktok');
      expect(spaceTt.isValid).toBe(false);
      expect(spaceTt.error).toContain('Please enter a TikTok link');
    });

    it('rejects malformed non-URL strings', () => {
      const res = validateUrlForPlatform('hello world', 'youtube');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Please enter a valid link');
    });

    it('rejects unsupported domains on all tabs', () => {
      expect(validateUrlForPlatform('https://vimeo.com/987654', 'youtube').isValid).toBe(false);
      expect(validateUrlForPlatform('https://vimeo.com/987654', 'tiktok').isValid).toBe(false);
      expect(validateUrlForPlatform('https://vimeo.com/987654', 'instagram').isValid).toBe(false);
    });
  });
});

