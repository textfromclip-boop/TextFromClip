// Shared TypeScript interfaces and types for TextFromClip

export interface TranscriptSegment {
  id: number;
  start: number; // in seconds, e.g. 12.34
  duration: number; // in seconds, e.g. 4.56
  text: string;
}

export type TranscriptSourceType = 'captions' | 'ai_whisper';

export interface TranscriptResult {
  id: string; // Unguessable Job UUID
  provider: 'youtube' | 'direct_media' | 'tiktok' | 'instagram' | string;
  videoId: string;
  videoTitle?: string;
  videoDurationSeconds?: number;
  videoThumbnailUrl?: string;
  channelTitle?: string;
  sourceType: TranscriptSourceType;
  language: string;
  segments: TranscriptSegment[];
  fullText: string;
  srt: string;
  vtt: string;
  createdAt: number;
}

export interface TranscriptRequest {
  url: string;
  preferredLanguage?: string;
  platform?: 'youtube' | 'tiktok' | 'instagram' | string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PlatformInfo {
  id: string;
  name: string;
  status: 'operational' | 'beta' | 'planned';
  captionSupport: boolean;
  aiTranscription: boolean;
  supportedFormats: string[];
  notes: string;
}

export interface JobRecord {
  id: string;
  provider: string;
  videoId: string;
  videoTitle?: string;
  videoDurationSeconds: number;
  sourceType: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  language: string;
  segmentCount: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  expiresAt: number;
}

export interface CloudflareBindings {
  DB?: D1Database;
  AI?: any;
  ENVIRONMENT?: string;
  MAX_REQUESTS_PER_MINUTE?: string;
  MAX_VIDEO_DURATION_SECONDS?: string;
  CACHE_TTL_SECONDS?: string;
  ASSETS?: Fetcher;
  IG_SESSION_ID?: string;
  EXTERNAL_WHISPER_URL?: string;
  SNAPANY_API_KEY?: string;
}

