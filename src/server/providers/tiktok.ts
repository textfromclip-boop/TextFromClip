import { VideoProviderAdapter, ProviderCapability } from './base';
import { TranscriptResult, CloudflareBindings } from '../../types';

export class TikTokProvider implements VideoProviderAdapter {
  id = 'tiktok';
  name = 'TikTok';

  capabilities: ProviderCapability = {
    id: 'tiktok',
    name: 'TikTok Video Clips',
    supportsCaptions: false,
    supportsAiWhisper: true,
    exampleUrl: 'https://www.tiktok.com/@creator/video/1234567890123456789',
  };

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === 'tiktok.com' || host === 'www.tiktok.com' || host === 'vt.tiktok.com' || host === 'vm.tiktok.com';
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/video\/(\d+)/);
      if (match && match[1]) {
        return match[1];
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  }

  async getTranscript(
    _url: string,
    _preferredLanguage: string = 'en',
    _env: CloudflareBindings
  ): Promise<TranscriptResult> {
    // Honest status: TikTok serves aggressive bot challenges and does not expose public caption tracks without authenticated app sessions.
    throw new Error(
      'TikTok public caption extraction is currently restricted by platform anti-scraping policies. We do not fabricate fake transcripts. Please use our YouTube or Direct Media (.mp4/.mp3) transcription in the meantime.'
    );
  }
}
