import { describe, it, expect } from 'vitest';
import { YouTubeProvider } from '../server/providers/youtube';

describe('YouTube Provider Adapter', () => {
  const provider = new YouTubeProvider();

  it('correctly matches valid YouTube URLs', () => {
    expect(provider.matches('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(provider.matches('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(provider.matches('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(provider.matches('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
    expect(provider.matches('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });

  it('rejects non-YouTube URLs', () => {
    expect(provider.matches('https://vimeo.com/123456')).toBe(false);
    expect(provider.matches('https://example.com/video.mp4')).toBe(false);
    expect(provider.matches('https://fakeyoutube.com/watch?v=123')).toBe(false);
  });

  it('extracts 11-char video IDs from various URL formats', () => {
    expect(provider.extractVideoId('https://www.youtube.com/watch?v=jNQXAC9IVRw')).toBe('jNQXAC9IVRw');
    expect(provider.extractVideoId('https://youtu.be/jNQXAC9IVRw')).toBe('jNQXAC9IVRw');
    expect(provider.extractVideoId('https://www.youtube.com/shorts/jNQXAC9IVRw')).toBe('jNQXAC9IVRw');
    expect(provider.extractVideoId('https://www.youtube.com/embed/jNQXAC9IVRw')).toBe('jNQXAC9IVRw');
  });

  it('returns null for malformed or missing video IDs', () => {
    expect(provider.extractVideoId('https://www.youtube.com/watch?v=short')).toBe(null);
    expect(provider.extractVideoId('https://www.youtube.com/')).toBe(null);
  });

  it('parses timedtext XML format accurately into segments', () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="0.12" dur="2.45">Welcome to TextFromClip</text>
  <text start="2.57" dur="3.10">Turn video clips &amp; audio into text</text>
</transcript>`;

    // Access private XML parser through any casting for unit testing
    const segments = (provider as any).parseXmlCaptions(mockXml);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      id: 1,
      start: 0.12,
      duration: 2.45,
      text: 'Welcome to TextFromClip',
    });
    expect(segments[1]).toEqual({
      id: 2,
      start: 2.57,
      duration: 3.10,
      text: 'Turn video clips & audio into text',
    });
  });

  it('parses timedtext JSON3 format into segments', () => {
    const mockJson = JSON.stringify({
      events: [
        {
          tStartMs: 0,
          dDurationMs: 2500,
          segs: [{ utf8: 'First line of ' }, { utf8: 'transcript.' }],
        },
        {
          tStartMs: 2500,
          dDurationMs: 3000,
          segs: [{ utf8: 'Second line here.' }],
        },
      ],
    });

    const segments = (provider as any).parseJson3Captions(mockJson);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe('First line of transcript.');
    expect(segments[0].start).toBe(0);
    expect(segments[0].duration).toBe(2.5);
    expect(segments[1].text).toBe('Second line here.');
    expect(segments[1].start).toBe(2.5);
    expect(segments[1].duration).toBe(3);
  });
});

