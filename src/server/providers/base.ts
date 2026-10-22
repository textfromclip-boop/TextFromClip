import { TranscriptResult, CloudflareBindings } from '../../types';

export interface ProviderCapability {
  name: string;
  id: string;
  supportsCaptions: boolean;
  supportsAiWhisper: boolean;
  exampleUrl: string;
}

export interface VideoProviderAdapter {
  id: string;
  name: string;
  capabilities: ProviderCapability;
  matches(url: string): boolean;
  extractVideoId(url: string): string | null;
  getTranscript(
    url: string,
    preferredLanguage: string | undefined,
    env: CloudflareBindings
  ): Promise<TranscriptResult>;
}
