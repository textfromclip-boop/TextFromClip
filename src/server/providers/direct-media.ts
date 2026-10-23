import { VideoProviderAdapter, ProviderCapability } from './base';
import { TranscriptResult, TranscriptSegment, CloudflareBindings } from '../../types';
import { generateSrt, generateVtt } from '../utils/formatters';
import { validateSafeUrl } from '../utils/ssrf';

export class DirectMediaProvider implements VideoProviderAdapter {
  id = 'direct_media';
  name = 'Direct Video & Audio URL';

  capabilities: ProviderCapability = {
    id: 'direct_media',
    name: 'Direct Media Files (.mp4, .webm, .mp3, .wav)',
    supportsCaptions: false,
    supportsAiWhisper: true,
    exampleUrl: 'https://cdn.example.com/sample-clip.mp4',
  };

  private MEDIA_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mp3', '.wav', '.m4a', '.aac'];

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      return this.MEDIA_EXTENSIONS.some((ext) => pathname.endsWith(ext));
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      const filename = parsed.pathname.split('/').pop();
      return filename || 'media-clip';
    } catch {
      return null;
    }
  }

  async getTranscript(
    url: string,
    preferredLanguage: string = 'en',
    env: CloudflareBindings
  ): Promise<TranscriptResult> {
    const ssrfCheck = validateSafeUrl(url);
    if (!ssrfCheck.isValid) {
      throw new Error(`Security validation failed: ${ssrfCheck.error}`);
    }

    const safeUrl = ssrfCheck.normalizedUrl || url;

    // Check if Cloudflare Workers AI is available in environment
    if (!env.AI) {
      throw new Error(
        'Cloudflare Workers AI binding is not configured in this environment. Speech recognition requires Cloudflare Workers AI Whisper (@cf/openai/whisper).'
      );
    }

    // Fetch media header first to check size limit (e.g. max 25MB for edge processing)
    const headRes = await fetch(safeUrl, { method: 'HEAD' });
    const contentLength = headRes.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 25 * 1024 * 1024) {
      throw new Error('Media file exceeds maximum size limit of 25MB for direct speech transcription.');
    }

    // Fetch media buffer
    const mediaRes = await fetch(safeUrl);
    if (!mediaRes.ok) {
      throw new Error(`Failed to download media file (HTTP ${mediaRes.status}).`);
    }

    const arrayBuffer = await mediaRes.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Run Cloudflare Workers AI Whisper
    const aiResponse = await env.AI.run('@cf/openai/whisper', {
      audio: [...uint8Array],
    });

    const transcribedText = aiResponse?.text || '';
    if (!transcribedText.trim()) {
      throw new Error('No speech was detected in the audio track of this media clip.');
    }

    // Parse AI segments or split into realistic sentence chunks
    const segments: TranscriptSegment[] = [];
    if (aiResponse.vtt) {
      // Parse returned VTT if available
      segments.push(...this.parseVttSegments(aiResponse.vtt));
    }

    if (segments.length === 0) {
      // Split full text into logical sentences with estimated timing
      const sentences = transcribedText
        .split(/(?<=[.?!])\s+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      let currentSec = 0;
      sentences.forEach((sentence: string, idx: number) => {
        const estDuration = Math.max(2.5, Math.min(10, sentence.split(' ').length * 0.45));
        segments.push({
          id: idx + 1,
          start: parseFloat(currentSec.toFixed(2)),
          duration: parseFloat(estDuration.toFixed(2)),
          text: sentence,
        });
        currentSec += estDuration;
      });
    }

    const duration = segments.length > 0 ? segments[segments.length - 1].start + segments[segments.length - 1].duration : 0;
    const fullText = segments.map((s) => s.text).join(' ');
    const srt = generateSrt(segments);
    const vtt = generateVtt(segments);

    return {
      id: crypto.randomUUID(),
      provider: 'direct_media',
      videoId: this.extractVideoId(url) || 'direct-media',
      videoTitle: this.extractVideoId(url) || 'Audio / Video Clip',
      videoDurationSeconds: Math.ceil(duration),
      sourceType: 'ai_whisper',
      language: preferredLanguage,
      segments,
      fullText,
      srt,
      vtt,
      createdAt: Date.now(),
    };
  }

  private parseVttSegments(vttText: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    const lines = vttText.split('\n');
    let idCounter = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (timeMatch && i + 1 < lines.length) {
        const text = lines[i + 1].trim();
        if (text) {
          const start = this.parseVttTime(timeMatch[1]);
          const end = this.parseVttTime(timeMatch[2]);
          segments.push({
            id: idCounter++,
            start: parseFloat(start.toFixed(2)),
            duration: parseFloat(Math.max(1, end - start).toFixed(2)),
            text,
          });
        }
      }
    }
    return segments;
  }

  private parseVttTime(str: string): number {
    const parts = str.split(':');
    if (parts.length === 3) {
      const hrs = parseFloat(parts[0]);
      const mins = parseFloat(parts[1]);
      const secs = parseFloat(parts[2]);
      return hrs * 3600 + mins * 60 + secs;
    }
    return 0;
  }
}

