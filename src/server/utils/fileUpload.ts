import { TranscriptResult, TranscriptSegment } from '../../types';
import { generateSrt, generateVtt, unescapeHtml } from './formatters';
import { parseTikTokSubtitlePayload } from '../providers/tiktok';
import { looksLikeWhisperHallucination } from './whisper-fallback';

export const MAX_CHUNK_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB per chunk
export const MIN_CHUNK_UPLOAD_BYTES = 128; // Minimum valid audio/video header + frame
export const MAX_UPLOAD_CHUNKS = 10; // Up to 10 chunks (~30 minutes of 16 kHz mono WAV audio)

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  'wav',
  'mp3',
  'm4a',
  'mp4',
  'webm',
  'ogg',
  'aac',
  'mov',
  'flac',
  'mpeg',
  'mkv',
]);

export const VALID_R2_KEY_REGEX = /^uploads\/[0-9]{10,15}-[a-f0-9-]{8,36}\.[a-z0-9]{2,5}$/;

export function isValidR2UploadKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length <= 120 &&
    !key.includes('..') &&
    VALID_R2_KEY_REGEX.test(key)
  );
}

export function extractSafeExtension(fileName?: string): string {
  if (!fileName || typeof fileName !== 'string') return 'wav';
  const parts = fileName.trim().toLowerCase().split('.');
  if (parts.length < 2) return 'wav';
  const ext = parts[parts.length - 1].replace(/[^a-z0-9]/g, '');
  return ALLOWED_UPLOAD_EXTENSIONS.has(ext) ? ext : 'wav';
}

export function buildUploadR2Key(fileName?: string): string {
  const ext = extractSafeExtension(fileName);
  return `uploads/${Date.now()}-${crypto.randomUUID()}.${ext}`;
}

export function cleanFileTitle(fileName?: string): string {
  if (!fileName || typeof fileName !== 'string') return 'Uploaded Media';
  const base = fileName
    .trim()
    .replace(/^.*[\\/]/, '')
    .replace(/\.[a-zA-Z0-9]{2,5}$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base ? base.slice(0, 200) : 'Uploaded Media';
}

export function validateUploadChunkPayload(
  byteLength: number,
  fileName?: string
): { valid: boolean; code?: string; message?: string } {
  if (!Number.isFinite(byteLength) || byteLength < MIN_CHUNK_UPLOAD_BYTES) {
    return {
      valid: false,
      code: 'EMPTY_FILE',
      message: 'The uploaded audio/video chunk is empty or too small to contain speech.',
    };
  }
  if (byteLength > MAX_CHUNK_UPLOAD_BYTES) {
    return {
      valid: false,
      code: 'FILE_TOO_LARGE',
      message: `Upload chunk exceeds the ${Math.round(MAX_CHUNK_UPLOAD_BYTES / (1024 * 1024))} MB per-chunk limit.`,
    };
  }
  if (fileName && typeof fileName === 'string' && fileName.includes('.')) {
    const rawExt = fileName.trim().toLowerCase().split('.').pop() || '';
    if (rawExt && !ALLOWED_UPLOAD_EXTENSIONS.has(rawExt)) {
      return {
        valid: false,
        code: 'UNSUPPORTED_FILE_TYPE',
        message: `Unsupported file format (.${rawExt}). Supported formats: MP4, MOV, WEBM, MKV, MP3, WAV, M4A, OGG, AAC, FLAC.`,
      };
    }
  }
  return { valid: true };
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const NodeBuffer = (globalThis as any).Buffer;
  if (typeof NodeBuffer !== 'undefined' && typeof NodeBuffer.from === 'function') {
    return NodeBuffer.from(buffer).toString('base64');
  }
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, sub as unknown as number[]));
  }
  return btoa(chunks.join(''));
}

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

function extractSegmentsFromWhisperResponse(aiResponse: any, transcribedText: string): TranscriptSegment[] {
  if (Array.isArray(aiResponse?.segments) && aiResponse.segments.length > 0) {
    const parsed: TranscriptSegment[] = [];
    for (const seg of aiResponse.segments) {
      const text = unescapeHtml(String(seg?.text ?? '').trim());
      if (!text) continue;
      const start = typeof seg?.start === 'number' && Number.isFinite(seg.start) ? Math.max(0, seg.start) : 0;
      const end =
        typeof seg?.end === 'number' && Number.isFinite(seg.end) && seg.end > start
          ? seg.end
          : start + Math.max(1.5, text.split(/\s+/).length * 0.4);
      parsed.push({
        id: parsed.length + 1,
        start: Number(start.toFixed(2)),
        duration: Number(Math.max(0.5, end - start).toFixed(2)),
        text,
      });
    }
    if (parsed.length > 0) return parsed;
  }

  if (typeof aiResponse?.vtt === 'string' && aiResponse.vtt.trim()) {
    const vttSegments = parseTikTokSubtitlePayload(aiResponse.vtt);
    if (vttSegments.length > 0) return vttSegments;
  }

  if (Array.isArray(aiResponse?.words) && aiResponse.words.length > 0) {
    const wordSegments = buildSegmentsFromWhisperWords(aiResponse.words);
    if (wordSegments.length > 0) return wordSegments;
  }

  return buildSegmentsFromPlainText(transcribedText);
}

export async function runWhisperOnAudioBuffer(
  ai: any,
  buffer: ArrayBuffer
): Promise<{ text: string; segments: TranscriptSegment[]; detectedLanguage?: string }> {
  let aiResponse: any;
  try {
    const base64Audio = arrayBufferToBase64(buffer);
    aiResponse = await ai.run('@cf/openai/whisper-large-v3-turbo', {
      audio: base64Audio,
      task: 'transcribe',
      vad_filter: true,
    });
  } catch {
    // Fallback to standard @cf/openai/whisper (accepts number[] array)
    const uint8Array = new Uint8Array(buffer);
    aiResponse = await ai.run('@cf/openai/whisper', {
      audio: [...uint8Array],
    });
  }

  const text = String(aiResponse?.text ?? '').trim();
  const segments = text ? extractSegmentsFromWhisperResponse(aiResponse, text) : [];
  const detectedLanguage =
    typeof aiResponse?.transcription_info?.language === 'string' &&
    aiResponse.transcription_info.language.trim()
      ? aiResponse.transcription_info.language.trim()
      : undefined;

  return { text, segments, detectedLanguage };
}

export interface TranscribeUploadedChunksParams {
  bucket: R2Bucket;
  ai: any;
  keys: string[];
  chunkOffsetsSec?: number[];
  fileName?: string;
  videoDurationSeconds?: number;
  preferredLanguage?: string;
}

export async function transcribeUploadedChunksFromR2(
  params: TranscribeUploadedChunksParams
): Promise<TranscriptResult> {
  const {
    bucket,
    ai,
    keys,
    chunkOffsetsSec = [],
    fileName,
    videoDurationSeconds,
    preferredLanguage = 'en',
  } = params;

  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('No uploaded file was received. Please choose a file and try again.');
  }
  if (keys.length > MAX_UPLOAD_CHUNKS) {
    throw new Error('This recording is too long to process in one go. Please upload a clip under 30 minutes.');
  }
  for (const key of keys) {
    if (!isValidR2UploadKey(key)) {
      throw new Error('Invalid upload reference. Please select your file and try again.');
    }
  }

  try {
    const allSegments: TranscriptSegment[] = [];
    let cumulativeOffsetSec = 0;
    let detectedLang: string | undefined;
    let hadHallucinationOnly = false;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const obj = await bucket.get(key);
      if (!obj) {
        throw new Error(
          'Your upload session expired or the temporary file was already removed. Please choose the file again.'
        );
      }

      const buffer = await obj.arrayBuffer();
      if (buffer.byteLength < MIN_CHUNK_UPLOAD_BYTES) {
        continue;
      }

      const { text, segments, detectedLanguage } = await runWhisperOnAudioBuffer(ai, buffer);
      if (detectedLanguage && !detectedLang) {
        detectedLang = detectedLanguage;
      }

      if (!text) {
        continue;
      }

      if (looksLikeWhisperHallucination(text)) {
        hadHallucinationOnly = true;
        continue;
      }

      const chunkOffset =
        typeof chunkOffsetsSec[i] === 'number' &&
        Number.isFinite(chunkOffsetsSec[i]) &&
        chunkOffsetsSec[i] >= 0
          ? chunkOffsetsSec[i]
          : cumulativeOffsetSec;

      for (const seg of segments) {
        allSegments.push({
          id: allSegments.length + 1,
          start: Number((seg.start + chunkOffset).toFixed(2)),
          duration: seg.duration,
          text: seg.text,
        });
      }

      if (segments.length > 0) {
        const lastSeg = segments[segments.length - 1];
        cumulativeOffsetSec = Math.max(
          cumulativeOffsetSec,
          chunkOffset + lastSeg.start + lastSeg.duration
        );
      }
    }

    if (allSegments.length === 0) {
      if (hadHallucinationOnly) {
        throw new Error(
          'This file has no clear speech (music, noise, or background sound only), so there is nothing reliable to transcribe.'
        );
      }
      throw new Error('No spoken words were detected in the uploaded file.');
    }

    const computedDuration =
      typeof videoDurationSeconds === 'number' &&
      Number.isFinite(videoDurationSeconds) &&
      videoDurationSeconds > 0
        ? Math.round(videoDurationSeconds)
        : Math.ceil(
            allSegments[allSegments.length - 1].start +
              allSegments[allSegments.length - 1].duration
          );

    const fullText = allSegments.map((s) => s.text).join(' ').trim();
    const jobId = crypto.randomUUID();

    return {
      id: jobId,
      provider: 'file_upload',
      videoId: `upload_${jobId.slice(0, 8)}`,
      videoTitle: cleanFileTitle(fileName),
      videoDurationSeconds: computedDuration,
      channelTitle: 'Uploaded File',
      sourceType: 'ai_whisper',
      language: detectedLang || preferredLanguage || 'en',
      segments: allSegments,
      fullText,
      srt: generateSrt(allSegments),
      vtt: generateVtt(allSegments),
      createdAt: Date.now(),
    };
  } finally {
    // Always delete temporary R2 objects immediately after transcription completes or fails
    await Promise.allSettled(keys.map((key) => bucket.delete(key)));
  }
}

