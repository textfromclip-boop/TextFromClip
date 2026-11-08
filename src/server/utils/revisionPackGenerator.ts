import {
  BILINGUAL_LANGUAGES,
  BilingualLanguage,
  Flashcard,
  GenerateRevisionPackRequest,
  NoteBullet,
  NoteSection,
  QuizQuestion,
  RevisionPack,
  SourceAnchor,
  TranscriptSegment,
} from '../../types';
import { formatTimestamp } from './formatters';
import { ACTIVE_TEXT_MODELS } from './aiTransform';

const PRIMARY_AI_MODEL = ACTIVE_TEXT_MODELS[0];
const FALLBACK_AI_MODEL = ACTIVE_TEXT_MODELS[1];

export const CHUNK_WINDOW_SECONDS = 600; // 10-minute windows
export const CHUNK_OVERLAP_SECONDS = 60; // 60-second overlap between windows
export const FREE_MAX_LECTURE_SECONDS = 2 * 3600; // 2 hours
export const PAID_MAX_LECTURE_SECONDS = 4 * 3600; // 4 hours
export const FREE_MAX_CARDS_PER_PACK = 30;
export const PAID_MAX_CARDS_PER_PACK = 150;
export const TARGET_QUIZ_QUESTIONS = 10;

export interface TranscriptTimeChunk {
  index: number;
  startSeconds: number;
  endSeconds: number;
  segments: TranscriptSegment[];
}

/**
 * Normalizes text for deterministic quote verification:
 * - Unicode NFKC normalization
 * - Lowercases all characters (preserving Arabic/Hindi/Cyrillic/CJK letters & numbers)
 * - Strips punctuation/symbols
 * - Collapses all whitespace runs into a single space
 */
export function normalizeForQuoteCheck(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a transcript's segments into 10-minute windows with 60-second overlap.
 */
export function chunkTranscriptByTime(
  segments: TranscriptSegment[],
  windowSeconds: number = CHUNK_WINDOW_SECONDS,
  overlapSeconds: number = CHUNK_OVERLAP_SECONDS
): TranscriptTimeChunk[] {
  const cleanSegments = (segments || [])
    .filter((s) => s && typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s, idx) => ({
      id: typeof s.id === 'number' ? s.id : idx + 1,
      start: Math.max(0, Number(s.start) || 0),
      duration: Math.max(1, Number(s.duration) || 3),
      text: s.text.trim(),
    }))
    .sort((a, b) => a.start - b.start);

  if (cleanSegments.length === 0) return [];

  const minStart = cleanSegments[0].start;
  const lastSeg = cleanSegments[cleanSegments.length - 1];
  const maxEnd = Math.max(lastSeg.start + lastSeg.duration, minStart + 1);
  const totalSpan = maxEnd - minStart;

  if (totalSpan <= windowSeconds + overlapSeconds) {
    return [
      {
        index: 0,
        startSeconds: minStart,
        endSeconds: maxEnd,
        segments: cleanSegments,
      },
    ];
  }

  const step = Math.max(60, windowSeconds - overlapSeconds);
  const chunks: TranscriptTimeChunk[] = [];
  let cursor = minStart;
  let chunkIndex = 0;

  while (cursor < maxEnd) {
    const windowEnd = cursor + windowSeconds;
    const windowSegs = cleanSegments.filter(
      (s) => s.start >= cursor && s.start <= windowEnd
    );
    if (windowSegs.length > 0) {
      chunks.push({
        index: chunkIndex++,
        startSeconds: windowSegs[0].start,
        endSeconds:
          windowSegs[windowSegs.length - 1].start +
          windowSegs[windowSegs.length - 1].duration,
        segments: windowSegs,
      });
    }
    if (windowEnd >= maxEnd) break;
    cursor += step;
  }

  return chunks;
}

/**
 * Verifies that `candidate.quote` appears word-for-word (after normalizing case,
 * whitespace, and punctuation) in the transcript segments near `start_seconds`.
 *
 * Returns a verified `SourceAnchor` with accurate `start_seconds` and `end_seconds`
 * snapped to the matching transcript segments, or `null` if the quote is not found.
 */
export function verifyAndAnchorQuote(
  candidate: Partial<SourceAnchor> | undefined | null,
  segments: TranscriptSegment[],
  toleranceSeconds: number = 90
): SourceAnchor | null {
  if (!candidate || typeof candidate.quote !== 'string') return null;

  const rawQuote = candidate.quote.trim();
  const normQuote = normalizeForQuoteCheck(rawQuote);
  if (!normQuote || normQuote.length < 6) return null;

  const quoteWords = normQuote.split(' ').filter(Boolean);
  if (quoteWords.length < 2) return null;

  const reqStart =
    typeof candidate.start_seconds === 'number' && Number.isFinite(candidate.start_seconds)
      ? Math.max(0, candidate.start_seconds)
      : 0;
  const reqEnd =
    typeof candidate.end_seconds === 'number' &&
    Number.isFinite(candidate.end_seconds) &&
    candidate.end_seconds >= reqStart
      ? candidate.end_seconds
      : reqStart + 10;

  // Helper to search within a subset of segments using sliding multi-segment windows (1..4 consecutive segments)
  const findMatchInSegments = (pool: TranscriptSegment[]): SourceAnchor | null => {
    if (pool.length === 0) return null;

    // 1. Check single or consecutive 1..4 segments for exact normalized substring match
    for (let i = 0; i < pool.length; i++) {
      let combinedNorm = '';
      for (let span = 0; span < 4 && i + span < pool.length; span++) {
        const seg = pool[i + span];
        const segNorm = normalizeForQuoteCheck(seg.text);
        combinedNorm = combinedNorm ? `${combinedNorm} ${segNorm}` : segNorm;

        if (combinedNorm.includes(normQuote)) {
          const startSeg = pool[i];
          const endSeg = pool[i + span];
          return {
            start_seconds: Math.floor(startSeg.start),
            end_seconds: Math.ceil(endSeg.start + (endSeg.duration || 4)),
            quote: rawQuote,
          };
        }
      }
    }

    // 2. Check if a single segment's normalized text is contained inside an overly long quote (if >= 4 words)
    for (const seg of pool) {
      const segNorm = normalizeForQuoteCheck(seg.text);
      const segWords = segNorm.split(' ').filter(Boolean);
      if (segWords.length >= 4 && normQuote.includes(segNorm)) {
        return {
          start_seconds: Math.floor(seg.start),
          end_seconds: Math.ceil(seg.start + (seg.duration || 4)),
          quote: seg.text.trim(),
        };
      }
    }

    return null;
  };

  // Pass 1: Search segments within [reqStart - toleranceSeconds, reqEnd + toleranceSeconds]
  const nearbyPool = segments.filter(
    (s) =>
      s.start + (s.duration || 4) >= reqStart - toleranceSeconds &&
      s.start <= reqEnd + toleranceSeconds
  );
  const nearbyMatch = findMatchInSegments(nearbyPool);
  if (nearbyMatch) return nearbyMatch;

  // Pass 2: Search full transcript in case the LLM cited a valid verbatim quote with an off timestamp
  return findMatchInSegments(segments);
}

/**
 * Separates any embedded "AI explanation:" note from lecture text so AI additions
 * are never mixed into lecture content.
 */
export function separateAiExplanation(
  rawText: string,
  explicitAiExplanation?: string
): { cleanLectureText: string; aiExplanation?: string } {
  let text = (rawText || '').trim();
  let extra = (explicitAiExplanation || '').trim();

  const inlineMatch = text.match(
    /\s*(?:\[?\bAI\s+explanation\s*:\s*([^\]]+)\]?|\(\s*AI\s+explanation\s*:\s*([^)]+)\))$/i
  );
  if (inlineMatch) {
    const extracted = (inlineMatch[1] || inlineMatch[2] || '').trim();
    text = text.slice(0, inlineMatch.index).trim();
    if (extracted && !extra) {
      extra = extracted;
    }
  }

  return {
    cleanLectureText: text,
    aiExplanation: extra ? extra : undefined,
  };
}

export function isValidBilingualLanguage(lang?: string): lang is BilingualLanguage {
  if (!lang) return false;
  return (BILINGUAL_LANGUAGES as readonly string[]).includes(lang.trim());
}

function getTodayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Builds the strict JSON generation prompt for a lecture chunk.
 */
export function buildChunkRevisionPrompt(params: {
  videoTitle: string;
  chunk: TranscriptTimeChunk;
  totalChunks: number;
  targetCardsForChunk: number;
  targetQuizForChunk: number;
  secondLanguage?: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const {
    videoTitle,
    chunk,
    totalChunks,
    targetCardsForChunk,
    targetQuizForChunk,
    secondLanguage,
  } = params;

  const bilingualRule =
    secondLanguage && isValidBilingualLanguage(secondLanguage)
      ? `\nBILINGUAL FLASHCARDS REQUIRED (${secondLanguage}):
- For EVERY flashcard, keep "front" and "back" in the original lecture language, AND include "front_translation" and "back_translation" translated into natural, accurate ${secondLanguage}.`
      : '';

  const formattedSegments = chunk.segments
    .map(
      (s) =>
        `[${Math.floor(s.start)}s | ${formatTimestamp(s.start)}] ${s.text.trim()}`
    )
    .join('\n');

  const systemPrompt = `You are a rigorous academic study-pack engine for university and high-school students.
Convert the supplied lecture transcript chunk into a strict JSON revision pack containing:
1. "notes": Structured sections with headings, key points, and key term definitions.
2. "flashcards": ${targetCardsForChunk} high-yield active-recall question/answer pairs.
3. "quiz": ${targetQuizForChunk} multiple-choice questions (4 options each, 0-based "correct_index", and "explanation").

STRICT ACCURACY & CITATION RULES (NEVER VIOLATE):
1. VERBATIM SOURCE QUOTE ON EVERY ITEM: Every note bullet, every flashcard, and every quiz question MUST include:
   "source": { "start_seconds": <integer seconds>, "end_seconds": <integer seconds>, "quote": "<exact word-for-word substring copied from the transcript>" }
   The "quote" MUST be copied verbatim (word-for-word, 4 to 25 words) from the supplied transcript lines. Any item without a verbatim quote from the transcript will be rejected by the server verifier.
2. PRESERVE LECTURER MEANING & TECHNICAL TERMS: Preserve the lecturer's exact terminology, formulas, and claims. Never invent facts.
3. NEVER SILENTLY CORRECT THE LECTURER: Do not alter or silently "correct" what the lecturer said. If you add clarifying context, an extra example, or note a potential error in what the lecturer said, put it ONLY inside the optional "ai_explanation" field—NEVER mix AI explanations into "text", "front", "back", "question", or "explanation".${bilingualRule}
4. OUTPUT STRICT JSON ONLY: Output a single valid JSON object matching the schema below, with no markdown fences and no commentary.

JSON SCHEMA:
{
  "notes": [
    {
      "heading": "Section Title",
      "bullets": [
        {
          "text": "Clear lecture point or definition",
          "is_definition": false,
          "term": "Optional defined term",
          "source": { "start_seconds": 12, "end_seconds": 18, "quote": "exact words from transcript" },
          "ai_explanation": "Optional extra context beyond the lecture (omit if none)"
        }
      ]
    }
  ],
  "flashcards": [
    {
      "front": "Question testing a concept from the lecture?",
      "back": "Concise answer directly from the lecture",
      "front_translation": "Optional translation in ${secondLanguage || 'second language'}",
      "back_translation": "Optional translation in ${secondLanguage || 'second language'}",
      "source": { "start_seconds": 12, "end_seconds": 18, "quote": "exact words from transcript" },
      "ai_explanation": "Optional extra context (omit if none)"
    }
  ],
  "quiz": [
    {
      "question": "Multiple-choice question based on the lecture?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "Why this option is supported by the lecture at this timestamp.",
      "source": { "start_seconds": 12, "end_seconds": 18, "quote": "exact words from transcript" },
      "ai_explanation": "Optional extra context (omit if none)"
    }
  ]
}`;

  const userPrompt = `Lecture Title: ${videoTitle || 'Lecture'}
Chunk: ${chunk.index + 1} of ${totalChunks} (${formatTimestamp(chunk.startSeconds)} to ${formatTimestamp(chunk.endSeconds)})
Target counts for this chunk: 2-4 note sections, ${targetCardsForChunk} flashcards, ${targetQuizForChunk} quiz questions.

Transcript Lines ([seconds | MM:SS] verbatim text):
${formattedSegments}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Extracts a JSON object from an LLM response string (handling accidental markdown fences).
 */
export function parseJsonFromLlmResponse(raw: string): any | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Validates and filters raw parsed JSON items against the transcript segments,
 * dropping any item whose `source.quote` does not appear in the transcript.
 */
export function validateAndFilterParsedPack(
  rawJson: any,
  segments: TranscriptSegment[],
  secondLanguage?: string
): {
  notes: NoteSection[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  verifiedCount: number;
  droppedCount: number;
} {
  const notes: NoteSection[] = [];
  const flashcards: Flashcard[] = [];
  const quiz: QuizQuestion[] = [];
  let verifiedCount = 0;
  let droppedCount = 0;
  const todayUtc = getTodayUtcDateString();
  const validSecondLang = isValidBilingualLanguage(secondLanguage) ? secondLanguage : undefined;

  // 1. Validate Note Sections & Bullets
  if (Array.isArray(rawJson?.notes)) {
    for (let sIdx = 0; sIdx < rawJson.notes.length; sIdx++) {
      const rawSec = rawJson.notes[sIdx];
      if (!rawSec || typeof rawSec !== 'object') continue;
      const heading =
        typeof rawSec.heading === 'string' && rawSec.heading.trim()
          ? rawSec.heading.trim()
          : `Section ${sIdx + 1}`;
      const rawBullets = Array.isArray(rawSec.bullets) ? rawSec.bullets : [];
      const verifiedBullets: NoteBullet[] = [];

      for (let bIdx = 0; bIdx < rawBullets.length; bIdx++) {
        const b = rawBullets[bIdx];
        if (!b || typeof b.text !== 'string' || !b.text.trim()) {
          droppedCount++;
          continue;
        }
        const verifiedSource = verifyAndAnchorQuote(b.source, segments);
        if (!verifiedSource) {
          droppedCount++;
          continue;
        }

        const { cleanLectureText, aiExplanation } = separateAiExplanation(
          b.text,
          typeof b.ai_explanation === 'string' ? b.ai_explanation : undefined
        );
        if (!cleanLectureText) {
          droppedCount++;
          continue;
        }

        verifiedBullets.push({
          id: `note-${verifiedSource.start_seconds}-${sIdx}-${bIdx}`,
          text: cleanLectureText,
          is_definition: Boolean(b.is_definition),
          term: typeof b.term === 'string' && b.term.trim() ? b.term.trim() : undefined,
          source: verifiedSource,
          ai_explanation: aiExplanation,
        });
        verifiedCount++;
      }

      if (verifiedBullets.length > 0) {
        notes.push({
          id: `sec-${sIdx}-${verifiedBullets[0].source.start_seconds}`,
          heading,
          bullets: verifiedBullets,
        });
      }
    }
  }

  // 2. Validate Flashcards
  if (Array.isArray(rawJson?.flashcards)) {
    for (let cIdx = 0; cIdx < rawJson.flashcards.length; cIdx++) {
      const c = rawJson.flashcards[cIdx];
      if (
        !c ||
        typeof c.front !== 'string' ||
        !c.front.trim() ||
        typeof c.back !== 'string' ||
        !c.back.trim()
      ) {
        droppedCount++;
        continue;
      }

      const verifiedSource = verifyAndAnchorQuote(c.source, segments);
      if (!verifiedSource) {
        droppedCount++;
        continue;
      }

      const frontSeparated = separateAiExplanation(c.front);
      const backSeparated = separateAiExplanation(
        c.back,
        typeof c.ai_explanation === 'string' ? c.ai_explanation : frontSeparated.aiExplanation
      );

      flashcards.push({
        id: `card-${verifiedSource.start_seconds}-${cIdx}`,
        front: frontSeparated.cleanLectureText,
        back: backSeparated.cleanLectureText,
        front_translation:
          validSecondLang && typeof c.front_translation === 'string' && c.front_translation.trim()
            ? c.front_translation.trim()
            : undefined,
        back_translation:
          validSecondLang && typeof c.back_translation === 'string' && c.back_translation.trim()
            ? c.back_translation.trim()
            : undefined,
        bilingual_language: validSecondLang,
        source: verifiedSource,
        ai_explanation: backSeparated.aiExplanation,
        due_date: todayUtc,
        interval: 0,
        ease: 2.5,
        reps: 0,
      });
      verifiedCount++;
    }
  }

  // 3. Validate Quiz Questions
  if (Array.isArray(rawJson?.quiz)) {
    for (let qIdx = 0; qIdx < rawJson.quiz.length; qIdx++) {
      const q = rawJson.quiz[qIdx];
      if (!q || typeof q.question !== 'string' || !q.question.trim()) {
        droppedCount++;
        continue;
      }
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        droppedCount++;
        continue;
      }
      const cleanOptions = q.options.map((o: any) =>
        typeof o === 'string' ? o.trim() : String(o ?? '').trim()
      );
      if (cleanOptions.some((o: string) => !o)) {
        droppedCount++;
        continue;
      }
      const correctIdx = Number(q.correct_index);
      if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx > 3) {
        droppedCount++;
        continue;
      }

      const verifiedSource = verifyAndAnchorQuote(q.source, segments);
      if (!verifiedSource) {
        droppedCount++;
        continue;
      }

      const expSeparated = separateAiExplanation(
        typeof q.explanation === 'string' && q.explanation.trim()
          ? q.explanation
          : `Stated in the lecture at ${formatTimestamp(verifiedSource.start_seconds)}.`,
        typeof q.ai_explanation === 'string' ? q.ai_explanation : undefined
      );

      quiz.push({
        id: `quiz-${verifiedSource.start_seconds}-${qIdx}`,
        question: q.question.trim(),
        options: [
          cleanOptions[0],
          cleanOptions[1],
          cleanOptions[2],
          cleanOptions[3],
        ],
        correct_index: correctIdx,
        explanation: expSeparated.cleanLectureText,
        source: verifiedSource,
        ai_explanation: expSeparated.aiExplanation,
      });
      verifiedCount++;
    }
  }

  return { notes, flashcards, quiz, verifiedCount, droppedCount };
}

/**
 * Deterministic verbatim segment builder used to replenish verified items if an LLM chunk
 * drops items or when running offline/local tests without Workers AI.
 * Every single generated item uses an exact verbatim quote from `segments` and passes `verifyAndAnchorQuote`.
 */
export function buildDeterministicVerifiedItems(params: {
  segments: TranscriptSegment[];
  videoTitle: string;
  targetCards: number;
  targetQuiz: number;
  secondLanguage?: string;
}): {
  notes: NoteSection[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
} {
  const { segments, videoTitle, targetCards, targetQuiz, secondLanguage } = params;
  const todayUtc = getTodayUtcDateString();
  const validSecondLang = isValidBilingualLanguage(secondLanguage) ? secondLanguage : undefined;

  const meaningfulSegments = segments.filter(
    (s) => s && typeof s.text === 'string' && normalizeForQuoteCheck(s.text).split(' ').filter(Boolean).length >= 3
  );
  const pool = meaningfulSegments.length > 0 ? meaningfulSegments : segments;

  const notes: NoteSection[] = [];
  const flashcards: Flashcard[] = [];
  const quiz: QuizQuestion[] = [];

  if (pool.length === 0) {
    return { notes, flashcards, quiz };
  }

  // Group into sections of ~4 bullets
  const sectionCount = Math.min(4, Math.max(1, Math.ceil(pool.length / 4)));
  const segsPerSection = Math.ceil(pool.length / sectionCount);

  for (let s = 0; s < sectionCount; s++) {
    const slice = pool.slice(s * segsPerSection, (s + 1) * segsPerSection);
    if (slice.length === 0) continue;
    const bullets: NoteBullet[] = slice.slice(0, 6).map((seg, bIdx) => {
      const quote = seg.text.trim();
      const words = quote.split(/\s+/);
      const keyTerm = words.find((w) => w.replace(/[^a-zA-Z0-9]/g, '').length >= 5)?.replace(/[^a-zA-Z0-9-]/g, '');
      return {
        id: `det-note-${Math.floor(seg.start)}-${s}-${bIdx}`,
        text: quote,
        is_definition: bIdx === 0 && Boolean(keyTerm),
        term: bIdx === 0 && keyTerm ? keyTerm : undefined,
        source: {
          start_seconds: Math.floor(seg.start),
          end_seconds: Math.ceil(seg.start + (seg.duration || 4)),
          quote,
        },
      };
    });

    notes.push({
      id: `det-sec-${s}-${Math.floor(slice[0].start)}`,
      heading:
        sectionCount === 1
          ? `${videoTitle || 'Lecture'} — Key Points`
          : `Part ${s + 1}: ${formatTimestamp(slice[0].start)} – ${formatTimestamp(
              slice[slice.length - 1].start + (slice[slice.length - 1].duration || 4)
            )}`,
      bullets,
    });
  }

  // Build Flashcards evenly sampled across pool
  const cardCount = Math.min(targetCards, Math.max(1, pool.length));
  for (let i = 0; i < cardCount; i++) {
    const segIdx = Math.min(pool.length - 1, Math.floor((i * pool.length) / cardCount));
    const seg = pool[segIdx];
    const quote = seg.text.trim();
    const ts = formatTimestamp(seg.start);

    const words = quote.split(/\s+/);
    const focusPhrase = words.slice(0, Math.min(5, Math.max(2, Math.floor(words.length / 2)))).join(' ');
    const front = `What key point is stated in the lecture at ${ts} regarding "${focusPhrase}…"?`;
    const back = quote;

    flashcards.push({
      id: `det-card-${Math.floor(seg.start)}-${i}`,
      front,
      back,
      bilingual_language: validSecondLang,
      source: {
        start_seconds: Math.floor(seg.start),
        end_seconds: Math.ceil(seg.start + (seg.duration || 4)),
        quote,
      },
      due_date: todayUtc,
      interval: 0,
      ease: 2.5,
      reps: 0,
    });
  }

  // Build Quiz Questions (up to targetQuiz)
  const quizCount = Math.min(targetQuiz, Math.max(1, pool.length));
  for (let qIdx = 0; qIdx < quizCount; qIdx++) {
    const segIdx = Math.min(pool.length - 1, Math.floor((qIdx * pool.length) / quizCount));
    const seg = pool[segIdx];
    const quote = seg.text.trim();
    const ts = formatTimestamp(seg.start);

    // Pick 3 distractors from other segments or negated/altered statements
    const otherQuotes: string[] = [];
    for (let offset = 1; offset < pool.length && otherQuotes.length < 3; offset++) {
      const candidate = pool[(segIdx + offset * 2) % pool.length].text.trim();
      if (candidate !== quote && !otherQuotes.includes(candidate)) {
        otherQuotes.push(candidate);
      }
    }
    const fallbackDistractors = [
      'The lecturer states that this topic is outside the scope of the session.',
      'The lecturer concludes that the opposite relationship holds in all cases.',
      'No evidence or observation is mentioned at this point in the lecture.',
    ];
    while (otherQuotes.length < 3) {
      otherQuotes.push(fallbackDistractors[otherQuotes.length]);
    }

    const correctIndex = qIdx % 4;
    const options: [string, string, string, string] = ['', '', '', ''];
    options[correctIndex] = quote;
    let dPtr = 0;
    for (let slot = 0; slot < 4; slot++) {
      if (slot !== correctIndex) {
        options[slot] = otherQuotes[dPtr++];
      }
    }

    quiz.push({
      id: `det-quiz-${Math.floor(seg.start)}-${qIdx}`,
      question: `Which statement is directly supported by the lecture at ${ts}?`,
      options,
      correct_index: correctIndex,
      explanation: `At ${ts}, the lecturer explicitly states: "${quote}"`,
      source: {
        start_seconds: Math.floor(seg.start),
        end_seconds: Math.ceil(seg.start + (seg.duration || 4)),
        quote,
      },
    });
  }

  return { notes, flashcards, quiz };
}

/**
 * Translates flashcards that are missing `front_translation` or `back_translation`
 * into the selected `secondLanguage` using Workers AI.
 */
async function populateMissingBilingualTranslations(
  ai: any,
  cards: Flashcard[],
  secondLanguage: BilingualLanguage
): Promise<void> {
  const missing = cards.filter((c) => !c.front_translation || !c.back_translation);
  if (missing.length === 0) return;

  if (!ai) {
    for (const c of missing) {
      c.bilingual_language = secondLanguage;
      c.front_translation = c.front_translation || `[${secondLanguage}] ${c.front}`;
      c.back_translation = c.back_translation || `[${secondLanguage}] ${c.back}`;
    }
    return;
  }

  // Batch translate in a single structured JSON call
  const payload = missing.slice(0, 40).map((c, idx) => ({
    idx,
    front: c.front,
    back: c.back,
  }));

  try {
    const response = await ai.run(PRIMARY_AI_MODEL, {
      messages: [
        {
          role: 'system',
          content: `Translate each flashcard's "front" and "back" into natural, accurate ${secondLanguage}. Output ONLY a valid JSON array of objects: [{"idx": 0, "front_translation": "...", "back_translation": "..."}]`,
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
      max_tokens: 2500,
      temperature: 0.15,
      chat_template_kwargs: { enable_thinking: false },
    });

    const rawText =
      typeof response?.response === 'string'
        ? response.response
        : typeof response?.choices?.[0]?.message?.content === 'string'
        ? response.choices[0].message.content
        : '';
    const firstBracket = rawText.indexOf('[');
    const lastBracket = rawText.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const parsed = JSON.parse(rawText.slice(firstBracket, lastBracket + 1));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const targetCard = missing[Number(item?.idx)];
          if (targetCard) {
            if (typeof item.front_translation === 'string' && item.front_translation.trim()) {
              targetCard.front_translation = item.front_translation.trim();
            }
            if (typeof item.back_translation === 'string' && item.back_translation.trim()) {
              targetCard.back_translation = item.back_translation.trim();
            }
            targetCard.bilingual_language = secondLanguage;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[LearnFromClip] Bilingual flashcard fallback translation error:', err);
  }
}

/**
 * Deduplicates flashcards and quiz questions across overlapping lecture chunks.
 */
function deduplicateAndMergePacks(
  chunkResults: Array<{
    notes: NoteSection[];
    flashcards: Flashcard[];
    quiz: QuizQuestion[];
  }>,
  maxCards: number,
  targetQuiz: number
): {
  notes: NoteSection[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
} {
  const mergedNotes: NoteSection[] = [];
  const seenBullets = new Set<string>();

  for (const res of chunkResults) {
    for (const sec of res.notes) {
      const uniqueBullets: NoteBullet[] = [];
      for (const b of sec.bullets) {
        const key = `${Math.floor(b.source.start_seconds / 5)}:${normalizeForQuoteCheck(b.text).slice(0, 60)}`;
        if (!seenBullets.has(key)) {
          seenBullets.add(key);
          uniqueBullets.push(b);
        }
      }
      if (uniqueBullets.length > 0) {
        mergedNotes.push({
          ...sec,
          bullets: uniqueBullets,
        });
      }
    }
  }

  const mergedCards: Flashcard[] = [];
  const seenCards = new Set<string>();
  for (const res of chunkResults) {
    for (const c of res.flashcards) {
      const key = normalizeForQuoteCheck(c.front).slice(0, 65);
      if (!seenCards.has(key)) {
        seenCards.add(key);
        mergedCards.push(c);
      }
    }
  }

  const mergedQuiz: QuizQuestion[] = [];
  const seenQuiz = new Set<string>();
  for (const res of chunkResults) {
    for (const q of res.quiz) {
      const key = normalizeForQuoteCheck(q.question).slice(0, 65);
      if (!seenQuiz.has(key)) {
        seenQuiz.add(key);
        mergedQuiz.push(q);
      }
    }
  }

  return {
    notes: mergedNotes.slice(0, 12),
    flashcards: mergedCards.slice(0, maxCards).map((c, idx) => ({
      ...c,
      id: `card-${idx + 1}-${c.source.start_seconds}`,
    })),
    quiz: mergedQuiz.slice(0, targetQuiz).map((q, idx) => ({
      ...q,
      id: `quiz-${idx + 1}-${q.source.start_seconds}`,
    })),
  };
}

/**
 * Generates a complete, server-verified RevisionPack from transcript segments.
 * Chunks long lectures into 10-minute windows with 60s overlap, runs LLM generation,
 * strictly verifies every `source.quote` against the transcript, drops unverified items,
 * and logs dropped counts.
 */
export async function generateVerifiedRevisionPack(
  req: GenerateRevisionPackRequest,
  ai?: any
): Promise<RevisionPack> {
  const rawSegments: TranscriptSegment[] = (req.segments || [])
    .filter((s) => s && typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s, idx) => ({
      id: typeof s.id === 'number' ? s.id : idx + 1,
      start: Math.max(0, Number(s.start) || 0),
      duration: Math.max(1, Number(s.duration) || 4),
      text: s.text.trim(),
    }));

  if (rawSegments.length === 0) {
    throw new Error('Transcript contains no spoken segments to build a revision pack.');
  }

  const lastSeg = rawSegments[rawSegments.length - 1];
  const computedDuration = Math.max(
    Number(req.durationSeconds) || 0,
    lastSeg.start + (lastSeg.duration || 4)
  );
  const maxAllowedSeconds = req.isPaid ? PAID_MAX_LECTURE_SECONDS : FREE_MAX_LECTURE_SECONDS;

  if (computedDuration > maxAllowedSeconds) {
    const maxHours = req.isPaid ? 4 : 2;
    throw new Error(
      `This lecture is longer than the ${maxHours}-hour maximum supported on your current plan. Please upload a shorter recording or upgrade your plan.`
    );
  }

  const maxCards = Math.min(
    req.isPaid ? PAID_MAX_CARDS_PER_PACK : FREE_MAX_CARDS_PER_PACK,
    req.maxCards && req.maxCards > 0 ? req.maxCards : FREE_MAX_CARDS_PER_PACK
  );
  const secondLanguage = isValidBilingualLanguage(req.secondLanguage)
    ? req.secondLanguage
    : undefined;

  const chunks = chunkTranscriptByTime(
    rawSegments,
    CHUNK_WINDOW_SECONDS,
    CHUNK_OVERLAP_SECONDS
  );

  // Cap concurrent LLM chunk calls to at most 6 windows (sampling evenly if > 6 windows)
  const activeChunks =
    chunks.length <= 6
      ? chunks
      : Array.from({ length: 6 }, (_, i) =>
          chunks[Math.min(chunks.length - 1, Math.floor((i * chunks.length) / 6))]
        );

  const cardsPerChunk = Math.max(
    5,
    Math.ceil(maxCards / Math.max(1, activeChunks.length))
  );
  const quizPerChunk = Math.max(
    3,
    Math.ceil(TARGET_QUIZ_QUESTIONS / Math.max(1, activeChunks.length))
  );

  let totalVerified = 0;
  let totalDropped = 0;
  let modelUsed = ai ? PRIMARY_AI_MODEL : 'deterministic_quote_verified';

  const chunkOutputs: Array<{
    notes: NoteSection[];
    flashcards: Flashcard[];
    quiz: QuizQuestion[];
  }> = [];

  if (ai) {
    // Run chunks in bounded batches of 3 for fast generation (< 2 minutes even on 60-min lectures)
    const batchSize = 3;
    for (let i = 0; i < activeChunks.length; i += batchSize) {
      const batch = activeChunks.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (chunk) => {
          const messages = buildChunkRevisionPrompt({
            videoTitle: req.videoTitle || 'Lecture',
            chunk,
            totalChunks: activeChunks.length,
            targetCardsForChunk: cardsPerChunk,
            targetQuizForChunk: quizPerChunk,
            secondLanguage,
          });

          for (const model of [PRIMARY_AI_MODEL, FALLBACK_AI_MODEL]) {
            try {
              const payload: Record<string, unknown> = {
                messages,
                max_tokens: 3200,
                temperature: 0.2,
              };
              if (model.includes('gemma-4')) {
                payload.chat_template_kwargs = { enable_thinking: false };
              }
              const res = await ai.run(model, payload);
              const text =
                typeof res?.response === 'string'
                  ? res.response
                  : typeof res?.choices?.[0]?.message?.content === 'string'
                  ? res.choices[0].message.content
                  : '';
              const parsed = parseJsonFromLlmResponse(text);
              if (parsed) {
                const validated = validateAndFilterParsedPack(
                  parsed,
                  rawSegments,
                  secondLanguage
                );
                totalVerified += validated.verifiedCount;
                totalDropped += validated.droppedCount;
                modelUsed = model;
                if (
                  validated.notes.length > 0 ||
                  validated.flashcards.length > 0 ||
                  validated.quiz.length > 0
                ) {
                  return validated;
                }
              }
            } catch (err) {
              console.warn(`[LearnFromClip] Chunk ${chunk.index} generation warning on ${model}:`, err);
            }
          }

          return { notes: [], flashcards: [], quiz: [] };
        })
      );
      chunkOutputs.push(...batchResults);
    }
  }

  let merged = deduplicateAndMergePacks(
    chunkOutputs,
    maxCards,
    TARGET_QUIZ_QUESTIONS
  );

  // Replenish any missing sections, cards, or quiz questions with deterministic verbatim-verified items
  if (
    merged.notes.length === 0 ||
    merged.flashcards.length < Math.min(maxCards, rawSegments.length) ||
    merged.quiz.length < Math.min(TARGET_QUIZ_QUESTIONS, rawSegments.length)
  ) {
    const fallbackItems = buildDeterministicVerifiedItems({
      segments: rawSegments,
      videoTitle: req.videoTitle || 'Lecture',
      targetCards: maxCards,
      targetQuiz: TARGET_QUIZ_QUESTIONS,
      secondLanguage,
    });

    merged = deduplicateAndMergePacks(
      [merged, fallbackItems],
      maxCards,
      TARGET_QUIZ_QUESTIONS
    );
  }

  if (secondLanguage) {
    await populateMissingBilingualTranslations(ai, merged.flashcards, secondLanguage);
  }

  const finalVerifiedCount =
    merged.notes.reduce((acc, s) => acc + s.bullets.length, 0) +
    merged.flashcards.length +
    merged.quiz.length;

  console.info(
    `[LearnFromClip Accuracy] Pack generated for "${req.videoTitle || 'Lecture'}": verified=${finalVerifiedCount}, dropped_unverified_quotes=${totalDropped}, chunks=${chunks.length}`
  );

  return {
    id: `pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: req.videoTitle || 'Lecture Revision Pack',
    provider: req.provider || 'youtube',
    videoId: req.videoId || 'unknown',
    durationSeconds: Math.round(computedDuration),
    secondLanguage,
    notes: merged.notes,
    flashcards: merged.flashcards,
    quiz: merged.quiz,
    metadata: {
      totalChunks: chunks.length,
      verifiedItemsCount: finalVerifiedCount,
      droppedQuotesCount: totalDropped,
      generatedAt: Date.now(),
      modelUsed,
    },
  };
}
