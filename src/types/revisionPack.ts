// Data structures and schemas for LearnFromClip Revision Packs, Accuracy Anchors & Spaced Repetition

export const BILINGUAL_LANGUAGES = [
  'Arabic',
  'Spanish',
  'French',
  'German',
  'Turkish',
  'Portuguese',
  'Hindi',
] as const;

export type BilingualLanguage = (typeof BILINGUAL_LANGUAGES)[number];

export interface SourceAnchor {
  start_seconds: number;
  end_seconds: number;
  quote: string; // Verbatim word-for-word quote from the lecture transcript
}

export interface NoteBullet {
  id: string;
  text: string;
  is_definition?: boolean;
  term?: string;
  source: SourceAnchor;
  ai_explanation?: string; // Strictly separate from lecture content
}

export interface NoteSection {
  id: string;
  heading: string;
  bullets: NoteBullet[];
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  front_translation?: string;
  back_translation?: string;
  bilingual_language?: string;
  source: SourceAnchor;
  ai_explanation?: string;
  // Spaced Repetition (SM-2) schedule state
  due_date: string; // YYYY-MM-DD (UTC)
  interval: number; // days
  ease: number; // default 2.5
  reps: number; // consecutive successful recalls
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: [string, string, string, string];
  correct_index: number; // 0, 1, 2, or 3
  explanation: string;
  source: SourceAnchor;
  ai_explanation?: string;
}

export interface RevisionPackMetadata {
  totalChunks: number;
  verifiedItemsCount: number;
  droppedQuotesCount: number;
  generatedAt: number;
  modelUsed: string;
  cached?: boolean;
}

export interface RevisionPack {
  id: string;
  title: string;
  provider: string;
  videoId: string;
  durationSeconds: number;
  secondLanguage?: string;
  notes: NoteSection[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  metadata: RevisionPackMetadata;
}

export interface GenerateRevisionPackRequest {
  videoId?: string;
  provider?: string;
  videoTitle?: string;
  durationSeconds?: number;
  segments: Array<{
    id?: number;
    start: number;
    duration?: number;
    text: string;
  }>;
  secondLanguage?: string;
  maxCards?: number;
  isPaid?: boolean;
}
