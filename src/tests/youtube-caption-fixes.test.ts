import { describe, it, expect, vi, afterEach } from 'vitest';
import { YouTubeProvider } from '../server/providers/youtube';

const SRV3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">
<body>
<p t="1200" d="2160">All right, so here we are, in front of the
elephants</p>
<p t="3500" d="500"></p>
<p t="5320" d="2000"><s>really</s><s t="300"> long &amp; thin</s></p>
</body></timedtext>`;

describe('YouTube caption format 3 (srv3) parser', () => {
  const provider = new YouTubeProvider() as any;

  it('converts millisecond times, joins wrapped lines and strips inner tags', () => {
    const segs = provider.parseSrv3Captions(SRV3);
    expect(segs).toHaveLength(2); // the empty <p> is dropped
    expect(segs[0]).toMatchObject({ start: 1.2, duration: 2.16 });
    expect(segs[0].text).toBe('All right, so here we are, in front of the elephants');
    expect(segs[1]).toMatchObject({ start: 5.32, text: 'really long & thin' });
  });
});

describe('YouTube availability detection', () => {
  afterEach(() => vi.restoreAllMocks());

  const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('does not treat the stray text "Video unavailable" on a healthy page as an error', async () => {
    // InnerTube route returns nothing usable -> provider falls back to the watch page,
    // which contains the UI string "Video unavailable" but a playabilityStatus of OK.
    const watchHtml =
      '<html><title>Demo - YouTube</title>"Video unavailable" "playabilityStatus":{"status":"OK"}' +
      '"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=x","languageCode":"en"}]</html>';
    const json3 = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'hello world' }] }] });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const u = String(input);
      if (u.includes('/youtubei/v1/player')) return respond({ playabilityStatus: { status: 'OK' } });
      if (u.includes('/watch?v=')) return new Response(watchHtml, { status: 200 });
      return new Response(json3, { status: 200 });
    });

    const result = await new YouTubeProvider().getTranscript(
      'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      'en',
      {} as any
    );
    expect(result.fullText).toBe('hello world');
  });

  it('reports a video as unavailable when the player status says so', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      respond({ playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } })
    );
    await expect(
      new YouTubeProvider().getTranscript('https://www.youtube.com/watch?v=aaaaaaaaaaa', 'en', {} as any)
    ).rejects.toThrow(/unavailable or private/i);
  });
});

