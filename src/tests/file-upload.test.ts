import { describe, it, expect } from 'vitest';
import app from '../server/index';
import {
  buildUploadR2Key,
  isValidR2UploadKey,
  validateUploadChunkPayload,
  cleanFileTitle,
} from '../server/utils/fileUpload';
import {
  encodeMonoPcm16Wav,
  splitSamplesIntoWavChunks,
  validateSelectedMediaFile,
} from '../utils/audioExtractor';
import { validateUrlForPlatform } from '../utils/validation';

function createMockR2Bucket() {
  const store = new Map<string, ArrayBuffer>();
  const deletedKeys: string[] = [];

  const bucket = {
    store,
    deletedKeys,
    async put(key: string, value: ArrayBuffer | Uint8Array) {
      const buf =
        value instanceof ArrayBuffer
          ? value
          : (value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
      store.set(key, buf);
      return { key, size: buf.byteLength };
    },
    async get(key: string) {
      const buf = store.get(key);
      if (!buf) return null;
      return {
        key,
        size: buf.byteLength,
        async arrayBuffer() {
          return buf;
        },
      };
    },
    async head(key: string) {
      const buf = store.get(key);
      return buf ? { key, size: buf.byteLength } : null;
    },
    async delete(key: string) {
      deletedKeys.push(key);
      store.delete(key);
    },
  };

  return bucket;
}

describe('R2 File Upload & Whisper Transcription Pipeline', () => {
  it('encodes 16 kHz mono Float32 samples into a valid RIFF WAVE PCM16 buffer and splits chunks accurately', () => {
    // 4 seconds of 16 kHz audio = 64,000 samples
    const sampleRate = 16000;
    const samples = new Float32Array(sampleRate * 4);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
    }

    const wav = encodeMonoPcm16Wav(samples, sampleRate);
    expect(wav.byteLength).toBe(44 + samples.length * 2);

    const view = new DataView(wav);
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    expect(riff).toBe('RIFF');
    expect(wave).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1); // Mono
    expect(view.getUint32(24, true)).toBe(16000); // 16 kHz
    expect(view.getUint16(34, true)).toBe(16); // 16-bit PCM

    // Split into 2-second chunks
    const chunks = splitSamplesIntoWavChunks(samples, sampleRate, 2, 'my_lecture.mp4');
    expect(chunks.length).toBe(2);
    expect(chunks[0].startOffsetSec).toBe(0);
    expect(chunks[0].durationSec).toBe(2);
    expect(chunks[0].fileName).toBe('my_lecture_part1.wav');
    expect(chunks[1].startOffsetSec).toBe(2);
    expect(chunks[1].durationSec).toBe(2);
    expect(chunks[1].fileName).toBe('my_lecture_part2.wav');
  });

  it('validates client-side selected media files and server-side R2 keys', () => {
    expect(
      validateSelectedMediaFile({ name: 'interview.mp4', size: 50 * 1024 * 1024, type: 'video/mp4' }).valid
    ).toBe(true);
    expect(
      validateSelectedMediaFile({ name: 'empty.mp3', size: 0, type: 'audio/mpeg' }).valid
    ).toBe(false);
    expect(
      validateSelectedMediaFile({ name: 'huge.mov', size: 250 * 1024 * 1024, type: 'video/quicktime' }).valid
    ).toBe(false);
    expect(
      validateSelectedMediaFile({ name: 'malware.exe', size: 4096, type: 'application/octet-stream' }).valid
    ).toBe(false);

    const key = buildUploadR2Key('My_Podcast-Episode_01.mp3');
    expect(isValidR2UploadKey(key)).toBe(true);
    expect(isValidR2UploadKey('../etc/passwd')).toBe(false);
    expect(isValidR2UploadKey('uploads/bad..key.wav')).toBe(false);
    expect(cleanFileTitle('C:\\fakepath\\My_Podcast-Episode_01.mp3')).toBe('My Podcast Episode 01');

    expect(validateUploadChunkPayload(10, 'clip.wav').valid).toBe(false);
    expect(validateUploadChunkPayload(25 * 1024 * 1024, 'clip.wav').valid).toBe(false);
    expect(validateUploadChunkPayload(4096, 'script.exe').valid).toBe(false);
    expect(validateUploadChunkPayload(4096, 'clip.wav').valid).toBe(true);
  });

  it('validates URLs on the /upload platform tab', () => {
    expect(validateUrlForPlatform('https://cdn.example.com/audio.mp3', 'upload').isValid).toBe(true);
    const ytMismatch = validateUrlForPlatform('https://www.youtube.com/watch?v=jNQXAC9IVRw', 'upload');
    expect(ytMismatch.isValid).toBe(false);
    expect(ytMismatch.error).toContain('YouTube');
  });

  it('stores audio chunks via POST /api/upload/chunk and transcribes + deletes R2 objects via POST /api/upload/transcribe', async () => {
    const mockR2 = createMockR2Bucket();
    const whisperCalls: Array<{ model: string; input: any }> = [];

    const mockEnv = {
      UPLOADS_BUCKET: mockR2 as any,
      AI: {
        async run(model: string, input: any) {
          whisperCalls.push({ model, input });
          return {
            text: 'Welcome to this uploaded clip. Every temporary chunk is cleaned up immediately.',
            segments: [
              { start: 0, end: 3.5, text: 'Welcome to this uploaded clip.' },
              { start: 3.5, end: 7.2, text: 'Every temporary chunk is cleaned up immediately.' },
            ],
            transcription_info: { language: 'en', duration: 7.2 },
          };
        },
      },
    };

    // 1. Check /api/health reports hasR2: true
    const healthRes = await app.request('/api/health', { method: 'GET' }, mockEnv as any);
    const healthJson: any = await healthRes.json();
    expect(healthJson.hasR2).toBe(true);

    // 2. Upload 2 WAV chunks to /api/upload/chunk
    const samples = new Float32Array(16000); // 1 sec of 16 kHz audio
    const wavBuffer = encodeMonoPcm16Wav(samples, 16000);

    const upRes1 = await app.request(
      '/api/upload/chunk?fileName=lecture_part1.wav',
      {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wavBuffer,
      },
      mockEnv as any
    );
    expect(upRes1.status).toBe(200);
    const upJson1: any = await upRes1.json();
    expect(upJson1.success).toBe(true);
    expect(isValidR2UploadKey(upJson1.data.key)).toBe(true);

    const upRes2 = await app.request(
      '/api/upload/chunk?fileName=lecture_part2.wav',
      {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wavBuffer,
      },
      mockEnv as any
    );
    expect(upRes2.status).toBe(200);
    const upJson2: any = await upRes2.json();
    expect(upJson2.success).toBe(true);

    // Verify both chunks exist in R2 before transcription
    expect(mockR2.store.size).toBe(2);

    // 3. Transcribe both chunks with offset [0, 180]
    const transRes = await app.request(
      '/api/upload/transcribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: [upJson1.data.key, upJson2.data.key],
          chunkOffsetsSec: [0, 180],
          fileName: 'Keynote_Presentation.mp4',
          videoDurationSeconds: 188,
        }),
      },
      mockEnv as any
    );

    expect(transRes.status).toBe(200);
    const transJson: any = await transRes.json();
    expect(transJson.success).toBe(true);
    expect(transJson.data.provider).toBe('file_upload');
    expect(transJson.data.sourceType).toBe('ai_whisper');
    expect(transJson.data.videoTitle).toBe('Keynote Presentation');
    expect(transJson.data.segments.length).toBe(4);
    expect(transJson.data.segments[0].start).toBe(0);
    expect(transJson.data.segments[2].start).toBe(180);
    expect(transJson.data.segments[3].start).toBe(183.5);
    expect(transJson.data.srt).toContain('00:03:00,000');

    // Verify Whisper turbo was called with base64 audio
    expect(whisperCalls.length).toBe(2);
    expect(whisperCalls[0].model).toBe('@cf/openai/whisper-large-v3-turbo');
    expect(typeof whisperCalls[0].input.audio).toBe('string');

    // Verify R2 chunks were immediately deleted in finally{}!
    expect(mockR2.store.size).toBe(0);
    expect(mockR2.deletedKeys).toEqual([upJson1.data.key, upJson2.data.key]);
  });

  it('always deletes temporary R2 chunks in finally{} even when Whisper transcription fails', async () => {
    const mockR2 = createMockR2Bucket();
    const samples = new Float32Array(16000);
    const wavBuffer = encodeMonoPcm16Wav(samples, 16000);
    const key = buildUploadR2Key('silent.wav');
    await mockR2.put(key, wavBuffer);
    expect(mockR2.store.size).toBe(1);

    const mockEnv = {
      UPLOADS_BUCKET: mockR2 as any,
      AI: {
        async run() {
          return { text: '' }; // Empty speech -> triggers error
        },
      },
    };

    const res = await app.request(
      '/api/upload/transcribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: [key],
          fileName: 'silent.wav',
        }),
      },
      mockEnv as any
    );

    expect(res.status).toBe(422);
    const json: any = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UPLOAD_TRANSCRIPTION_FAILED');

    // R2 object must still be deleted immediately even on failure!
    expect(mockR2.store.size).toBe(0);
    expect(mockR2.deletedKeys).toContain(key);
  });
});

