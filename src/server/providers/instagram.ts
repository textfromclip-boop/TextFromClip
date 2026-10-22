import { VideoProviderAdapter, ProviderCapability } from './base';
import { TranscriptResult, CloudflareBindings } from '../../types';

export class InstagramProvider implements VideoProviderAdapter {
  id = 'instagram';
  name = 'Instagram Reels';

  capabilities: ProviderCapability = {
    id: 'instagram',
    name: 'Instagram Reels & Videos',
    supportsCaptions: false,
    supportsAiWhisper: true,
    exampleUrl: 'https://www.instagram.com/reel/C1234567890/',
  };

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === 'instagram.com' || host === 'www.instagram.com';
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/(?:reel|p)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return match[1];
      }
    } catch {
      return null;
    }
    return null;
  }

  async getTranscript(
    _url: string,
    _preferredLanguage: string = 'en',
    _env: CloudflareBindings
  ): Promise<TranscriptResult> {
    // Honest status: Instagram requires user authentication and blocks anonymous server requests
    throw new Error(
      'Instagram Reels public caption retrieval is blocked by Meta authentication requirements. In accordance with our accuracy policy, we never generate synthetic mock transcripts. Please upload or link directly via YouTube or direct MP4/audio URL.'
    );
  }
}
