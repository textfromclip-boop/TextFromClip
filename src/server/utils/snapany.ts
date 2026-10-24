export interface SnapAnySubtitleTrack {
  languageName: string;
  languageTag: string;
  json3Url?: string;
  vttUrl?: string;
  srtUrl?: string;
}

export interface SnapAnyMediaResult {
  title?: string;
  author?: string;
  authorUsername?: string;
  cover?: string;
  durationSeconds?: number;
  subtitles: SnapAnySubtitleTrack[];
  audioUrls: string[];
  videoUrls: string[];
}

const SNAPANY_API_URL = 'https://api.snapany.com/openapi/v1/extract/post';
const SNAPANY_YT_PROXY_URL = 'https://api.snapany.com/openapi/v1/youtube/proxy-download';

// Default key provided by administrator if not injected in env
export const DEFAULT_SNAPANY_KEY = 'sk_snapany_1e1edxpzly6nlcd2icd6g3pk424xeisd';

function parseSnapAnyPayload(data: any): SnapAnyMediaResult | null {
  if (!data || typeof data !== 'object') return null;

  const audioUrls: string[] = [];
  const videoUrls: string[] = [];
  const subtitles: SnapAnySubtitleTrack[] = [];
  let cover: string | undefined = typeof data.cover === 'string' ? data.cover : undefined;
  let durationSeconds: number | undefined;

  if (Array.isArray(data.medias)) {
    for (const m of data.medias) {
      if (!m || typeof m !== 'object') continue;

      if (!cover && typeof m.preview_url === 'string' && m.preview_url.startsWith('http')) {
        cover = m.preview_url;
      }
      if (durationSeconds === undefined && typeof m.duration === 'number' && m.duration > 0) {
        durationSeconds = Math.round(m.duration);
      }

      // Collect subtitles if available (e.g. YouTube)
      if (Array.isArray(m.subtitles)) {
        for (const sub of m.subtitles) {
          if (!sub || !Array.isArray(sub.urls)) continue;
          const track: SnapAnySubtitleTrack = {
            languageName: sub.language_name || sub.language_tag || 'en',
            languageTag: sub.language_tag || 'en',
          };
          for (const u of sub.urls) {
            if (!u || typeof u.url !== 'string') continue;
            if (u.format === 'json3') track.json3Url = u.url;
            else if (u.format === 'vtt') track.vttUrl = u.url;
            else if (u.format === 'srt') track.srtUrl = u.url;
          }
          if (track.json3Url || track.vttUrl || track.srtUrl) {
            subtitles.push(track);
          }
        }
      }

      // Prefer proxied URL if present, then direct resource_url
      const primaryUrl = m.resource_proxy_url || m.proxy_url || m.resource_url || m.url;
      if (typeof primaryUrl === 'string' && primaryUrl.startsWith('http')) {
        if (m.media_type === 'audio') {
          audioUrls.push(primaryUrl);
        } else if (m.media_type === 'video') {
          videoUrls.push(primaryUrl);
        }
      }
    }
  }

  // Extract author string safely (SnapAny returns an object { username, display_name, id })
  let author: string | undefined;
  let authorUsername: string | undefined;
  if (typeof data.author === 'string') {
    author = data.author;
    authorUsername = data.author;
  } else if (data.author && typeof data.author === 'object') {
    authorUsername = typeof data.author.username === 'string' ? data.author.username : undefined;
    author =
      (typeof data.author.display_name === 'string' && data.author.display_name) ||
      authorUsername ||
      undefined;
  }

  // Extract title or caption text
  let title: string | undefined;
  if (typeof data.title === 'string' && data.title.trim()) {
    title = data.title.trim();
  } else if (typeof data.text === 'string' && data.text.trim()) {
    const cleanText = data.text.trim().replace(/\s+/g, ' ');
    title = cleanText.length > 110 ? `${cleanText.slice(0, 110)}…` : cleanText;
  }

  if (audioUrls.length === 0 && videoUrls.length === 0 && subtitles.length === 0) {
    return null;
  }

  return {
    title,
    author,
    authorUsername,
    cover,
    durationSeconds,
    subtitles,
    audioUrls,
    videoUrls,
  };
}

export async function extractMediaWithSnapAny(
  url: string,
  apiKey?: string
): Promise<SnapAnyMediaResult | null> {
  const key = apiKey || DEFAULT_SNAPANY_KEY;
  if (!key) return null;

  const headers = {
    Authorization: `Bearer ${key.trim()}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(SNAPANY_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let errJson: any = null;
    try {
      errJson = JSON.parse(errText);
    } catch {}

    if (errJson?.code === 'insufficient_credits') {
      throw new Error(
        'Media extraction credits exhausted on SnapAny. Please top up your SnapAny account balance.'
      );
    }
    return null;
  }

  const data: any = await res.json();
  return parseSnapAnyPayload(data);
}

/**
 * Specifically calls SnapAny's YouTube proxy-download endpoint (4 credits / 10 min)
 * when a YouTube video has no captions and needs proxied audio stream for Whisper AI.
 */
export async function extractYouTubeProxyWithSnapAny(
  url: string,
  apiKey?: string
): Promise<SnapAnyMediaResult | null> {
  const key = apiKey || DEFAULT_SNAPANY_KEY;
  if (!key) return null;

  try {
    const res = await fetch(SNAPANY_YT_PROXY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) return null;
    const data: any = await res.json();
    return parseSnapAnyPayload(data);
  } catch {
    return null;
  }
}
