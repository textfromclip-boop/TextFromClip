import { describe, it, expect, vi, afterEach } from 'vitest';
import { TikTokProvider, parseTikTokSubtitlePayload, parseVttTime } from '../server/providers/tiktok';
import { InstagramProvider } from '../server/providers/instagram';

describe('TikTokProvider, InstagramProvider & Whisper Fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses WebVTT timestamps accurately', () => {
    expect(parseVttTime('00:00:01.250')).toBeCloseTo(1.25, 3);
    expect(parseVttTime('01:02.500')).toBeCloseTo(62.5, 3);
  });

  it('parses standard TikTok WebVTT cues into timestamped segments', () => {
    const sampleVtt = `WEBVTT

00:00:00.120 --> 00:00:01.000
No. 1

00:00:01.000 --> 00:00:02.400
In 1902, billionaire

00:00:02.920 --> 00:00:04.240
founded the modern schooling system`;

    const segments = parseTikTokSubtitlePayload(sampleVtt);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({
      id: 1,
      start: 0.12,
      duration: 0.88,
      text: 'No. 1',
    });
    expect(segments[2].text).toBe('founded the modern schooling system');
  });

  it('parses TikTok JSON creator_caption utterances into sorted timestamped segments', () => {
    const sampleJson = JSON.stringify({
      utterances: [
        { text: 'thank you for watching', start_time: 1000, end_time: 2500 },
        { text: 'hello I need your help', start_time: 80, end_time: 959 },
      ],
    });

    const segments = parseTikTokSubtitlePayload(sampleJson);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      id: 1,
      start: 0.08,
      duration: 0.879,
      text: 'hello I need your help',
    });
    expect(segments[1]).toEqual({
      id: 2,
      start: 1,
      duration: 1.5,
      text: 'thank you for watching',
    });
  });

  it('automatically falls back to Cloudflare Workers AI Whisper when a TikTok video has no captions', async () => {
    const provider = new TikTokProvider();
    const htmlWithNoSubs = `<!DOCTYPE html><html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusCode: 0,
          itemInfo: {
            itemStruct: {
              id: '7492494709290552606',
              desc: 'Captionless spoken clip',
              author: { uniqueId: 'hankgreen1' },
              video: {
                duration: 12,
                playAddr: 'https://v16-webapp-prime.tiktok.com/video/tos/sample.mp4',
                subtitleInfos: [],
              },
            },
          },
        },
      },
    })}</script></body></html>`;

    const fakeMp4Bytes = new Uint8Array(1024);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(htmlWithNoSubs, { status: 200 }))
      .mockResolvedValueOnce(new Response(fakeMp4Bytes, { status: 200 }));

    const mockAi = {
      run: vi.fn().mockResolvedValue({
        text: 'This is spoken audio transcribed by Cloudflare Workers AI Whisper.',
        words: [
          { word: 'This', start: 0.1, end: 0.3 },
          { word: 'is', start: 0.3, end: 0.5 },
          { word: 'spoken', start: 0.5, end: 0.9 },
          { word: 'audio', start: 0.9, end: 1.3 },
          { word: 'transcribed', start: 1.3, end: 1.9 },
          { word: 'by', start: 1.9, end: 2.1 },
          { word: 'Cloudflare', start: 2.1, end: 2.6 },
          { word: 'Workers', start: 2.6, end: 3.0 },
          { word: 'AI', start: 3.0, end: 3.2 },
          { word: 'Whisper.', start: 3.2, end: 3.8 },
        ],
      }),
    };

    const result = await provider.getTranscript(
      'https://www.tiktok.com/@hankgreen1/video/7492494709290552606',
      'en',
      { AI: mockAi }
    );

    expect(mockAi.run).toHaveBeenCalledWith('@cf/openai/whisper', expect.any(Object));
    expect(result.provider).toBe('tiktok');
    expect(result.sourceType).toBe('ai_whisper');
    expect(result.fullText).toContain('Cloudflare Workers AI Whisper');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].start).toBeCloseTo(0.1, 2);
  });

  it('rejects honestly when a TikTok video has no captions and env.AI is not bound', async () => {
    const provider = new TikTokProvider();
    const htmlWithNoSubs = `<!DOCTYPE html><html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusCode: 0,
          itemInfo: {
            itemStruct: {
              id: '7106594312292453675',
              desc: 'Silent clip',
              author: { uniqueId: 'tiktok' },
              video: { duration: 15, subtitleInfos: [] },
            },
          },
        },
      },
    })}</script></body></html>`;

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(htmlWithNoSubs, { status: 200 })
    );

    await expect(
      provider.getTranscript('https://www.tiktok.com/@tiktok/video/7106594312292453675', 'en', {})
    ).rejects.toThrow(/No captions or subtitles were found on this TikTok video/i);
  });

  it('InstagramProvider extracts video_url from GraphQL/?__a=1 and runs Whisper fallback when env.AI is bound', async () => {
    const igProvider = new InstagramProvider();
    const igJsonPayload = {
      data: {
        xdt_shortcode_media: {
          id: '3300000000',
          shortcode: 'C1234567890',
          is_video: true,
          video_duration: 18,
          video_url: 'https://scontent.cdninstagram.com/v/t50.2886-16/sample.mp4',
          owner: { username: 'creator' },
          edge_media_to_caption: {
            edges: [{ node: { text: 'Sample Instagram Reel description' } }],
          },
        },
      },
    };

    const fakeMp4Bytes = new Uint8Array(1024);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(igJsonPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response(fakeMp4Bytes, { status: 200 }));

    const mockAi = {
      run: vi.fn().mockResolvedValue({
        text: 'Spoken words inside the Instagram Reel.',
      }),
    };

    const result = await igProvider.getTranscript(
      'https://www.instagram.com/reel/C1234567890/',
      'en',
      { AI: mockAi }
    );

    expect(result.provider).toBe('instagram');
    expect(result.sourceType).toBe('ai_whisper');
    expect(result.videoTitle).toContain('@creator: Sample Instagram Reel description');
    expect(result.fullText).toBe('Spoken words inside the Instagram Reel.');
  });
});
