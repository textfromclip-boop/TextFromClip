import { VideoProviderAdapter, ProviderCapability } from './base';
import { TranscriptResult, CloudflareBindings } from '../../types';
import { unescapeHtml } from '../utils/formatters';
import { transcribeMediaWithWhisper } from '../utils/whisper-fallback';

const HONEST_USER_AGENT = 'Mozilla/5.0 (compatible; TextFromClip/1.0)';

/**
 * What we read from a public Reel page.
 * NOTE: `postCaption` is the text the author typed under the video. It is NOT
 * the spoken audio and is only ever used to build a title, never a transcript.
 */
export interface InstagramPublicMedia {
  shortcode: string;
  audioUrl: string | null;
  videoUrls: string[];
  durationSeconds: number;
  username: string | null;
  postCaption: string | null;
}

/** Parse an ISO-8601 duration such as "PT0H0M30.5S" into seconds. */
export function parseIsoDuration(value: string | undefined | null): number {
  if (!value) return 0;
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value.trim());
  if (!m) return 0;
  return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
}

/** Decode the contents of a JSON string literal (without surrounding quotes). */
function decodeJsonString(raw: string): string | null {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return null;
  }
}

/**
 * Extract the Reel's own media from the public page HTML.
 * Returns null when the page is a login wall or carries no media.
 */
export function parseInstagramReelPage(html: string, shortcode: string): InstagramPublicMedia | null {
  // 1. Audio-only track from the page's own DASH manifest (small AAC stream).
  let audioUrl: string | null = null;
  let durationSeconds = 0;
  const manifestMatch = /"video_dash_manifest":"((?:[^"\\]|\\.)*)"/.exec(html);
  if (manifestMatch) {
    const mpd = decodeJsonString(manifestMatch[1]);
    if (mpd) {
      durationSeconds = parseIsoDuration(/mediaPresentationDuration="([^"]+)"/.exec(mpd)?.[1]);
      const sets = [...mpd.matchAll(/<AdaptationSet([^>]*)>([\s\S]*?)<\/AdaptationSet>/g)];
      const audioSet = sets.find((s) => /contentType="audio"/.test(s[1]));
      const base = audioSet ? /<BaseURL>([^<]+)<\/BaseURL>/.exec(audioSet[2])?.[1] : undefined;
      if (base) audioUrl = unescapeHtmlUrl(base);
    }
  }

  // 2. Progressive video files, used only as a fallback if there is no audio track URL.
  const videoUrls: string[] = [];
  const vv = /"video_versions":\[((?:\{[^{}]*\},?)+)\]/.exec(html);
  if (vv) {
    for (const m of vv[1].matchAll(/"url":"((?:[^"\\]|\\.)*)"/g)) {
      const decoded = decodeJsonString(m[1]);
      if (decoded && decoded.startsWith('http')) videoUrls.push(decoded);
    }
  }

  if (!audioUrl && videoUrls.length === 0) return null;

  const ogTitle = /property="og:title"\s+content="([^"]*)"/i.exec(html)?.[1];
  const username = ogTitle ? /^(.+?) on Instagram/.exec(unescapeHtml(ogTitle))?.[1] ?? null : null;
  const captionMatch = ogTitle ? /on Instagram:\s*["“]?([\s\S]*?)["”]?$/.exec(unescapeHtml(ogTitle)) : null;

  return {
    shortcode,
    audioUrl,
    videoUrls,
    durationSeconds,
    username,
    postCaption: captionMatch?.[1]?.trim() || null,
  };
}

function unescapeHtmlUrl(u: string): string {
  return u.replace(/&amp;/g, '&');
}

export class InstagramProvider implements VideoProviderAdapter {
  id = 'instagram';
  name = 'Instagram Reels';

  capabilities: ProviderCapability = {
    id: 'instagram',
    name: 'Instagram Reels',
    supportsCaptions: false,
    supportsAiWhisper: true,
    exampleUrl: 'https://www.instagram.com/reel/DH3tWudxIKB/',
  };

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'instagram.com' || host === 'www.instagram.com';
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const match = new URL(url).pathname.match(/\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  async getTranscript(
    url: string,
    preferredLanguage: string = 'en',
    env: CloudflareBindings
  ): Promise<TranscriptResult> {
    const shortcode = this.extractVideoId(url);
    if (!shortcode) {
      throw new Error('Could not find a valid Instagram Reel link. Use a link like instagram.com/reel/XXXX/.');
    }

    if (!env.AI && !env.EXTERNAL_WHISPER_URL) {
      throw new Error(
        'Instagram Reels have no caption track, so they need speech recognition, and Cloudflare Workers AI is not available in this runtime.'
      );
    }

    // Public page only. No login, no cookies, no impersonated browser.
    let html: string;
    try {
      const res = await fetch(`https://www.instagram.com/reel/${shortcode}/`, {
        headers: {
          'User-Agent': HONEST_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      if (res.status === 429) {
        throw new Error(
          'Instagram is limiting requests from our hosting provider right now (HTTP 429). Wait a minute and try again. This is not a problem with your link.'
        );
      }
      if (!res.ok) {
        throw new Error(`Instagram returned HTTP ${res.status} for this Reel.`);
      }
      html = await res.text();
    } catch (err: any) {
      throw new Error(err?.message || 'Could not reach Instagram.');
    }

    const media = parseInstagramReelPage(html, shortcode);
    if (!media) {
      throw new Error(
        'Instagram did not show this Reel to an anonymous visitor (it asks for a login). The Reel may be private, age-restricted, removed, or Instagram is limiting our server. We do not log in or work around that.'
      );
    }

    const author = media.username ? media.username : 'Instagram';
    const videoTitle = media.postCaption
      ? `${author}: ${media.postCaption.slice(0, 110)}${media.postCaption.length > 110 ? '…' : ''}`
      : `${author} — Instagram Reel ${shortcode}`;

    // Prefer the tiny audio-only stream; fall back to the smallest-first video files.
    const candidateMediaUrls = [media.audioUrl, ...media.videoUrls].filter(
      (u): u is string => typeof u === 'string' && u.length > 0
    );

    return transcribeMediaWithWhisper({
      provider: 'instagram',
      videoId: shortcode,
      videoTitle,
      videoDurationSeconds: media.durationSeconds,
      language: preferredLanguage,
      candidateMediaUrls,
      mediaHeaders: { 'User-Agent': HONEST_USER_AGENT },
      env,
    });
  }
}
