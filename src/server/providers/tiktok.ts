import { VideoProviderAdapter, ProviderCapability } from './base';
import { TranscriptResult, TranscriptSegment, CloudflareBindings } from '../../types';
import { unescapeHtml, generateSrt, generateVtt } from '../utils/formatters';
import { transcribeMediaWithWhisper } from '../utils/whisper-fallback';

const HONEST_USER_AGENT = 'Mozilla/5.0 (compatible; TextFromClip/1.0)';

export interface TikTokSubtitleInfo {
  Url?: string;
  Format?: string;
  LanguageCodeName?: string;
  LanguageID?: string;
  Source?: string;
}

/**
 * Parse a WebVTT timestamp ("00:01:02.340" or "01:02.340") into seconds
 */
export function parseVttTime(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const hrs = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    return hrs * 3600 + mins * 60 + secs;
  }
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    return mins * 60 + secs;
  }
  return NaN;
}

/**
 * Parse TikTok WebVTT content or JSON creator_caption content into TranscriptSegment[]
 */
export function parseTikTokSubtitlePayload(payload: string): TranscriptSegment[] {
  const trimmed = payload.trim();
  if (!trimmed) return [];

  // Handle JSON creator_caption format: {"utterances":[{"text":"...","start_time":80,"end_time":959}]}
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed?.utterances)) {
        const segments: TranscriptSegment[] = [];
        for (const u of parsed.utterances) {
          const text = unescapeHtml(String(u?.text ?? '').replace(/<[^>]+>/g, ' '));
          if (!text) continue;
          const startMs = Number(u?.start_time ?? 0);
          const endMs = Number(u?.end_time ?? startMs);
          const start = Math.max(0, Number((startMs / 1000).toFixed(3)));
          const duration = Math.max(0.1, Number(((endMs - startMs) / 1000).toFixed(3)));
          segments.push({
            id: 0,
            start,
            duration,
            text,
          });
        }
        segments.sort((a, b) => a.start - b.start);
        return segments.map((s, idx) => ({ ...s, id: idx + 1 }));
      }
    } catch {
      // Fall through to VTT parser if not valid JSON
    }
  }

  // Standard WebVTT parser
  const lines = trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const segments: TranscriptSegment[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for cue timing line: 00:00:00.120 --> 00:00:01.000
    if (line.includes('-->')) {
      const [startPart, endPartWithSettings] = line.split('-->');
      const endPart = (endPartWithSettings || '').trim().split(/\s+/)[0];
      const start = parseVttTime(startPart);
      const end = parseVttTime(endPart);

      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        textLines.push(lines[i].trim());
        i++;
      }

      if (!isNaN(start) && !isNaN(end)) {
        const rawText = textLines.join(' ').replace(/<[^>]+>/g, ' ');
        const cleanText = unescapeHtml(rawText);
        if (cleanText) {
          segments.push({
            id: segments.length + 1,
            start: Number(start.toFixed(3)),
            duration: Number(Math.max(0.1, end - start).toFixed(3)),
            text: cleanText,
          });
        }
      }
    } else {
      i++;
    }
  }

  return segments;
}

export class TikTokProvider implements VideoProviderAdapter {
  id = 'tiktok';
  name = 'TikTok';

  capabilities: ProviderCapability = {
    id: 'tiktok',
    name: 'TikTok Video Clips',
    supportsCaptions: true,
    supportsAiWhisper: true,
    exampleUrl: 'https://www.tiktok.com/@curiousitygeek/video/7649850716713913622',
  };

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === 'tiktok.com' ||
        host === 'www.tiktok.com' ||
        host === 'm.tiktok.com' ||
        host === 'vt.tiktok.com' ||
        host === 'vm.tiktok.com'
      );
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      const videoMatch = parsed.pathname.match(/\/(?:video|v)\/(\d+)/);
      if (videoMatch && videoMatch[1]) {
        return videoMatch[1];
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      return last ? last.replace(/\.html$/i, '') : null;
    } catch {
      return null;
    }
  }

  private rankSubtitleTracks(
    tracks: TikTokSubtitleInfo[],
    preferredLanguage: string
  ): TikTokSubtitleInfo[] {
    const validTracks = tracks.filter((t) => typeof t?.Url === 'string' && t.Url.startsWith('http'));
    if (validTracks.length === 0) return [];

    const pref = preferredLanguage.toLowerCase().split('-')[0];
    const langPrefixMap: Record<string, string[]> = {
      en: ['eng', 'en'],
      es: ['spa', 'es'],
      fr: ['fra', 'fre', 'fr'],
      de: ['deu', 'ger', 'de'],
      pt: ['por', 'pt'],
      it: ['ita', 'it'],
      ja: ['jpn', 'ja'],
      ko: ['kor', 'ko'],
      zh: ['zho', 'chi', 'zh', 'cmn'],
      ar: ['ara', 'ar'],
      ru: ['rus', 'ru'],
      hi: ['hin', 'hi'],
    };
    const prefixes = langPrefixMap[pref] || [pref];

    const matchesLang = (track: TikTokSubtitleInfo) => {
      const code = (track.LanguageCodeName || '').toLowerCase();
      return prefixes.some((p) => code === p || code.startsWith(`${p}-`) || code.startsWith(`${p}_`));
    };

    const isWebVtt = (track: TikTokSubtitleInfo) =>
      (track.Format || '').toLowerCase() === 'webvtt';

    return [...validTracks].sort((a, b) => {
      const aLang = matchesLang(a) ? 0 : 1;
      const bLang = matchesLang(b) ? 0 : 1;
      if (aLang !== bLang) return aLang - bLang;
      const aVtt = isWebVtt(a) ? 0 : 1;
      const bVtt = isWebVtt(b) ? 0 : 1;
      return aVtt - bVtt;
    });
  }

  async getTranscript(
    url: string,
    preferredLanguage: string = 'en',
    env: CloudflareBindings
  ): Promise<TranscriptResult> {
    const initialId = this.extractVideoId(url);
    if (!initialId) {
      throw new Error('Could not find a valid TikTok video ID in the link.');
    }

    let pageRes: Response;
    try {
      pageRes = await fetch(url, {
        headers: {
          'User-Agent': HONEST_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
    } catch (err: any) {
      throw new Error(`Failed to reach TikTok (${err?.message || 'network error'}).`);
    }

    if (!pageRes.ok) {
      throw new Error(`TikTok returned HTTP ${pageRes.status} when requesting the video page.`);
    }

    // Preserve session cookies (such as tt_chain_token) required if we need to download playAddr for Whisper
    const setCookies =
      (pageRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');

    const html = await pageRes.text();
    const rehydrationMatch = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i
    );

    if (!rehydrationMatch || !rehydrationMatch[1]) {
      if (html.includes('SlardarWAF') || html.includes('_wafchallengeid') || html.length < 5000) {
        throw new Error(
          'TikTok blocked this request with an automated-traffic challenge. We do not bypass bot protection.'
        );
      }
      throw new Error('TikTok did not return public video metadata for this link.');
    }

    let rehydrationData: any;
    try {
      rehydrationData = JSON.parse(rehydrationMatch[1]);
    } catch {
      throw new Error('Could not parse TikTok page metadata.');
    }

    const detail = rehydrationData?.__DEFAULT_SCOPE__?.['webapp.video-detail'];
    const statusCode = Number(detail?.statusCode ?? 0);
    const itemStruct = detail?.itemInfo?.itemStruct;

    if (!itemStruct) {
      if (statusCode === 10204 || statusCode === 10221) {
        throw new Error('This TikTok video is unavailable, deleted, or restricted in the server region.');
      }
      if (statusCode === 10216 || statusCode === 10222) {
        throw new Error('This TikTok video is private or restricted by the creator.');
      }
      throw new Error(
        `TikTok video metadata is unavailable${statusCode ? ` (status ${statusCode})` : ''}.`
      );
    }

    const videoId = String(itemStruct.id || this.extractVideoId(pageRes.url || url) || initialId);
    const authorHandle = itemStruct.author?.uniqueId ? `@${itemStruct.author.uniqueId}` : 'TikTok';
    const rawDesc = typeof itemStruct.desc === 'string' ? itemStruct.desc.trim() : '';
    const videoTitle = rawDesc
      ? `${authorHandle}: ${rawDesc.slice(0, 110)}${rawDesc.length > 110 ? '…' : ''}`
      : `${authorHandle} — TikTok video ${videoId}`;
    const durationSeconds = Number(itemStruct.video?.duration) || 0;

    // 1. Primary path: Native TikTok caption tracks (WebVTT / creator_caption JSON)
    const subtitleInfos: TikTokSubtitleInfo[] = Array.isArray(itemStruct.video?.subtitleInfos)
      ? itemStruct.video.subtitleInfos
      : [];

    const rankedTracks = this.rankSubtitleTracks(subtitleInfos, preferredLanguage);
    let segments: TranscriptSegment[] = [];
    let activeTrack: TikTokSubtitleInfo | null = null;

    for (const track of rankedTracks) {
      if (!track.Url) continue;
      try {
        const subRes = await fetch(track.Url, {
          headers: {
            'User-Agent': HONEST_USER_AGENT,
            Accept: 'text/vtt,application/json,text/plain,*/*',
          },
        });
        if (!subRes.ok) continue;
        const subtitlePayload = await subRes.text();
        const parsed = parseTikTokSubtitlePayload(subtitlePayload);
        if (parsed.length > 0 && parsed.some((s) => s.text.trim().length > 0)) {
          segments = parsed;
          activeTrack = track;
          break;
        }
      } catch {
        // Try next candidate track
      }
    }

    if (segments.length > 0 && activeTrack) {
      const fullText = segments.map((s) => s.text).join(' ').trim();
      const rawLang = activeTrack.LanguageCodeName || preferredLanguage || 'en';
      const language = rawLang.replace(/^eng\b/i, 'en').replace(/_/g, '-');

      return {
        id: crypto.randomUUID(),
        provider: 'tiktok',
        videoId,
        videoTitle,
        videoDurationSeconds: durationSeconds,
        sourceType: 'captions',
        language,
        segments,
        fullText,
        srt: generateSrt(segments),
        vtt: generateVtt(segments),
        createdAt: Date.now(),
      };
    }

    // 2. Fallback path: Cloudflare Workers AI Whisper (@cf/openai/whisper) when native captions are missing
    const candidateMediaUrls = [
      itemStruct.video?.playAddr,
      itemStruct.video?.downloadAddr,
      itemStruct.music?.original ? itemStruct.music?.playUrl : undefined,
    ].filter((u): u is string => typeof u === 'string' && u.startsWith('http'));

    if (candidateMediaUrls.length === 0 || (!env.AI && !env.EXTERNAL_WHISPER_URL)) {
      throw new Error(
        'No captions or subtitles were found on this TikTok video, and Cloudflare Workers AI (env.AI) is not active in this runtime to transcribe the raw audio track.'
      );
    }

    return transcribeMediaWithWhisper({
      provider: 'tiktok',
      videoId,
      videoTitle,
      videoDurationSeconds: durationSeconds,
      language: preferredLanguage,
      candidateMediaUrls,
      mediaHeaders: {
        'User-Agent': HONEST_USER_AGENT,
        Referer: 'https://www.tiktok.com/',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      env,
    });
  }
}
