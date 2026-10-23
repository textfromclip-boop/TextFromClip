import { VideoProviderAdapter, ProviderCapability } from './base';
import { TranscriptResult, TranscriptSegment, CloudflareBindings } from '../../types';
import { unescapeHtml, generateSrt, generateVtt } from '../utils/formatters';

export class YouTubeProvider implements VideoProviderAdapter {
  id = 'youtube';
  name = 'YouTube';

  capabilities: ProviderCapability = {
    id: 'youtube',
    name: 'YouTube',
    supportsCaptions: true,
    supportsAiWhisper: true,
    exampleUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  };

  /**
   * Check if URL matches YouTube domain
   */
  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'youtu.be' ||
        host === 'music.youtube.com'
      );
    } catch {
      return false;
    }
  }

  /**
   * Extract YouTube 11-char video ID from various URL patterns:
   * - https://www.youtube.com/watch?v=abc12345678
   * - https://youtu.be/abc12345678
   * - https://www.youtube.com/shorts/abc12345678
   * - https://www.youtube.com/embed/abc12345678
   */
  extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      if (host === 'youtu.be') {
        const id = parsed.pathname.slice(1).split('/')[0];
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }

      if (host.includes('youtube.com')) {
        // Handle /watch?v=ID
        if (parsed.pathname === '/watch') {
          const v = parsed.searchParams.get('v');
          return v && /^[a-zA-Z0-9_-]{11}$/.test(v) ? v : null;
        }

        // Handle /shorts/ID or /embed/ID
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        if (pathParts[0] === 'shorts' || pathParts[0] === 'embed') {
          const id = pathParts[1];
          return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Main retrieval pipeline for YouTube
   */
  async getTranscript(
    url: string,
    preferredLanguage: string = 'en',
    _env: CloudflareBindings
  ): Promise<TranscriptResult> {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error('Invalid YouTube video link or missing video ID.');
    }

    // 0. Preferred path: YouTube's app (InnerTube) API. The web watch page now
    //    hands out caption URLs that return an empty body unless a proof-of-origin
    //    token is attached, so the app endpoint is the reliable source today.
    //    Falls through to the watch-page scrape below if it gives us nothing.
    const viaApp = await this.getViaInnerTube(videoId, preferredLanguage);
    if (viaApp) return viaApp;

    // 1. Fetch YouTube video watch page to retrieve caption tracks & video metadata
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const watchRes = await fetch(watchUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!watchRes.ok) {
      throw new Error(`Failed to access YouTube video (HTTP ${watchRes.status}). The video may be private, restricted, or deleted.`);
    }

    const html = await watchRes.text();

    // Check availability from the player's own status. (Searching the page for
    // the text "Video unavailable" is wrong: that string is part of YouTube's
    // embedded UI strings and is present on every watch page.)
    const playability = html.match(/"playabilityStatus":\s*\{\s*"status":\s*"([A-Z_]+)"/);
    const playabilityStatus = playability ? playability[1] : 'OK';
    if (playabilityStatus === 'LOGIN_REQUIRED') {
      throw new Error(
        'YouTube asked for sign-in (age-restricted, members-only, or a bot check). This video cannot be read without logging in.'
      );
    }
    if (playabilityStatus === 'ERROR' || playabilityStatus === 'UNPLAYABLE') {
      throw new Error('This YouTube video is unavailable or private.');
    }

    // Extract title from HTML
    let videoTitle = 'YouTube Video';
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      videoTitle = unescapeHtml(titleMatch[1].replace(/ - YouTube$/, ''));
    }

    // Extract caption track list from embedded player response
    const captionTracks = this.extractCaptionTracks(html);

    let captionData = '';
    let selectedLang = preferredLanguage;
    let captionFormat: 'xml' | 'json3' = 'xml';

    if (captionTracks && captionTracks.length > 0) {
      // Find track matching preferred language, or fallback to first available
      let track = captionTracks.find(
        (t) => t.languageCode === preferredLanguage || t.languageCode.startsWith(preferredLanguage)
      );
      if (!track) {
        track = captionTracks.find((t) => t.languageCode === 'en' || t.languageCode.startsWith('en'));
      }
      if (!track) {
        track = captionTracks[0];
      }

      selectedLang = track.languageCode;
      const trackUrl = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`;

      const capRes = await fetch(trackUrl, {
        headers: { 'User-Agent': userAgent },
      });

      if (capRes.ok) {
        captionData = await capRes.text();
        captionFormat = trackUrl.includes('fmt=json3') ? 'json3' : 'xml';
      }
    }

    // Fallback: direct timedtext endpoint if embedded track was not found
    if (!captionData) {
      const directTimedTextUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${preferredLanguage}&fmt=json3`;
      const directRes = await fetch(directTimedTextUrl, {
        headers: { 'User-Agent': userAgent },
      });
      if (directRes.ok) {
        const text = await directRes.text();
        if (text && text.trim().length > 0 && !text.includes('error')) {
          captionData = text;
          captionFormat = 'json3';
        }
      }
    }

    // If still no caption data found, try XML format
    if (!captionData) {
      const xmlTimedTextUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${preferredLanguage}`;
      const xmlRes = await fetch(xmlTimedTextUrl, {
        headers: { 'User-Agent': userAgent },
      });
      if (xmlRes.ok) {
        const text = await xmlRes.text();
        if (text && text.trim().startsWith('<transcript>')) {
          captionData = text;
          captionFormat = 'xml';
        }
      }
    }

    if (!captionData) {
      throw new Error(
        'No captions or subtitles found for this YouTube video. The creator has not enabled captions, and auto-generated captions are not available for this clip.'
      );
    }

    // Parse captions into standardized segments
    let segments: TranscriptSegment[] = [];
    if (captionFormat === 'json3') {
      try {
        segments = this.parseJson3Captions(captionData);
      } catch {
        segments = this.parseXmlCaptions(captionData);
      }
    } else {
      segments = this.parseXmlCaptions(captionData);
    }

    if (!segments || segments.length === 0) {
      throw new Error('Unable to extract readable transcript lines from the caption track.');
    }

    // Compute duration & full text
    const lastSeg = segments[segments.length - 1];
    const duration = Math.ceil(lastSeg.start + lastSeg.duration);
    const fullText = segments.map((s) => s.text).join(' ');
    const srt = generateSrt(segments);
    const vtt = generateVtt(segments);

    // Crypto-random unguessable job ID
    const jobId = crypto.randomUUID();

    return {
      id: jobId,
      provider: 'youtube',
      videoId,
      videoTitle,
      videoDurationSeconds: duration,
      sourceType: 'captions',
      language: selectedLang,
      segments,
      fullText,
      srt,
      vtt,
      createdAt: Date.now(),
    };
  }

  /**
   * Fetch captions through the InnerTube "player" endpoint using the Android client.
   * Returns null when this route yields nothing usable (caller falls back to the
   * watch-page scrape); throws only when YouTube says the video is unavailable.
   */
  private async getViaInnerTube(
    videoId: string,
    preferredLanguage: string
  ): Promise<TranscriptResult | null> {
    const VERSION = '20.10.38';
    const appUa = `com.google.android.youtube/${VERSION} (Linux; U; Android 11) gzip`;

    let player: any;
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': appUa,
          'X-YouTube-Client-Name': '3',
          'X-YouTube-Client-Version': VERSION,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: VERSION,
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) return null;
      player = await res.json();
    } catch {
      return null;
    }

    const status: string | undefined = player?.playabilityStatus?.status;
    if (status === 'ERROR' || status === 'UNPLAYABLE') {
      throw new Error('This YouTube video is unavailable or private.');
    }
    if (status !== 'OK') return null; // e.g. LOGIN_REQUIRED: let the fallback try

    const tracks: Array<{ baseUrl: string; languageCode: string; kind?: string }> =
      player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (tracks.length === 0) return null;

    // Pick the language; within it, prefer creator-written over auto-generated (asr).
    const byLang = (pred: (code: string) => boolean) => {
      const matches = tracks.filter((t) => pred(t.languageCode));
      return matches.find((t) => t.kind !== 'asr') ?? matches[0];
    };
    const track =
      byLang((c) => c === preferredLanguage || c.startsWith(preferredLanguage)) ??
      byLang((c) => c === 'en' || c.startsWith('en')) ??
      tracks[0];

    let payload = '';
    try {
      const capRes = await fetch(track.baseUrl, { headers: { 'User-Agent': appUa } });
      if (capRes.ok) payload = await capRes.text();
    } catch {
      return null;
    }
    if (!payload.trim()) return null;

    let segments: TranscriptSegment[] = [];
    try {
      if (payload.trimStart().startsWith('{')) segments = this.parseJson3Captions(payload);
      else if (payload.includes('<timedtext')) segments = this.parseSrv3Captions(payload);
      else segments = this.parseXmlCaptions(payload);
    } catch {
      return null;
    }
    if (segments.length === 0) return null;

    const lastSeg = segments[segments.length - 1];
    const declared = parseInt(player?.videoDetails?.lengthSeconds ?? '', 10);

    return {
      id: crypto.randomUUID(),
      provider: 'youtube',
      videoId,
      videoTitle: player?.videoDetails?.title || 'YouTube Video',
      videoDurationSeconds: Number.isFinite(declared) && declared > 0
        ? declared
        : Math.ceil(lastSeg.start + lastSeg.duration),
      sourceType: 'captions',
      language: track.languageCode,
      segments,
      fullText: segments.map((s) => s.text).join(' '),
      srt: generateSrt(segments),
      vtt: generateVtt(segments),
      createdAt: Date.now(),
    };
  }

  /**
   * Parse YouTube's current timed-text format (format="3"):
   * <timedtext format="3"><body><p t="1200" d="2160">text</p>...</body></timedtext>
   * Times are in milliseconds; inner <s> tags carry per-word timing and are dropped.
   */
  private parseSrv3Captions(xml: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    const regex = /<p\s+([^>]*)>([\s\S]*?)<\/p>/gi;
    let match: RegExpExecArray | null;
    let idCounter = 1;

    while ((match = regex.exec(xml)) !== null) {
      const attrs = match[1];
      const t = attrs.match(/\bt="(\d+)"/);
      if (!t) continue;
      const d = attrs.match(/\bd="(\d+)"/);

      const text = unescapeHtml(match[2].replace(/<[^>]*>/g, '').replace(/\n/g, ' ')).trim();
      if (!text) continue;

      segments.push({
        id: idCounter++,
        start: parseFloat((parseInt(t[1], 10) / 1000).toFixed(2)),
        duration: parseFloat(((d ? parseInt(d[1], 10) : 2000) / 1000).toFixed(2)),
        text,
      });
    }
    return segments;
  }

  /**
   * Extract captionTracks array from YouTube watch page HTML
   */
  private extractCaptionTracks(html: string): Array<{ baseUrl: string; languageCode: string; name?: string }> {
    try {
      const regex = /"captionTracks":\s*(\[.*?\])/;
      const match = html.match(regex);
      if (match && match[1]) {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) {
          return parsed.map((item: any) => ({
            baseUrl: item.baseUrl,
            languageCode: item.languageCode || 'en',
            name: item.name?.simpleText || item.languageCode,
          }));
        }
      }
    } catch {
      // Ignore JSON parse errors
    }
    return [];
  }

  /**
   * Parse YouTube JSON3 timed text format
   */
  private parseJson3Captions(rawJson: string): TranscriptSegment[] {
    const data = JSON.parse(rawJson);
    const events = data.events || [];
    const segments: TranscriptSegment[] = [];
    let idCounter = 1;

    for (const ev of events) {
      if (!ev.segs || !Array.isArray(ev.segs)) continue;

      const text = ev.segs
        .map((s: any) => s.utf8 || '')
        .join('')
        .replace(/\n/g, ' ')
        .trim();

      if (!text) continue;

      const start = (ev.tStartMs || 0) / 1000;
      const duration = (ev.dDurationMs || 2000) / 1000;

      segments.push({
        id: idCounter++,
        start: parseFloat(start.toFixed(2)),
        duration: parseFloat(duration.toFixed(2)),
        text: unescapeHtml(text),
      });
    }

    return segments;
  }

  /**
   * Parse YouTube XML timed text format:
   * <transcript><text start="1.23" dur="4.56">hello world</text></transcript>
   */
  private parseXmlCaptions(xml: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    const regex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
    let match: RegExpExecArray | null;
    let idCounter = 1;

    while ((match = regex.exec(xml)) !== null) {
      const start = parseFloat(match[1]) || 0;
      const dur = match[2] ? parseFloat(match[2]) : 2.0;
      const rawText = match[3] || '';
      // Strip any inner xml tags like <font color="...">
      const cleanText = unescapeHtml(rawText.replace(/<[^>]*>/g, '')).trim();

      if (cleanText) {
        segments.push({
          id: idCounter++,
          start: parseFloat(start.toFixed(2)),
          duration: parseFloat(dur.toFixed(2)),
          text: cleanText,
        });
      }
    }

    return segments;
  }
}

