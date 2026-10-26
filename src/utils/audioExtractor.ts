import { ApiResponse, TranscriptResult } from '../types';

export const MAX_RAW_FILE_BYTES = 200 * 1024 * 1024; // 200 MB client-side input file limit
export const MAX_DIRECT_FALLBACK_BYTES = 20 * 1024 * 1024; // 20 MB fallback when browser cannot decode
export const TARGET_SAMPLE_RATE = 16000; // 16 kHz mono for Whisper
export const CHUNK_DURATION_SECONDS = 180; // 3-minute chunks (~5.5 MB per 16 kHz mono WAV chunk)
export const MAX_AUDIO_CHUNKS = 10; // Up to 30 minutes total audio

export const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'webm',
  'mkv',
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'aac',
  'flac',
  'mpeg',
]);

export interface ExtractedAudioChunk {
  buffer: ArrayBuffer;
  fileName: string;
  mimeType: string;
  startOffsetSec: number;
  durationSec: number;
}

export interface ExtractedAudioResult {
  chunks: ExtractedAudioChunk[];
  totalDurationSeconds: number;
}

export function validateSelectedMediaFile(file: {
  name: string;
  size: number;
  type?: string;
}): { valid: boolean; error?: string } {
  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    return { valid: false, error: 'The selected file is empty.' };
  }

  if (file.size > MAX_RAW_FILE_BYTES) {
    return {
      valid: false,
      error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 200 MB maximum limit.`,
    };
  }

  const ext = (file.name || '').trim().toLowerCase().split('.').pop() || '';
  const mime = (file.type || '').toLowerCase();
  const isAudioOrVideoMime = mime.startsWith('audio/') || mime.startsWith('video/');

  if (!SUPPORTED_MEDIA_EXTENSIONS.has(ext) && !isAudioOrVideoMime) {
    return {
      valid: false,
      error:
        'Unsupported file type. Please choose an audio or video file (MP4, MOV, WEBM, MKV, MP3, WAV, M4A, OGG, AAC, or FLAC).',
    };
  }

  return { valid: true };
}

/**
 * Encode mono Float32 PCM samples (-1.0..1.0) into a 16-bit PCM RIFF WAVE ArrayBuffer.
 */
export function encodeMonoPcm16Wav(
  samples: Float32Array,
  sampleRate: number = TARGET_SAMPLE_RATE
): ArrayBuffer {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataByteLength = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF identifier
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, 'WAVE');

  // fmt sub-chunk
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true); // NumChannels = 1 (mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * bytesPerSample, true); // ByteRate
  view.setUint16(32, bytesPerSample, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample = 16

  // data sub-chunk
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Split 16 kHz mono Float32 samples into 180-second WAV chunks with exact startOffsetSec.
 */
export function splitSamplesIntoWavChunks(
  samples: Float32Array,
  sampleRate: number = TARGET_SAMPLE_RATE,
  chunkDurationSec: number = CHUNK_DURATION_SECONDS,
  baseName: string = 'audio'
): ExtractedAudioChunk[] {
  const samplesPerChunk = Math.max(sampleRate, Math.floor(sampleRate * chunkDurationSec));
  const totalChunks = Math.min(
    MAX_AUDIO_CHUNKS,
    Math.max(1, Math.ceil(samples.length / samplesPerChunk))
  );

  const safeBase =
    baseName
      .replace(/\.[a-zA-Z0-9]{2,5}$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50) || 'audio';

  const chunks: ExtractedAudioChunk[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const startSample = i * samplesPerChunk;
    const endSample = Math.min(samples.length, startSample + samplesPerChunk);
    if (endSample <= startSample) break;

    const slice = samples.subarray(startSample, endSample);
    const wavBuffer = encodeMonoPcm16Wav(slice, sampleRate);
    const startOffsetSec = Number((startSample / sampleRate).toFixed(2));
    const durationSec = Number(((endSample - startSample) / sampleRate).toFixed(2));

    chunks.push({
      buffer: wavBuffer,
      fileName: `${safeBase}_part${i + 1}.wav`,
      mimeType: 'audio/wav',
      startOffsetSec,
      durationSec,
    });
  }

  return chunks;
}

/**
 * Downmix multi-channel AudioBuffer and resample to 16 kHz mono Float32Array.
 */
async function resampleAudioBufferTo16kMono(audioBuffer: AudioBuffer): Promise<Float32Array> {
  const targetLength = Math.max(1, Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE));

  const OfflineCtx =
    typeof window !== 'undefined'
      ? window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
      : undefined;

  if (OfflineCtx) {
    try {
      const offlineCtx = new OfflineCtx(1, targetLength, TARGET_SAMPLE_RATE);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);
      const rendered: AudioBuffer = await offlineCtx.startRendering();
      return rendered.getChannelData(0);
    } catch {
      // Fallback to linear interpolation below if OfflineAudioContext fails
    }
  }

  // Linear interpolation fallback
  const numChannels = audioBuffer.numberOfChannels;
  const srcLength = audioBuffer.length;
  const monoSource = new Float32Array(srcLength);

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < srcLength; i++) {
      monoSource[i] += channelData[i] / numChannels;
    }
  }

  if (audioBuffer.sampleRate === TARGET_SAMPLE_RATE) {
    return monoSource;
  }

  const out = new Float32Array(targetLength);
  const ratio = (srcLength - 1) / Math.max(1, targetLength - 1);
  for (let i = 0; i < targetLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(srcLength - 1, idx0 + 1);
    const frac = srcIdx - idx0;
    out[i] = monoSource[idx0] * (1 - frac) + monoSource[idx1] * frac;
  }
  return out;
}

/**
 * Extract 16 kHz mono WAV chunks from a user-selected audio or video File in the browser.
 * Falls back to direct binary upload if the file is <= 20 MB and browser decoding fails.
 */
export async function extractAudioChunksFromFile(
  file: File,
  onProgress?: (stage: string) => void
): Promise<ExtractedAudioResult> {
  const check = validateSelectedMediaFile(file);
  if (!check.valid) {
    throw new Error(check.error || 'Invalid media file.');
  }

  onProgress?.('Reading media file…');
  const rawBuffer = await file.arrayBuffer();

  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as any).webkitAudioContext
      : undefined;

  if (AudioCtx) {
    const ctx = new AudioCtx();
    try {
      onProgress?.('Extracting 16 kHz audio track in browser…');
      // Clone slice because decodeAudioData detaches the input ArrayBuffer in some browsers
      const decoded: AudioBuffer = await ctx.decodeAudioData(rawBuffer.slice(0));
      const monoSamples = await resampleAudioBufferTo16kMono(decoded);
      const chunks = splitSamplesIntoWavChunks(
        monoSamples,
        TARGET_SAMPLE_RATE,
        CHUNK_DURATION_SECONDS,
        file.name
      );

      if (chunks.length > 0) {
        return {
          chunks,
          totalDurationSeconds: Math.round(decoded.duration),
        };
      }
    } catch {
      // Fall through to raw binary fallback if <= 20 MB
    } finally {
      try {
        await ctx.close();
      } catch {
        // ignore
      }
    }
  }

  if (rawBuffer.byteLength <= MAX_DIRECT_FALLBACK_BYTES) {
    return {
      chunks: [
        {
          buffer: rawBuffer,
          fileName: file.name || 'upload.mp4',
          mimeType: file.type || 'application/octet-stream',
          startOffsetSec: 0,
          durationSec: 0,
        },
      ],
      totalDurationSeconds: 0,
    };
  }

  throw new Error(
    'Your browser could not decode the audio track from this file container, and the raw file exceeds 20 MB. Please convert the file to MP4, MP3, WAV, or M4A, or upload a smaller clip.'
  );
}

/**
 * Complete end-to-end client workflow:
 * 1. Extract 16 kHz mono WAV chunks locally in the browser
 * 2. Upload temporary chunks to Cloudflare R2 (/api/upload/chunk)
 * 3. Run Workers AI Whisper transcription & immediate R2 cleanup (/api/upload/transcribe)
 */
export async function uploadAndTranscribeMediaFile(
  file: File,
  options?: {
    preferredLanguage?: string;
    onProgress?: (stage: string) => void;
  }
): Promise<TranscriptResult> {
  const onProgress = options?.onProgress;
  const { chunks, totalDurationSeconds } = await extractAudioChunksFromFile(file, onProgress);

  const uploadedKeys: string[] = [];
  const chunkOffsetsSec: number[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const partLabel = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
    onProgress?.(`Uploading audio to R2${partLabel}…`);

    const uploadRes = await fetch(
      `/api/upload/chunk?fileName=${encodeURIComponent(chunk.fileName)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': chunk.mimeType || 'audio/wav',
          'X-File-Name': chunk.fileName,
        },
        body: chunk.buffer,
      }
    );

    let uploadJson: ApiResponse<{ key: string; sizeBytes: number }>;
    try {
      uploadJson = await uploadRes.json();
    } catch {
      throw new Error(`Upload failed with HTTP ${uploadRes.status}.`);
    }

    if (!uploadRes.ok || !uploadJson.success) {
      const msg = !uploadJson.success
        ? uploadJson.error.message
        : `Upload failed with HTTP ${uploadRes.status}.`;
      throw new Error(msg);
    }

    uploadedKeys.push(uploadJson.data.key);
    chunkOffsetsSec.push(chunk.startOffsetSec);
  }

  onProgress?.('Transcribing speech with AI Whisper…');

  const transcribeRes = await fetch('/api/upload/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      keys: uploadedKeys,
      chunkOffsetsSec,
      fileName: file.name,
      videoDurationSeconds: totalDurationSeconds || undefined,
      preferredLanguage: options?.preferredLanguage || 'en',
    }),
  });

  let transcribeJson: ApiResponse<TranscriptResult>;
  try {
    transcribeJson = await transcribeRes.json();
  } catch {
    throw new Error(`Transcription request failed with HTTP ${transcribeRes.status}.`);
  }

  if (!transcribeRes.ok || !transcribeJson.success) {
    const msg = !transcribeJson.success
      ? transcribeJson.error.message
      : `Transcription failed with HTTP ${transcribeRes.status}.`;
    throw new Error(msg);
  }

  return transcribeJson.data;
}

