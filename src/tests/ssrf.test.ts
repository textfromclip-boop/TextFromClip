import { describe, it, expect } from 'vitest';
import { validateSafeUrl } from '../server/utils/ssrf';

describe('SSRF Protection & URL Validation', () => {
  it('allows safe public HTTPS URLs', () => {
    const res = validateSafeUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    expect(res.isValid).toBe(true);
    expect(res.normalizedUrl).toBe('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  });

  it('rejects loopback and localhost addresses', () => {
    expect(validateSafeUrl('http://localhost:80/evil').isValid).toBe(false);
    expect(validateSafeUrl('http://127.0.0.1/evil').isValid).toBe(false);
    expect(validateSafeUrl('http://0.0.0.0/evil').isValid).toBe(false);
  });

  it('rejects RFC1918 private IPv4 ranges', () => {
    expect(validateSafeUrl('http://192.168.1.1/video.mp4').isValid).toBe(false);
    expect(validateSafeUrl('http://10.0.0.5/video.mp4').isValid).toBe(false);
    expect(validateSafeUrl('http://172.16.0.10/video.mp4').isValid).toBe(false);
  });

  it('rejects cloud metadata link-local endpoints', () => {
    expect(validateSafeUrl('http://169.254.169.254/latest/meta-data/').isValid).toBe(false);
    expect(validateSafeUrl('http://metadata.google.internal/computeMetadata/v1/').isValid).toBe(false);
  });

  it('rejects non-HTTP protocols', () => {
    expect(validateSafeUrl('file:///etc/passwd').isValid).toBe(false);
    expect(validateSafeUrl('ftp://example.com/video.mp4').isValid).toBe(false);
    expect(validateSafeUrl('gopher://example.com').isValid).toBe(false);
  });

  it('rejects URLs with embedded credentials', () => {
    expect(validateSafeUrl('https://admin:secret@youtube.com/watch?v=123').isValid).toBe(false);
  });

  it('rejects non-standard ports', () => {
    expect(validateSafeUrl('https://example.com:8443/video.mp4').isValid).toBe(false);
    expect(validateSafeUrl('http://example.com:22/video.mp4').isValid).toBe(false);
  });
});
