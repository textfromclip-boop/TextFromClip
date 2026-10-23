import { CloudflareBindings, TranscriptResult, TranscriptSegment } from '../../types';
import { generateSrt, generateVtt, unescapeHtml } from './formatters';
import { parseTikTokSubtitlePayload } from '../providers/tiktok';

export interface WhisperFallbackParams {
  provider: 'tiktok' | 'instagram' | string;
  videoId: string;
  videoTitle: string;
  videoDurationSeconds?: number;
  language: string;
  candidateMediaUrls: string[];
  mediaHeaders: Record<string, string>;
  env: CloudflareBindings;
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB Cloudflare Worker limit

/**
 * Group word-level Whisper timestamps into readable ~10-word segments
 */
function buildSegmentsFromWhisperWords(
  words: Array<{ word?: string; start?: number; end?: number }>
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let bucket: string[] = [];
  let bucketStart = 0;
  let bucketEnd = 0;

  const flush = () => {
    const text = unescapeHtml(bucket.join(' ').trim());
    if (text) {
      const start = Math.max(0, Number(bucketStart.toFixed(2)));
      const duration = Math.max(0.5, Number((bucketEnd - bucketStart).toFixed(2)));
      segments.push({
        id: segments.length + 1,
        start,
        duration,
        text,
      });
    }
    bucket = [];
  };

  for (const w of words) {
    const token = (w.word ?? '').trim();
    if (!token) continue;
    if (bucket.length === 0) {
      bucketStart = typeof w.start === 'number' ? w.start : bucketEnd;
    }
    bucket.push(token);
    bucketEnd = typeof w.end === 'number' ? w.end : bucketStart + 0.4;

    if (bucket.length >= 10 || /[.?!]$/.test(token)) {
      flush();
    }
  }
  flush();
  return segments;
}

/**
 * Split plain Whisper text into logical sentences with estimated timing
 */
function buildSegmentsFromPlainText(text: string): TranscriptSegment[] {
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => unescapeHtml(s.trim()))
    .filter((s) => s.length > 0);

  const segments: TranscriptSegment[] = [];
  let currentSec = 0;
  sentences.forEach((sentence, idx) => {
    const estDuration = Math.max(2.0, Math.min(10, sentence.split(/\s+/).length * 0.42));
    segments.push({
      id: idx + 1,
      start: Number(currentSec.toFixed(2)),
      duration: Number(estDuration.toFixed(2)),
      text: sentence,
    });
    currentSec += estDuration;
  });
  return segments;
}

/**
 * Transcribe a video/audio stream using Cloudflare Workers AI (@cf/openai/whisper)
 * or an optional external Whisper endpoint when native captions are unavailable.
 */
export async function transcribeMediaWithWhisper(
  params: WhisperFallbackParams
): Promise<TranscriptResult> {
  const {
    provider,
    videoId,
    videoTitle,
    videoDurationSeconds,
    language,
    candidateMediaUrls,
    mediaHeaders,
    env,
  } = params;

  const urls = candidateMediaUrls.filter((u) => typeof u === 'string' && u.startsWith('http'));
  if (urls.length === 0) {
    throw new Error(
      `No native captions or downloadable audio stream were found for this ${provider} video.`
    );
  }

  if (!env.AI && !env.EXTERNAL_WHISPER_URL) {
    throw new Error(
      `This ${provider} video has no native caption track, and Cloudflare Workers AI (env.AI) is not bound in this runtime to run Whisper audio fallback. Run with Cloudflare Workers AI enabled to transcribe captionless clips.`
    );
  }

  // Download the first accessible media stream
  let mediaBuffer: ArrayBuffer | null = null;
  let activeMediaUrl = urls[0];
  let lastDownloadError = '';

  for (const streamUrl of urls) {
    try {
      const res = await fetch(streamUrl, {
        headers: mediaHeaders,
        redirect: 'follow',
      });
      if (!res.ok) {
        lastDownloadError = `HTTP ${res.status}`;
        continue;
      }
      const contentLen = res.headers.get('content-length');
      if (contentLen && parseInt(contentLen, 10) > MAX_MEDIA_BYTES) {
        lastDownloadError = 'Media stream exceeds 25 MB Worker limit';
        continue;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_MEDIA_BYTES) {
        lastDownloadError = 'Media stream exceeds 25 MB Worker limit';
        continue;
      }
      if (buf.byteLength > 512) {
        mediaBuffer = buf;
        activeMediaUrl = streamUrl;
        break;
      }
    } catch (err: any) {
      lastDownloadError = err?.message || 'network error';
    }
  }

  // Option 1: Cloudflare Workers AI Whisper (@cf/openai/whisper)
  if (env.AI) {
    if (!mediaBuffer) {
      throw new Error(
        `Could not download audio stream for Whisper fallback (${lastDownloadError || 'stream blocked'}).`
      );
    }

    const uint8Array = new Uint8Array(mediaBuffer);
    const aiResponse = await env.AI.run('@cf/openai/whisper', {
      audio: [...uint8Array],
    });

    const transcribedText = (aiResponse?.text ?? '').trim();
    if (!transcribedText) {
      throw new Error('No speech was detected in the audio track of this video.');
    }

    let segments: TranscriptSegment[] = [];
    if (typeof aiResponse?.vtt === 'string' && aiResponse.vtt.trim()) {
      segments = parseTikTokSubtitlePayload(aiResponse.vtt);
    }
    if (segments.length === 0 && Array.isArray(aiResponse?.words) && aiResponse.words.length > 0) {
      segments = buildSegmentsFromWhisperWords(aiResponse.words);
    }
    if (segments.length === 0) {
      segments = buildSegmentsFromPlainText(transcribedText);
    }

    const computedDuration =
      videoDurationSeconds ||
      (segments.length > 0
        ? Math.ceil(segments[segments.length - 1].start + segments[segments.length - 1].duration)
        : 0);

    const fullText = segments.map((s) => s.text).join(' ').trim();

    return {
      id: crypto.randomUUID(),
      provider,
      videoId,
      videoTitle,
      videoDurationSeconds: computedDuration,
      sourceType: 'ai_whisper',
      language,
      segments,
      fullText,
      srt: generateSrt(segments),
      vtt: generateVtt(segments),
      createdAt: Date.now(),
    };
  }

  // Option 2: External serverless Whisper endpoint (if configured via EXTERNAL_WHISPER_URL)
  const extRes = await fetch(env.EXTERNAL_WHISPER_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: activeMediaUrl, language }),
  });

  if (!extRes.ok) {
    throw new Error(`External Whisper fallback returned HTTP ${extRes.status}.`);
  }

  const extJson = (await extRes.json()) as {
    text?: string;
    segments?: TranscriptSegment[];
  };
  const extText = (extJson?.text ?? '').trim();
  if (!extText) {
    throw new Error('External Whisper fallback detected no spoken words in the audio track.');
  }

  const segments =
    Array.isArray(extJson.segments) && extJson.segments.length > 0
      ? extJson.segments
      : buildSegmentsFromPlainText(extText);

  const fullText = segments.map((s) => s.text).join(' ').trim();

  return {
    id: crypto.randomUUID(),
    provider,
    videoId,
    videoTitle,
    videoDurationSeconds: videoDurationSeconds || 0,
    sourceType: 'ai_whisper',
    language,
    segments,
    fullText,
    srt: generateSrt(segments),
    vtt: generateVtt(segments),
    createdAt: Date.now(),
  };
}

