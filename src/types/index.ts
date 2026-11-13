// Shared TypeScript interfaces and types for LearnFromClip
export * from './revisionPack';

export interface TranscriptSegment {
  id: number;
  start: number; // in seconds, e.g. 12.34
  duration: number; // in seconds, e.g. 4.56
  text: string;
}

export type TranscriptSourceType = 'captions' | 'ai_whisper';

export interface TranscriptResult {
  id: string; // Unguessable Job UUID
  provider: 'youtube' | 'direct_media' | 'tiktok' | 'instagram' | 'file_upload' | string;
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
  localMediaUrl?: string; // Client-side blob/media URL for seeking uploaded recordings
  cached?: boolean;
}

export interface TranscriptRequest {
  url: string;
  preferredLanguage?: string;
  platform?: 'youtube' | 'tiktok' | 'instagram' | 'upload' | string;
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
  UPLOADS_BUCKET?: R2Bucket;
  ENVIRONMENT?: string;
  MAX_REQUESTS_PER_MINUTE?: string;
  MAX_VIDEO_DURATION_SECONDS?: string;
  CACHE_TTL_SECONDS?: string;
  ASSETS?: Fetcher;
  IG_SESSION_ID?: string;
  EXTERNAL_WHISPER_URL?: string;
  SNAPANY_API_KEY?: string;
  COOKIE_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_VARIANT_EXAM_PASS?: string;
  LEMONSQUEEZY_VARIANT_EXAM_PASS_REGIONAL?: string;
  LEMONSQUEEZY_VARIANT_MONTHLY?: string;
  LEMONSQUEEZY_VARIANT_MONTHLY_REGIONAL?: string;
  LEMONSQUEEZY_VARIANT_SEMESTER_PASS?: string;
  LEMONSQUEEZY_VARIANT_SEMESTER_PASS_REGIONAL?: string;
  /** Bearer token for /api/admin/costs (min 24 chars). Unset = admin endpoint disabled. */
  ADMIN_TOKEN?: string;
  /** Google OAuth 2.0 Client ID & Secret for "Continue with Google" sign-in. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Resend API key for magic-link emails. */
  RESEND_API_KEY?: string;
  /** Verified sender, e.g. "LearnFromClip <login@learnfromclip.com>". */
  EMAIL_FROM?: string;
  /** Canonical site origin used in emailed links, e.g. https://learnfromclip.com */
  APP_BASE_URL?: string;
  IP_DAILY_AI_ACTIONS?: string;
  IP_DAILY_LINKS?: string;
  IP_DAILY_UPLOAD_MINUTES?: string;
  IP_DAILY_QUIZZES?: string;
}
