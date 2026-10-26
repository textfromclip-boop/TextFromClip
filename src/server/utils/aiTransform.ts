// Domain-general, cost-controlled AI Transform & Translation pipeline:
// 1. Safe transcript cleaning & timeline formatting (preserves [inaudible] & speaker attribution)
// 2. Explicit head/middle/conclusion budgeting for long transcripts
// 3. Closed-book, stance-faithful, proportional prompts
// 4. Contiguous passage quote verification (guards negation, qualifiers, attribution & invented words)
// 5. Code-safe & multilingual-safe post-processing + deterministic output validation
// 6. Bounded model execution with strict error classification (prevents 70B escalation on 4xx/429/quota)

import { formatTimestamp } from './formatters';

export const VALID_TRANSFORM_MODES = ['summary', 'script', 'blog', 'thread', 'notes'] as const;
export type TransformMode = (typeof VALID_TRANSFORM_MODES)[number];

export const MAX_TRANSCRIPT_INPUT_CHARS = 300_000;
export const DEFAULT_PROMPT_BUDGET_CHARS = 14_000;
export const DEFAULT_TRANSLATE_BUDGET_CHARS = 12_000;

export const ACTIVE_TEXT_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.2-3b-instruct',
] as const;

export interface RawSegmentLike {
  start?: unknown;
  duration?: unknown;
  text?: unknown;
}

export interface CleanedTranscript {
  cleanedText: string;
  timelineText: string;
  wordCount: number;
  hasTimestamps: boolean;
}

export interface BudgetedTranscript {
  text: string;
  truncated: boolean;
  omittedChars: number;
}

export interface TransformPromptSpec {
  mode: TransformMode;
  temperature: number;
  maxTokens: number;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}

export interface OutputValidationResult {
  valid: boolean;
  reason?: string;
}

export type AiErrorCategory =
  | 'invalid_input'
  | 'rate_or_quota'
  | 'auth_error'
  | 'retriable_upstream';

export interface ClassifiedAiError {
  category: AiErrorCategory;
  httpStatus: 400 | 422 | 429 | 502 | 503;
  code: string;
  publicMessage: string;
  allowModelFallback: boolean;
}

// Matches ONLY non-spoken audio/stage caption tags while preserving [inaudible], [unclear],
// speaker tags like [Speaker 1], timestamps like [01:20], and code/math like arr[0].
const BRACKET_STAGE_NOISE_REGEX =
  /\[\s*(?:(?:background|upbeat|soft|loud|dramatic|sad|happy|instrumental|intro|outro)\s+)?(?:music(?:\s+(?:playing|starts|fades|ends|continues|stops))?|applause|laughter|laughs|laughing|chuckles|chuckling|cheering|cheers|sighs|sighing|coughs|coughing|gasps|groans|silence|sound\s*effects?|sfx|crowd\s+(?:cheering|laughing|applauding)|audience\s+(?:laughing|applauding|cheering)|♪+)\s*\]|\[\s*\]/gi;

const PAREN_STAGE_NOISE_REGEX =
  /\(\s*(?:(?:background|upbeat|soft|loud|dramatic|instrumental)\s+)?(?:music(?:\s+(?:playing|starts|fades|ends))?|applause|laughter|laughs|cheering|sound\s*effects?|sfx)\s*\)/gi;

const MUSIC_GLYPH_REGEX = /[♪♫♬]+/g;

export function isValidTransformMode(mode: unknown): mode is TransformMode {
  return typeof mode === 'string' && (VALID_TRANSFORM_MODES as readonly string[]).includes(mode);
}

function stripNonSpokenNoise(input: string): string {
  return input
    .replace(BRACKET_STAGE_NOISE_REGEX, ' ')
    .replace(PAREN_STAGE_NOISE_REGEX, ' ')
    .replace(MUSIC_GLYPH_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips non-spoken stage noise ([Music], [Applause], [Laughter], ♪) while preserving
 * line breaks, paragraph separations, list indentation, Markdown syntax, code blocks,
 * and segment timestamps for structure-faithful translation.
 */
export function cleanTextForTranslation(rawText: unknown): {
  cleanedText: string;
  hasMeaningfulContent: boolean;
} {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { cleanedText: '', hasMeaningfulContent: false };
  }

  const normalized = rawText.replace(/\r\n?/g, '\n');
  const parts = normalized.split(/(```[\s\S]*?```)/g);

  const cleanedParts = parts.map((part) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      return part;
    }

    const lines = part.split('\n');
    const keptLines: string[] = [];

    for (const rawLine of lines) {
      if (!rawLine.trim()) {
        keptLines.push('');
        continue;
      }

      const indentMatch = rawLine.match(/^([ \t]*)/);
      const leadingIndent = indentMatch ? indentMatch[1] : '';
      const cleanedBody = rawLine
        .slice(leadingIndent.length)
        .replace(BRACKET_STAGE_NOISE_REGEX, ' ')
        .replace(PAREN_STAGE_NOISE_REGEX, ' ')
        .replace(MUSIC_GLYPH_REGEX, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      // Drop lines that contained only stage noise or a bare timestamp attached to stage noise
      if (!cleanedBody || /^\[\d{1,2}:\d{2}(?::\d{2})?\]$/.test(cleanedBody)) {
        continue;
      }

      keptLines.push(`${leadingIndent}${cleanedBody}`);
    }

    return keptLines.join('\n');
  });

  const cleanedText = cleanedParts.join('').replace(/\n{3,}/g, '\n\n').trim();
  const withoutTimestamps = cleanedText.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ');
  const hasMeaningfulContent = /[\p{L}\p{N}]/u.test(withoutTimestamps);

  return {
    cleanedText: hasMeaningfulContent ? cleanedText : '',
    hasMeaningfulContent,
  };
}

/**
 * Strips non-spoken caption stage artifacts ([Music], [Applause], [Laughter], ♪) while
 * preserving original word order, speaker labels, and uncertainty markers like [inaudible].
 * Optionally incorporates valid segment timestamps (~30s intervals) for timeline context.
 */
export function cleanTranscriptForAi(
  rawText: unknown,
  rawSegments?: unknown
): CleanedTranscript {
  const safeRaw = typeof rawText === 'string' ? rawText : '';

  // Safely sanitize optional segments array if provided
  let timelineParts: string[] = [];
  let plainFromSegments: string[] = [];
  let hasTimestamps = false;
  let lastAnchorSec = -Infinity;

  if (Array.isArray(rawSegments) && rawSegments.length > 0) {
    for (const item of rawSegments) {
      if (!item || typeof item !== 'object') continue;
      const seg = item as RawSegmentLike;
      if (typeof seg.text !== 'string') continue;

      const cleanedSegText = stripNonSpokenNoise(seg.text);
      if (!cleanedSegText) continue;

      plainFromSegments.push(cleanedSegText);

      const startNum =
        typeof seg.start === 'number' && Number.isFinite(seg.start) && seg.start >= 0
          ? seg.start
          : null;

      if (startNum !== null && startNum - lastAnchorSec >= 30) {
        timelineParts.push(`[${formatTimestamp(startNum)}] ${cleanedSegText}`);
        lastAnchorSec = startNum;
        hasTimestamps = true;
      } else {
        timelineParts.push(cleanedSegText);
      }
    }
  }

  const cleanedFromRaw = stripNonSpokenNoise(safeRaw);
  const cleanedText = cleanedFromRaw || plainFromSegments.join(' ').replace(/\s+/g, ' ').trim();

  if (!cleanedText) {
    return { cleanedText: '', timelineText: '', wordCount: 0, hasTimestamps: false };
  }

  // Only use segment-derived timelineText if its plain content matches the supplied rawText length closely
  // (ensuring inline user edits in rawText are always respected).
  const joinedSegPlain = plainFromSegments.join(' ').replace(/\s+/g, ' ').trim();
  const useTimeline =
    hasTimestamps &&
    joinedSegPlain.length > 0 &&
    Math.abs(joinedSegPlain.length - cleanedText.length) <= 16;

  const timelineText = useTimeline
    ? timelineParts.join(' ').replace(/\s+/g, ' ').trim()
    : cleanedText;

  const wordCount = cleanedText.split(/\s+/).filter(Boolean).length;

  return {
    cleanedText,
    timelineText,
    wordCount,
    hasTimestamps: useTimeline,
  };
}

function sliceAtWordBoundary(text: string, start: number, end: number): string {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(text.length, end);
  let chunk = text.slice(safeStart, safeEnd);

  if (safeStart > 0) {
    const firstSpace = chunk.indexOf(' ');
    if (firstSpace > 0 && firstSpace < 45) {
      chunk = chunk.slice(firstSpace + 1);
    }
  }
  if (safeEnd < text.length) {
    const lastSpace = chunk.lastIndexOf(' ');
    if (lastSpace > chunk.length - 45 && lastSpace > 0) {
      chunk = chunk.slice(0, lastSpace);
    }
  }
  return chunk.trim();
}

/**
 * Retains beginning (40%), middle (30%), and conclusion (30%) when a transcript exceeds maxChars,
 * marking omitted spans explicitly so downstream logic never mistakes excerpts for a full transcript.
 */
export function budgetTranscriptForPrompt(
  cleanedText: string,
  maxChars = DEFAULT_PROMPT_BUDGET_CHARS
): BudgetedTranscript {
  if (!cleanedText || cleanedText.length <= maxChars) {
    return { text: cleanedText || '', truncated: false, omittedChars: 0 };
  }

  const separator = '\n[... OMITTED TRANSCRIPT SECTION ...]\n';
  const usable = Math.max(120, maxChars - separator.length * 2);
  const headLen = Math.floor(usable * 0.4);
  const midLen = Math.floor(usable * 0.3);
  const tailLen = usable - headLen - midLen;

  const midStart = Math.floor((cleanedText.length - midLen) / 2);

  const head = sliceAtWordBoundary(cleanedText, 0, headLen);
  const mid = sliceAtWordBoundary(cleanedText, midStart, midStart + midLen);
  const tail = sliceAtWordBoundary(cleanedText, cleanedText.length - tailLen, cleanedText.length);

  const combined = `${head}${separator}${mid}${separator}${tail}`;
  const includedLen = head.length + mid.length + tail.length;

  return {
    text: combined,
    truncated: true,
    omittedChars: Math.max(0, cleanedText.length - includedLen),
  };
}

const SHARED_SYSTEM_PROMPT = `You transform video transcripts into clear, useful written formats while faithfully preserving the speaker's meaning.

CORE TRANSFORMATION RULES:
1. SOURCE OF TRUTH: Treat the supplied Transcript as your sole source of facts. Preserve the speaker's claims, explanations, analogies, opinions, technical terms, names, and intended meaning. Reorganize, condense, and rewrite naturally to fit the requested format—do NOT copy the transcript word-for-word except inside labeled exact quotations.
2. NO UNSUPPORTED ADDITIONS OR SILENT CORRECTIONS: Do NOT introduce any facts, examples, named entities, libraries, frameworks, tools, products, people, statistics, or technical details absent from the Transcript—even if they are commonly associated with the topic. Do NOT silently correct, challenge, or replace the speaker's explanations with textbook definitions or your own outside knowledge.
3. INCOMPLETE SPEECH & FRAGMENTS: Transcripts often contain cut-off phrases, missing words, and speech-recognition stumbles. Rewrite incomplete sentences naturally when the intended meaning is clear from surrounding context, and omit or generalize unrecoverable fragments when that preserves the main point (for example, rewrite "build server-side apps like web apps with the framework" as "build server-side web applications"—NEVER guess which framework or name was omitted).
4. QUOTATION INTEGRITY: Never invent quotations, never combine separate statements into one quotation, and never present a paraphrase inside quotation marks as a direct quote.
5. PROPORTIONAL PLAIN TEXT: Match length to the transcript's substance without padding. Output clean plain text without Markdown **bold** or ### heading markers (preserve code syntax unchanged if the transcript discusses code).`;

export function buildTransformPrompt(
  rawMode: string,
  videoTitle: string,
  transcriptText: string,
  wordCount: number,
  isTruncated = false
): TransformPromptSpec {
  const mode: TransformMode = isValidTransformMode(rawMode) ? rawMode : 'summary';

  const isVeryShort = wordCount < 90;
  const isShort = wordCount >= 90 && wordCount < 260;
  const isLong = wordCount >= 900;

  let temperature = 0.15;
  let maxTokens = 750;
  let taskInstruction = '';

  switch (mode) {
    case 'summary': {
      temperature = 0.15;
      maxTokens = isVeryShort ? 300 : isShort ? 480 : 780;
      const overviewLen = isVeryShort ? '1 concise sentence' : '2 concise sentences';
      const bulletRange = isVeryShort
        ? '2 to 3'
        : isShort
          ? '3 to 5'
          : isLong
            ? '5 to 7'
            : '4 to 6';

      taskInstruction = `Produce a clear, non-repetitive Executive Summary scaled to this ${wordCount}-word transcript using these exact plain-text headings:

Executive Summary
Write ${overviewLen} capturing the central topic and main message of the speaker.

Key Takeaways
Provide ${bulletRange} bullet points starting with "• <Short Label>: ".
Capture the main points, the speaker's own explanations, and important qualifications in logical order without adding outside details. Every bullet must add distinct substance not already stated in the Executive Summary.

Bottom Line
Write 1 concise sentence capturing the speaker's final takeaway or closing thought without repeating the wording of the Executive Summary.`;
      break;
    }

    case 'script': {
      temperature = 0.35;
      maxTokens = isVeryShort ? 320 : 600;
      const wordTarget = isVeryShort
        ? '45 to 75 spoken words'
        : isShort
          ? '95 to 135 spoken words'
          : '130 to 165 spoken words';

      taskInstruction = `Adapt this transcript into an engaging spoken narration script (${wordTarget}) with strong spoken flow.

SCRIPT GUIDELINES:
- Write 100% natural spoken sentences—NO bullet points, NO stage/camera directions like "(Cut to...)" or "(Music plays)", NO speaker labels like "Narrator:", and NO placeholders like "(insert link)".
- Open HOOK with a compelling question, tension, or bold point rooted in the speaker's message (avoid generic clichés like "Meet [Name]", "dared to challenge the status quo", or "in today's world").
- Creative transitions, pacing, and conversational framing suited to short-form voiceover are welcome, provided they preserve the speaker's intended meaning and never invent facts, entities, or claims absent from the transcript.
- Preserve the central argument and conclusion without promising a video duration unsupported by the script's word count.

Use these exact plain-text section headers:
HOOK
<1 to 2 spoken sentences>

BODY
<1 to 3 short spoken paragraphs—sentences only, zero bullets>

CTA
<1 to 2 spoken sentences ending with an engaging viewer question tied to the speaker's message>`;
      break;
    }

    case 'blog': {
      temperature = 0.25;
      maxTokens = isVeryShort ? 320 : isShort ? 550 : 950;
      const lengthGuide = isVeryShort
        ? '80 to 130 words total (concise note—do not inflate beyond the source)'
        : isShort
          ? '175 to 245 words total (tight article—do not pad with filler)'
          : isLong
            ? '450 to 650 words total'
            : '280 to 420 words total';

      taskInstruction = `Organize this transcript into a clear, readable blog article (${lengthGuide}).

ARTICLE GUIDELINES:
- Group related ideas into logical, easy-to-scan sections without generic essay introductions, filler transitions, repeated arguments, or unsupported background information.
- Preserve the speaker's actual explanations, opinions, and qualifications rather than replacing them with outside knowledge or adding unnamed tools/examples.
- Rewrite incomplete spoken fragments smoothly without guessing missing specifics.
- Structure: Line 1 is a specific Headline, followed by a concise Introduction, ${isVeryShort ? '1 to 2' : '2 to 3'} Subheadings, and a short Conclusion reflecting the speaker's closing point.`;
      break;
    }

    case 'thread': {
      temperature = 0.25;
      maxTokens = isVeryShort ? 380 : 650;
      const postCount = isVeryShort ? 3 : isShort ? 5 : 6;
      taskInstruction = `Adapt this transcript into a ${postCount}-post social media thread.
- Number each post (1/${postCount}, 2/${postCount}, etc.).
- Give every post a distinct purpose so no two posts repeat the same point.
- Post 1/${postCount} must hook readers with the speaker's central claim or question.
- Middle posts must each cover a separate supporting point or explanation from the speaker without introducing outside facts or unnamed entities.
- Post ${postCount}/${postCount} must wrap up with the speaker's conclusion or closing takeaway.`;
      break;
    }

    case 'notes': {
      temperature = 0.1;
      maxTokens = isVeryShort ? 420 : isShort ? 620 : 880;
      const quoteRange = isVeryShort ? '1 to 2' : isShort ? '2 to 4' : '3 to 5';
      const qaCount = isVeryShort ? '2' : '3';

      taskInstruction = `Create clear Study Notes to help users review what the speaker taught, using these exact plain-text headings:

Core Topic
1 concise sentence summarizing what the speaker teaches or argues in the video.

Key Concepts & Definitions
• <Concept or Term>: <Clear, concise study-note explanation preserving what the speaker actually taught—do NOT silently replace the speaker's explanations or analogies with independent textbook definitions, do NOT invent missing details, and save direct quotes for the section below.>

Exact Quotations
• "<Single continuous passage copied word-for-word from the transcript>"
(Include ${quoteRange} quotations ONLY where exact wording appears clearly in the transcript. Do NOT invent quotes, do NOT combine separate statements into one quote, and do NOT place paraphrases inside quotation marks.)

Comprehension Questions
• Q: <Specific review question testing a key concept, explanation, or distinction taught by the speaker>
  A: <Concise 1-sentence answer reflecting the speaker's explanation>
(Include ${qaCount} Q&A pairs.)`;
      break;
    }
  }

  const truncationNotice = isTruncated
    ? `\nSOURCE LIMITATION: This ${wordCount}-word transcript exceeded the single-pass context budget and contains sampled excerpts from the beginning, middle, and conclusion separated by "[... OMITTED TRANSCRIPT SECTION ...]". Base your output strictly on the provided excerpts and do NOT claim complete coverage of omitted middle sections.\n`
    : '';

  return {
    mode,
    temperature,
    maxTokens,
    messages: [
      { role: 'system', content: SHARED_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Video Title (proper-noun spelling reference only): ${videoTitle || 'Untitled Video'}\nTranscript Word Count: ${wordCount} words${truncationNotice}\n\nTask:\n${taskInstruction}\n\nTranscript:\n${transcriptText}`,
      },
    ],
  };
}

export function buildTranslateMessages(
  sourceText: string,
  targetLanguage: string
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: `You are an accurate, structure-preserving translator. Translate the supplied content faithfully into ${targetLanguage}.

STRICT FORMATTING & TRANSLATION RULES:
1. PRESERVE STRUCTURE & PARAGRAPHS: Keep the exact document organization, line breaks, and blank-line paragraph separations of the source. Never flatten multi-line content into a single block of text.
2. HEADINGS & LISTS: Translate headings and prose while keeping every heading on its own line (retaining Markdown # levels when present) and keeping every bullet item (•, -, *) or numbered item (1., 2., 1/5, etc.) on its own separate line in the exact same order.
3. MARKDOWN & CODE: Preserve Markdown **bold**, *italic*, inline \`code\`, and fenced \`\`\`code blocks\`\`\`. Do NOT translate code, commands, identifiers, or file paths inside \`inline code\` or \`\`\`code blocks\`\`\`.
4. TIMESTAMPS: When the source contains timestamps such as [00:00] or [01:02:03], preserve every timestamp unchanged and attached to its corresponding translated segment in the exact same order (one timestamped segment per line when the source has one per line). Do NOT add timestamps if the source does not contain them.
5. FAITHFUL CONTENT ONLY: Preserve the speaker's exact meaning, stance, negations, qualifiers, speaker labels, and uncertainty markers (such as [inaudible]). Do NOT summarize, rewrite, expand, or omit content, and do NOT add introductions, explanations, or commentary. Output ONLY the translated content.`,
    },
    {
      role: 'user',
      content: sourceText,
    },
  ];
}

// Negation and attribution/counterfactual tokens that must NOT be silently clipped immediately before a quote
const NEGATION_AND_COUNTERFACTUAL_GUARDS = new Set([
  'not',
  'never',
  'no',
  'neither',
  'nor',
  'without',
  'nobody',
  'nothing',
  'nowhere',
  'hardly',
  'barely',
  'scarcely',
  'doesnt',
  'dont',
  'didnt',
  'cant',
  'cannot',
  'wont',
  'wouldnt',
  'shouldnt',
  'couldnt',
  'isnt',
  'arent',
  'wasnt',
  'werent',
  'hasnt',
  'havent',
  'hadnt',
  'mustnt',
  'false',
  'falsely',
  'wrong',
  'wrongly',
  'untrue',
  'myth',
  'misinterpreted',
  'misunderstanding',
  'unlikely',
  'impossible',
  'deny',
  'denies',
  'denied',
  'reject',
  'rejects',
  'rejected',
]);

const IMMEDIATE_QUALIFIER_GUARDS = new Set([
  'if',
  'unless',
  'whether',
  'suppose',
  'assuming',
  'allegedly',
  'supposedly',
  'claim',
  'claims',
  'claimed',
  'allege',
  'alleges',
  'alleged',
  'rumor',
]);

interface NormalizedTokenStream {
  tokens: string[];
  hasSentenceBreakBefore: boolean[];
}

function tokenizeForContiguousMatch(input: string): NormalizedTokenStream {
  // Strip timestamp markers like [01:23] or [01:02:03] before tokenizing
  const withoutTimestamps = input.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ');
  // Normalize intra-letter/number apostrophes (e.g., can't / can’t -> cant) so contractions stay distinct from non-negated forms
  const unifiedApostrophes = withoutTimestamps
    .toLowerCase()
    .replace(/([\p{L}\p{N}])['’ʼ]([\p{L}\p{N}])/gu, '$1$2');

  // Split into raw chunks keeping sentence-ending punctuation awareness
  const chunks = unifiedApostrophes.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  const hasSentenceBreakBefore: boolean[] = [];
  let boundaryPending = true;

  for (const chunk of chunks) {
    const startsAfterBreak = boundaryPending;
    const endsSentence = /[.?!;]["”')\]}]*$/.test(chunk);
    const subTokens = chunk.match(/[\p{L}\p{N}]+/gu);

    if (subTokens && subTokens.length > 0) {
      for (let i = 0; i < subTokens.length; i++) {
        tokens.push(subTokens[i]);
        hasSentenceBreakBefore.push(i === 0 ? startsAfterBreak : false);
      }
      boundaryPending = endsSentence;
    } else if (endsSentence) {
      boundaryPending = true;
    }
  }

  return { tokens, hasSentenceBreakBefore };
}

/**
 * Verifies that a quotation matches an exact contiguous passage in the source transcript
 * after safe whitespace/punctuation/case normalization, while guarding against clipped
 * leading negations, counterfactuals, or critic-attribution qualifiers.
 */
export function verifyQuoteAgainstTranscript(quote: string, sourceTranscript: string): boolean {
  if (!quote || !sourceTranscript) return false;

  // Reject quotes that splice separate statements together using mid-quote ellipses
  if (/\S\s*(?:\.\.\.|…)\s*\S/.test(quote) && !/\S\s*(?:\.\.\.|…)\s*\S/.test(sourceTranscript)) {
    return false;
  }

  const qStream = tokenizeForContiguousMatch(quote);
  const qTokens = qStream.tokens;
  if (qTokens.length < 3) return false;

  const tStream = tokenizeForContiguousMatch(sourceTranscript);
  const tTokens = tStream.tokens;
  if (qTokens.length > tTokens.length) return false;

  const limit = tTokens.length - qTokens.length;

  for (let idx = 0; idx <= limit; idx++) {
    let allMatch = true;
    for (let j = 0; j < qTokens.length; j++) {
      if (tTokens[idx + j] !== qTokens[j]) {
        allMatch = false;
        break;
      }
    }
    if (!allMatch) continue;

    // Check preceding tokens within the same clause/sentence so we never pass a quote
    // that clipped off an immediately governing negation ("doesn't mean [exploit others...]")
    // or conditional/attribution qualifier ("critics claim [...]").
    let blockedByLeadingGuard = false;
    if (idx > 0 && !tStream.hasSentenceBreakBefore[idx]) {
      for (let back = 1; back <= 3 && idx - back >= 0; back++) {
        const prevIdx = idx - back;
        const prevToken = tTokens[prevIdx];

        if (NEGATION_AND_COUNTERFACTUAL_GUARDS.has(prevToken)) {
          blockedByLeadingGuard = true;
          break;
        }
        if (back <= 2 && IMMEDIATE_QUALIFIER_GUARDS.has(prevToken)) {
          blockedByLeadingGuard = true;
          break;
        }
        if (tStream.hasSentenceBreakBefore[prevIdx]) {
          break;
        }
      }
    }

    if (!blockedByLeadingGuard) {
      return true;
    }
  }

  return false;
}

// Keep alias exported so existing callers/imports remain compatible
export const isQuoteGroundedInTranscript = verifyQuoteAgainstTranscript;

const STAGE_DIRECTION_LINE_REGEX =
  /^\([^)\n]*(?:\b(?:cut to|camera|shot|fade in|fade out|music|sfx|sound|on screen|split-screen|b-roll|graphic|graphics|illustration|illustrations|visual|insert link|hashtag|closing shot|opening shot)\b)[^)\n]*\)$/i;

function cleanNonCodeSegment(segment: string, isFirstSegment: boolean): string {
  let out = segment;
  if (isFirstSegment) {
    // Only strip chatty preambles that end with a colon on line 1 (protects headlines like "Here Is Why...")
    out = out.replace(/^(?:here is|sure[,!]?\s+here is|below is)\s+(?:the|a|an|your)\b[^\n]*:\s*\n+/i, '');
  }
  // Strip Markdown **bold** only when wrapping non-space boundaries on a single line (preserves Python `2 ** 3 ** 4`)
  out = out.replace(/\*\*([^\s*](?:[^\n*]*?[^\s*])?)\*\*/g, '$1');
  // Strip Markdown ATX headings when followed by Unicode letters/digits
  out = out.replace(/^#{1,4}\s+(?=[\p{L}\p{N}])/gmu, '');
  return out;
}

/**
 * Deterministic post-processor that preserves code blocks and multilingual scripts,
 * cleans screenplay stage cues in script mode, verifies exact quotations in notes mode,
 * and appends an explicit excerpt disclosure when the source transcript was truncated.
 */
export function postProcessTransformOutput(
  rawOutput: string,
  mode: TransformMode,
  cleanedTranscript: string,
  options?: { truncated?: boolean; wordCount?: number }
): string {
  if (!rawOutput || typeof rawOutput !== 'string') return '';

  // Preserve fenced code blocks untouched while cleaning prose segments
  const parts = rawOutput.split(/(```[\s\S]*?```)/g);
  let text = parts
    .map((part, idx) =>
      part.startsWith('```') && part.endsWith('```')
        ? part
        : cleanNonCodeSegment(part, idx === 0)
    )
    .join('')
    .trim();

  if (mode === 'script') {
    const cleanedLines = text
      .split('\n')
      .map((line) => {
        if (line.trim().startsWith('```')) return line;
        const trimmed = line.trim();
        const hadSpeakerLabel = /^(?:Narrator|Speaker|Host|Voiceover)\s*:/i.test(trimmed);
        let next = trimmed.replace(/^(?:Narrator|Speaker|Host|Voiceover)\s*:\s*/i, '');
        if (hadSpeakerLabel) {
          next = next.replace(/^["“](.+)["”]$/, '$1');
        }
        return next;
      })
      .filter((line) => !STAGE_DIRECTION_LINE_REGEX.test(line.trim()))
      .map((line) => line.replace(/^[•*-]\s+/, ''));

    text = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (mode === 'notes' && cleanedTranscript) {
    const lines = text.split('\n');
    let inQuotesSection = false;
    let quotesSectionHeaderSeen = false;
    let verifiedQuotesCount = 0;
    let quotesInsertIndex = -1;
    const filtered: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(?:Exact Quotations|Verbatim Quotes)\s*:?\s*$/i.test(trimmed)) {
        inQuotesSection = true;
        quotesSectionHeaderSeen = true;
        filtered.push('Exact Quotations');
        quotesInsertIndex = filtered.length;
        continue;
      }

      if (
        inQuotesSection &&
        trimmed.length > 0 &&
        !/^[•*-]/.test(trimmed) &&
        !/^["“]/.test(trimmed) &&
        !/^\(Include\b/i.test(trimmed)
      ) {
        inQuotesSection = false;
      }

      if (inQuotesSection) {
        if (!trimmed) {
          filtered.push(line);
          continue;
        }
        const quoteMatch = trimmed.match(
          /^[•*-]?\s*["“]([^"”]+)["”](?:\s*(\[\d{1,2}:\d{2}(?::\d{2})?\]))?\s*$/
        );
        if (quoteMatch) {
          const candidate = quoteMatch[1].trim();
          const tsSuffix = quoteMatch[2] ? ` ${quoteMatch[2]}` : '';
          if (verifyQuoteAgainstTranscript(candidate, cleanedTranscript)) {
            filtered.push(`• "${candidate}"${tsSuffix}`);
            verifiedQuotesCount++;
          }
          // Omit unverified or altered quotations rather than presenting paraphrases as exact quotes
          continue;
        }
        // Drop stray non-quoted instruction echoes or unverified bullets inside Exact Quotations
        continue;
      }

      filtered.push(line);
    }

    if (quotesSectionHeaderSeen && verifiedQuotesCount === 0 && quotesInsertIndex >= 0) {
      filtered.splice(
        quotesInsertIndex,
        0,
        '• None verified word-for-word from transcript (see paraphrased Key Concepts above).'
      );
    }

    text = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (options?.truncated && text.length > 0) {
    const countLabel = options.wordCount ? `${options.wordCount.toLocaleString()}-word ` : '';
    const disclosure = `[Note: Generated from beginning, middle, and conclusion excerpts of a long ${countLabel}transcript.]`;
    if (!text.includes('Generated from beginning, middle, and conclusion excerpts')) {
      text = `${text}\n\n${disclosure}`;
    }
  }

  return text;
}

/**
 * Deterministic usability & structure check to prevent returning empty, refusal-only,
 * or structurally broken responses as apparent successes.
 */
export function validateTransformOutput(
  output: string,
  mode: TransformMode,
  sourceWordCount = 100
): OutputValidationResult {
  const trimmed = (output || '').trim();
  if (!trimmed) {
    return { valid: false, reason: 'Empty model output.' };
  }

  // Strip truncation disclosure footer before measuring content length
  const contentOnly = trimmed
    .replace(/\[Note: Generated from beginning, middle, and conclusion excerpts[^\]]*\]/g, '')
    .trim();

  const minChars = sourceWordCount < 20 ? 15 : 35;
  const words = contentOnly.split(/\s+/).filter(Boolean);
  const minWords = sourceWordCount < 20 ? 3 : 7;

  if (contentOnly.length < minChars || words.length < minWords) {
    return { valid: false, reason: 'Model output is too short to be usable.' };
  }

  if (/^(?:i cannot fulfill|i am sorry,? i cannot|as an ai language model)/i.test(contentOnly)) {
    return { valid: false, reason: 'Model returned a refusal instead of a transformation.' };
  }

  const nonEmptyLines = contentOnly
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  switch (mode) {
    case 'summary':
      if (nonEmptyLines.length < 3 || !/[•*-]\s+\S/.test(contentOnly)) {
        return { valid: false, reason: 'Summary is missing structured bullet takeaways.' };
      }
      break;
    case 'script':
      if (nonEmptyLines.length < 2) {
        return { valid: false, reason: 'Script output lacks spoken body lines.' };
      }
      break;
    case 'blog':
      if (nonEmptyLines.length < 2) {
        return { valid: false, reason: 'Article output lacks body paragraphs.' };
      }
      break;
    case 'thread':
      if (!/\b1\s*\/\s*\d+/.test(contentOnly) && nonEmptyLines.length < 2) {
        return { valid: false, reason: 'Thread output lacks numbered posts.' };
      }
      break;
    case 'notes':
      if (!/[•*-]\s+\S/.test(contentOnly) || !/(?:\bQ\s*:|[?؟？])/.test(contentOnly)) {
        return { valid: false, reason: 'Study notes output is missing concepts or comprehension questions.' };
      }
      break;
  }

  return { valid: true };
}

const TRANSLATE_PREAMBLE_REGEX =
  /^(?:here is|below is|sure[,!]?\s+here is)\s+(?:the\s+|your\s+)?[\p{L}\s()-]{0,35}\btranslation\b[^\n]*:\s*\n+/iu;
const BULLET_LINE_REGEX = /^[ \t]*(?:[•・]\s*\S|[-*][ \t]+\S)/u;
const NUMBERED_LINE_REGEX = /^[ \t]*\d+(?:[.)、]|\s*\/\s*\d+)\s*\S/u;
const MD_HEADING_LINE_REGEX = /^[ \t]*#{1,6}[ \t]+\S/;
const LEADING_TIMESTAMP_REGEX = /^[ \t]*(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*\S/;
const ANY_TIMESTAMP_REGEX = /\[\d{1,2}:\d{2}(?::\d{2})?\]/g;

function isStandalonePlainHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (
    MD_HEADING_LINE_REGEX.test(t) ||
    BULLET_LINE_REGEX.test(t) ||
    NUMBERED_LINE_REGEX.test(t) ||
    LEADING_TIMESTAMP_REGEX.test(t) ||
    /^["“'‘\[]/.test(t)
  ) {
    return false;
  }
  return !/[.。;]$/.test(t);
}

/**
 * Post-processes translated output without stripping Markdown, bold/italics, headings, or lists:
 * - Strips accidental translator preambles ("Here is the Spanish translation:")
 * - Restores fenced code blocks verbatim from the source when fence counts match
 * - Repairs accidental inline timestamp or "• " bullet merges when the source exclusively used them as line prefixes
 */
export function postProcessTranslateOutput(rawOutput: string, sourceText: string): string {
  if (!rawOutput || typeof rawOutput !== 'string') return '';

  let normalized = rawOutput.replace(/\r\n?/g, '\n').trim();
  if (!TRANSLATE_PREAMBLE_REGEX.test(sourceText || '')) {
    normalized = normalized.replace(TRANSLATE_PREAMBLE_REGEX, '').trim();
  }

  const srcFences = (sourceText || '').match(/```[\s\S]*?```/g) ?? [];
  const outFenceCount = (normalized.match(/```[\s\S]*?```/g) ?? []).length;
  if (srcFences.length > 0 && outFenceCount === srcFences.length) {
    let fenceIdx = 0;
    normalized = normalized.replace(/```[\s\S]*?```/g, () => srcFences[fenceIdx++]);
  }

  const srcWithoutCode = (sourceText || '').replace(/```[\s\S]*?```/g, '');
  const srcLines = srcWithoutCode.split('\n').map((l) => l.trim()).filter(Boolean);
  const srcLeadingTsLines = srcLines.filter((l) => /^\[\d{1,2}:\d{2}(?::\d{2})?\]/.test(l)).length;
  const srcTotalTs = (srcWithoutCode.match(ANY_TIMESTAMP_REGEX) ?? []).length;
  const shouldSplitInlineTimestamps = srcLeadingTsLines >= 2 && srcLeadingTsLines === srcTotalTs;

  const srcLeadingDotBullets = srcLines.filter((l) => /^•\s*\S/.test(l)).length;
  const srcTotalDots = (srcWithoutCode.match(/•/g) ?? []).length;
  const shouldSplitInlineDotBullets = srcLeadingDotBullets >= 2 && srcLeadingDotBullets === srcTotalDots;

  if (!shouldSplitInlineTimestamps && !shouldSplitInlineDotBullets) {
    return normalized.replace(/\n{3,}/g, '\n\n').trim();
  }

  const parts = normalized.split(/(```[\s\S]*?```)/g);
  const repaired = parts
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```')) return part;
      let next = part;
      if (shouldSplitInlineTimestamps) {
        next = next.replace(/([^\n])\s+(\[\d{1,2}:\d{2}(?::\d{2})?\])/g, '$1\n$2');
      }
      if (shouldSplitInlineDotBullets) {
        next = next.replace(/([^\n])\s+(•\s+)/g, '$1\n$2');
      }
      return next;
    })
    .join('');

  return repaired.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Deterministically validates that translated output preserves the structural elements
 * of the source (paragraphs/sections, headings, bullet/numbered lists, Markdown, code blocks,
 * and ordered segment timestamps) rather than silently returning flattened blocks of text.
 */
export function validateTranslateOutput(
  translated: string,
  source: string
): OutputValidationResult {
  const outTrimmed = (translated || '').trim();
  const srcTrimmed = (source || '').trim();

  if (!outTrimmed) {
    return { valid: false, reason: 'Empty translation output.' };
  }

  if (/^(?:i cannot fulfill|i am sorry,? i cannot|as an ai language model)/i.test(outTrimmed)) {
    return { valid: false, reason: 'Model returned a refusal instead of a translation.' };
  }

  // 1. Fenced code blocks
  const srcCodeBlocks = srcTrimmed.match(/```[\s\S]*?```/g) ?? [];
  const outCodeBlocks = outTrimmed.match(/```[\s\S]*?```/g) ?? [];
  if (srcCodeBlocks.length !== outCodeBlocks.length) {
    return { valid: false, reason: 'Translation altered or dropped fenced code blocks.' };
  }

  const srcProse = srcTrimmed.replace(/```[\s\S]*?```/g, '\n[CODE_BLOCK]\n').trim();
  const outProse = outTrimmed.replace(/```[\s\S]*?```/g, '\n[CODE_BLOCK]\n').trim();

  const srcNonWs = srcProse.replace(/\s+/g, '').length;
  const outNonWs = outProse.replace(/\s+/g, '').length;
  if (srcNonWs >= 30 && outNonWs < Math.min(8, Math.floor(srcNonWs * 0.15))) {
    return { valid: false, reason: 'Translation output is unexpectedly truncated or empty.' };
  }

  // 2. Timestamps & segment order
  const srcTimestamps = srcProse.match(ANY_TIMESTAMP_REGEX) ?? [];
  const outTimestamps = outProse.match(ANY_TIMESTAMP_REGEX) ?? [];

  if (srcTimestamps.length === 0 && outTimestamps.length > 0) {
    return { valid: false, reason: 'Translation added timestamps that were absent from the source.' };
  }

  if (srcTimestamps.length > 0) {
    const minTs = srcTimestamps.length <= 3 ? srcTimestamps.length : Math.ceil(srcTimestamps.length * 0.85);
    if (outTimestamps.length < minTs) {
      return { valid: false, reason: 'Translation dropped source timestamps.' };
    }
    const allowedSet = new Set(srcTimestamps);
    for (const ts of outTimestamps) {
      if (!allowedSet.has(ts)) {
        return { valid: false, reason: 'Translation introduced altered or invalid timestamps.' };
      }
    }
    let srcCursor = 0;
    let matchedInOrder = 0;
    for (const ts of outTimestamps) {
      while (srcCursor < srcTimestamps.length && srcTimestamps[srcCursor] !== ts) {
        srcCursor++;
      }
      if (srcCursor < srcTimestamps.length) {
        matchedInOrder++;
        srcCursor++;
      }
    }
    if (matchedInOrder < outTimestamps.length) {
      return { valid: false, reason: 'Translation reordered timestamped segments.' };
    }

    const srcLeadingTsCount = srcProse.split('\n').filter((l) => LEADING_TIMESTAMP_REGEX.test(l)).length;
    const outLeadingTsCount = outProse.split('\n').filter((l) => LEADING_TIMESTAMP_REGEX.test(l)).length;
    if (srcLeadingTsCount >= 2) {
      const minLeading = srcLeadingTsCount <= 3 ? srcLeadingTsCount : Math.ceil(srcLeadingTsCount * 0.85);
      if (outLeadingTsCount < minLeading) {
        return { valid: false, reason: 'Translation flattened line-separated timestamped segments.' };
      }
    }
  }

  // 3. Markdown headings (# .. ######)
  const srcLines = srcProse.split('\n').map((l) => l.trim()).filter(Boolean);
  const outLines = outProse.split('\n').map((l) => l.trim()).filter(Boolean);

  const srcMdHeadings = srcLines.filter((l) => MD_HEADING_LINE_REGEX.test(l)).length;
  const outMdHeadings = outLines.filter((l) => MD_HEADING_LINE_REGEX.test(l)).length;
  if (srcMdHeadings > 0 && outMdHeadings < srcMdHeadings) {
    return { valid: false, reason: 'Translation lost Markdown heading formatting.' };
  }

  // 4. Bullet and numbered lists
  const srcBullets = srcLines.filter((l) => BULLET_LINE_REGEX.test(l)).length;
  const outBullets = outLines.filter((l) => BULLET_LINE_REGEX.test(l)).length;
  if (srcBullets > 0) {
    const minBullets = srcBullets <= 3 ? srcBullets : Math.ceil(srcBullets * 0.8);
    if (outBullets < minBullets) {
      return { valid: false, reason: 'Translation lost bullet list structure.' };
    }
  }

  const srcNumbered = srcLines.filter((l) => NUMBERED_LINE_REGEX.test(l)).length;
  const outNumbered = outLines.filter((l) => NUMBERED_LINE_REGEX.test(l)).length;
  if (srcNumbered > 0) {
    const minNumbered = srcNumbered <= 3 ? srcNumbered : Math.ceil(srcNumbered * 0.8);
    if (outNumbered < minNumbered) {
      return { valid: false, reason: 'Translation lost numbered list structure.' };
    }
  }

  // 5. Inline code & Markdown bold
  const srcInlineCode = (srcProse.match(/`[^`\n]+`/g) ?? []).length;
  const outInlineCode = (outProse.match(/`[^`\n]+`/g) ?? []).length;
  if (srcInlineCode > 0 && outInlineCode === 0) {
    return { valid: false, reason: 'Translation stripped inline code formatting.' };
  }

  const srcBold = (srcProse.match(/\*\*[^\s*](?:[^\n*]*?[^\s*])?\*\*/g) ?? []).length;
  const outBold = (outProse.match(/\*\*[^\s*](?:[^\n*]*?[^\s*])?\*\*/g) ?? []).length;
  if (srcBold > 0 && outBold === 0) {
    return { valid: false, reason: 'Translation stripped Markdown bold formatting.' };
  }

  // 6. Paragraph blocks & standalone section headings (anti-flattening)
  const srcBlocks = srcProse.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const outBlocks = outProse.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  if (srcBlocks.length >= 2) {
    const minBlocks = srcBlocks.length === 2 ? 2 : Math.max(2, Math.ceil(srcBlocks.length * 0.75));
    if (outBlocks.length < minBlocks) {
      return { valid: false, reason: 'Translation collapsed separate paragraphs or sections into a flat block.' };
    }
  } else if (srcLines.length >= 2 && outLines.length < 2) {
    if (
      isStandalonePlainHeading(srcLines[0]) ||
      MD_HEADING_LINE_REGEX.test(srcLines[0]) ||
      BULLET_LINE_REGEX.test(srcLines[0]) ||
      NUMBERED_LINE_REGEX.test(srcLines[0]) ||
      LEADING_TIMESTAMP_REGEX.test(srcLines[0])
    ) {
      return { valid: false, reason: 'Translation flattened heading and body onto one line.' };
    }
  }

  if (srcBlocks.length >= 1 && outBlocks.length >= 1) {
    const firstSrcLines = srcBlocks[0].split('\n').map((l) => l.trim()).filter(Boolean);
    const firstOutLines = outBlocks[0].split('\n').map((l) => l.trim()).filter(Boolean);
    if (
      firstSrcLines.length >= 2 &&
      isStandalonePlainHeading(firstSrcLines[0]) &&
      firstOutLines.length < 2 &&
      outBlocks.length <= srcBlocks.length
    ) {
      return { valid: false, reason: 'Translation merged the opening heading into the body paragraph.' };
    }
  }

  return { valid: true };
}

/**
 * Redacts potential secrets, tokens, or internal URLs from error strings.
 */
export function sanitizePublicErrorMessage(rawMessage: unknown, fallback: string): string {
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) return fallback;
  const redacted = rawMessage
    .replace(/\b(?:sk_[a-zA-Z0-9_-]+|Bearer\s+[a-zA-Z0-9._-]+)\b/gi, '[REDACTED]')
    .replace(/https?:\/\/[^\s)]+/gi, '[URL]');
  return redacted.length > 220 ? fallback : redacted;
}

/**
 * Classifies Cloudflare Workers AI errors so invalid inputs, rate limits, quota exhaustion,
 * and auth failures NEVER escalate to expensive 70B fallback calls.
 */
export function classifyWorkersAiError(err: unknown): ClassifiedAiError {
  const rawMsg =
    typeof (err as any)?.message === 'string'
      ? (err as any).message
      : typeof err === 'string'
        ? err
        : '';
  const status = typeof (err as any)?.status === 'number' ? (err as any).status : 0;
  const lower = rawMsg.toLowerCase();

  // 1. Account rate limit, daily neuron quota, or billing cap -> NEVER escalate to 70B
  if (
    status === 429 ||
    status === 402 ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('daily limit') ||
    lower.includes('neurons') ||
    lower.includes('billing') ||
    lower.includes('capacity exceeded for account')
  ) {
    return {
      category: 'rate_or_quota',
      httpStatus: 429,
      code: 'AI_RATE_LIMITED',
      publicMessage:
        'AI processing limit reached or temporarily busy. Please wait a moment and try again.',
      allowModelFallback: false,
    };
  }

  // 2. Authentication / permission / binding misconfiguration -> NEVER escalate to 70B
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('authentication') ||
    lower.includes('invalid api token') ||
    lower.includes('not authorized')
  ) {
    return {
      category: 'auth_error',
      httpStatus: 503,
      code: 'AI_CONFIGURATION_ERROR',
      publicMessage: 'The AI service is temporarily unavailable due to a configuration issue.',
      allowModelFallback: false,
    };
  }

  // 3. Invalid request / bad parameter / context window exceeded -> NEVER escalate to 70B
  // (Note: 5028 model deprecation is NOT an input error—it IS eligible for model fallback!)
  const isModelDeprecationOrMissing =
    lower.includes('5028') ||
    lower.includes('deprecated') ||
    lower.includes('model not found') ||
    lower.includes('no such model') ||
    lower.includes('unsupported model') ||
    status === 404;

  if (
    !isModelDeprecationOrMissing &&
    (status === 400 ||
      status === 413 ||
      lower.includes('invalid parameter') ||
      lower.includes('invalid input') ||
      lower.includes('bad request') ||
      lower.includes('context length') ||
      lower.includes('maximum context') ||
      lower.includes('prompt is too long'))
  ) {
    return {
      category: 'invalid_input',
      httpStatus: 400,
      code: 'AI_INVALID_INPUT',
      publicMessage: 'The transcript could not be processed due to an invalid input format or size.',
      allowModelFallback: false,
    };
  }

  // 4. Model deprecation / 404 / transient 5xx / timeout -> eligible for bounded fallback
  return {
    category: 'retriable_upstream',
    httpStatus: 502,
    code: 'AI_UPSTREAM_ERROR',
    publicMessage: 'The AI service encountered a temporary error. Please try again shortly.',
    allowModelFallback: true,
  };
}

export class BoundedAiError extends Error {
  public readonly classified: ClassifiedAiError;
  public readonly attempts: number;

  constructor(classified: ClassifiedAiError, attempts: number) {
    super(classified.publicMessage);
    this.name = 'BoundedAiError';
    this.classified = classified;
    this.attempts = attempts;
  }
}

/**
 * Executes chat inference starting on @cf/meta/llama-3.1-8b-instruct-fast with strict bounds:
 * - Hard cap of maxTotalCalls (default 3) across the entire request.
 * - Falls back to secondary models ONLY when classifyWorkersAiError allows fallback
 *   (model deprecation / 404 / transient 5xx), NEVER on 400/401/403/429/quota errors.
 * - Optional outputValidator: if the primary model returns empty or invalid structure,
 *   retries ONCE on the same cheap primary model before failing cleanly (without escalating to 70B).
 */
export async function executeBoundedAiChat(options: {
  ai: any;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  maxTokens: number;
  temperature: number;
  models?: readonly string[];
  maxTotalCalls?: number;
  processAndValidate?: (rawText: string) => { processed: string; validation: OutputValidationResult };
}): Promise<{ text: string; modelUsed: string; attempts: number }> {
  const models = options.models ?? ACTIVE_TEXT_MODELS;
  const maxCalls = Math.min(Math.max(options.maxTotalCalls ?? 3, 1), 3);

  let attempts = 0;
  let lastClassified: ClassifiedAiError | null = null;

  for (let mIdx = 0; mIdx < models.length && attempts < maxCalls; mIdx++) {
    const model = models[mIdx];

    try {
      attempts++;
      const res = await options.ai.run(model, {
        messages: options.messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
      });

      const rawText = (res?.response ?? res?.result?.response ?? '').trim();

      if (!options.processAndValidate) {
        if (rawText) {
          return { text: rawText, modelUsed: model, attempts };
        }
        // Empty response: allow at most 1 retry on the SAME model (do NOT jump to 70B)
        if (attempts < maxCalls) {
          attempts++;
          const retryRes = await options.ai.run(model, {
            messages: options.messages,
            max_tokens: options.maxTokens,
            temperature: 0.1,
          });
          const retryText = (retryRes?.response ?? retryRes?.result?.response ?? '').trim();
          if (retryText) {
            return { text: retryText, modelUsed: model, attempts };
          }
        }
        throw new BoundedAiError(
          {
            category: 'retriable_upstream',
            httpStatus: 502,
            code: 'EMPTY_AI_RESPONSE',
            publicMessage: 'The AI model returned an empty response. Please try again.',
            allowModelFallback: false,
          },
          attempts
        );
      }

      const firstCheck = options.processAndValidate(rawText);
      if (firstCheck.validation.valid) {
        return { text: firstCheck.processed, modelUsed: model, attempts };
      }

      // Controlled single validation retry on the SAME model (never escalates to 70B for format slip)
      if (attempts < maxCalls) {
        attempts++;
        const retryNotice = `\n\nIMPORTANT: Your previous draft was rejected (${firstCheck.validation.reason || 'invalid format'}). Strictly preserve all required headings, line breaks, lists, timestamps, code blocks, and source-grounding rules without adding commentary.`;
        const strictMessages: Array<{ role: 'system' | 'user'; content: string }> =
          options.messages[0]?.role === 'system'
            ? [
                { role: 'system', content: `${options.messages[0].content}${retryNotice}` },
                ...options.messages.slice(1),
              ]
            : [
                ...options.messages.slice(0, -1),
                {
                  role: 'user',
                  content: `${options.messages[options.messages.length - 1].content}${retryNotice}`,
                },
              ];

        const retryRes = await options.ai.run(model, {
          messages: strictMessages,
          max_tokens: options.maxTokens,
          temperature: 0.1,
        });
        const retryRaw = (retryRes?.response ?? retryRes?.result?.response ?? '').trim();
        const secondCheck = options.processAndValidate(retryRaw);
        if (secondCheck.validation.valid) {
          return { text: secondCheck.processed, modelUsed: model, attempts };
        }
      }

      throw new BoundedAiError(
        {
          category: 'invalid_input',
          httpStatus: 422,
          code: 'OUTPUT_VALIDATION_FAILED',
          publicMessage:
            'The generated output did not pass quality validation. Please try running the transformation again.',
          allowModelFallback: false,
        },
        attempts
      );
    } catch (err: unknown) {
      if (err instanceof BoundedAiError) {
        throw err;
      }
      const classified = classifyWorkersAiError(err);
      lastClassified = classified;

      if (!classified.allowModelFallback) {
        throw new BoundedAiError(classified, attempts);
      }
      // Otherwise continue loop to next fallback model (bounded by maxCalls)
    }
  }

  throw new BoundedAiError(
    lastClassified ?? {
      category: 'retriable_upstream',
      httpStatus: 502,
      code: 'AI_UPSTREAM_ERROR',
      publicMessage: 'The AI service is temporarily unavailable. Please try again shortly.',
      allowModelFallback: false,
    },
    attempts
  );
}
