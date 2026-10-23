import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  InstagramProvider,
  parseInstagramReelPage,
  parseIsoDuration,
} from '../server/providers/instagram';

const MPD =
  '<MPD mediaPresentationDuration="PT0H0M39.2S"><Period>' +
  '<AdaptationSet id="0" contentType="video"><Representation bandwidth="900000" codecs="avc1.64001f">' +
  '<BaseURL>https://cdn.example/video.mp4?a=1&amp;b=2</BaseURL></Representation></AdaptationSet>' +
  '<AdaptationSet id="1" contentType="audio"><Representation bandwidth="57960" codecs="mp4a.40.5">' +
  '<BaseURL>https://cdn.example/audio.mp4?a=1&amp;b=2</BaseURL></Representation></AdaptationSet>' +
  '</Period></MPD>';

function pageHtml(opts: { manifest?: boolean; versions?: boolean } = { manifest: true, versions: true }) {
  const parts = ['<html><head><meta property="og:title" content="NASA on Instagram: &quot;Asteroid facts&quot;"></head><body><script>'];
  if (opts.manifest) parts.push(`{"video_dash_manifest":${JSON.stringify(MPD)},`);
  if (opts.versions) {
    parts.push('"video_versions":[{"type":101,"url":"https:\\/\\/cdn.example\\/full.mp4?x=1\\u0026y=2"}],');
  }
  parts.push('"end":1}</script></body></html>');
  return parts.join('');
}

describe('Instagram Reel page parser', () => {
  it('parses ISO durations', () => {
    expect(parseIsoDuration('PT0H0M39.2S')).toBe(39);
    expect(parseIsoDuration('PT1M5S')).toBe(65);
    expect(parseIsoDuration(undefined)).toBe(0);
  });

  it('extracts the audio-only stream, duration and author from a public page', () => {
    const media = parseInstagramReelPage(pageHtml(), 'ABC123');
    expect(media?.audioUrl).toBe('https://cdn.example/audio.mp4?a=1&b=2');
    expect(media?.videoUrls).toEqual(['https://cdn.example/full.mp4?x=1&y=2']);
    expect(media?.durationSeconds).toBe(39);
    expect(media?.username).toBe('NASA');
  });

  it('returns null for a login wall that has no media', () => {
    expect(parseInstagramReelPage('<html>Login • Instagram</html>', 'ABC123')).toBeNull();
  });
});

describe('InstagramProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('transcribes the audio track with Whisper and never uses the post caption as the transcript', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const u = String(input);
      calls.push(u);
      if (u.includes('instagram.com/reel/')) return new Response(pageHtml(), { status: 200 });
      return new Response(new Uint8Array(2048), { status: 200 });
    });
    const ai = { run: vi.fn().mockResolvedValue({ text: 'Spoken words from the audio.' }) };

    const result = await new InstagramProvider().getTranscript(
      'https://www.instagram.com/reel/ABC123/',
      'en',
      { AI: ai } as any
    );

    expect(ai.run).toHaveBeenCalledWith('@cf/openai/whisper', expect.any(Object));
    expect(result.sourceType).toBe('ai_whisper');
    expect(result.fullText).toBe('Spoken words from the audio.');
    expect(result.fullText).not.toContain('Asteroid facts'); // the caption
    expect(result.videoTitle).toContain('Asteroid facts'); // caption is title only
    // audio-only stream was fetched first, not the big video file
    expect(calls[1]).toContain('audio.mp4');
  });

  it('fails honestly on a login wall instead of inventing text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Login • Instagram</html>', { status: 200 })
    );
    const ai = { run: vi.fn() };
    await expect(
      new InstagramProvider().getTranscript('https://www.instagram.com/reel/ABC123/', 'en', { AI: ai } as any)
    ).rejects.toThrow(/did not show this Reel to an anonymous visitor/i);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('refuses honestly when Workers AI is not bound', async () => {
    await expect(
      new InstagramProvider().getTranscript('https://www.instagram.com/reel/ABC123/', 'en', {} as any)
    ).rejects.toThrow(/Workers AI is not available/i);
  });
});

