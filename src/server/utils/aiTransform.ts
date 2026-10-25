// Pragmatic, zero-extra-cost AI Transform preprocessing, prompt builder, and lightweight post-validation.

export type TransformMode = 'summary' | 'script' | 'blog' | 'thread' | 'notes';

export interface CleanedTranscript {
  cleanedText: string;
  wordCount: number;
}

export interface BudgetedTranscript {
  text: string;
  truncated: boolean;
}

export interface TransformPromptSpec {
  mode: TransformMode;
  temperature: number;
  maxTokens: number;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}

const CAPTION_NOISE_REGEX =
  /\[(?:music|applause|laughter|cheering|silence|inaudible|sound[^\]]*|sfx[^\]]*|♪+|\s*)\]/gi;
const PAREN_NOISE_REGEX = /\((?:music|applause|laughter|cheering|upbeat music[^)]*)\)/gi;
const MUSIC_GLYPH_REGEX = /[♪♫♬]+/g;

/**
 * Strips non-speech caption artifacts ([Music], [Applause], ♪) and normalizes whitespace
 * so speech-to-text noise does not split phrases mid-sentence.
 */
export function cleanTranscriptForAi(rawText: string): CleanedTranscript {
  if (!rawText) {
    return { cleanedText: '', wordCount: 0 };
  }

  const cleanedText = rawText
    .replace(CAPTION_NOISE_REGEX, ' ')
    .replace(PAREN_NOISE_REGEX, ' ')
    .replace(MUSIC_GLYPH_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const wordCount = cleanedText ? cleanedText.split(/\s+/).filter(Boolean).length : 0;
  return { cleanedText, wordCount };
}

function sliceAtWordBoundary(text: string, start: number, end: number): string {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(text.length, end);
  let chunk = text.slice(safeStart, safeEnd);

  if (safeStart > 0) {
    const firstSpace = chunk.indexOf(' ');
    if (firstSpace > 0 && firstSpace < 40) {
      chunk = chunk.slice(firstSpace + 1);
    }
  }
  if (safeEnd < text.length) {
    const lastSpace = chunk.lastIndexOf(' ');
    if (lastSpace > chunk.length - 40 && lastSpace > 0) {
      chunk = chunk.slice(0, lastSpace);
    }
  }
  return chunk.trim();
}

/**
 * Preserves head (40%), middle (30%), and conclusion (30%) when a transcript exceeds maxChars,
 * avoiding naive .slice(0, 14000) truncation that drops video conclusions on long lectures.
 */
export function budgetTranscriptForPrompt(
  cleanedText: string,
  maxChars = 14000
): BudgetedTranscript {
  if (cleanedText.length <= maxChars) {
    return { text: cleanedText, truncated: false };
  }

  const separator = '\n[...]\n';
  const usable = maxChars - separator.length * 2;
  const headLen = Math.floor(usable * 0.4);
  const midLen = Math.floor(usable * 0.3);
  const tailLen = usable - headLen - midLen;

  const midStart = Math.floor((cleanedText.length - midLen) / 2);

  const head = sliceAtWordBoundary(cleanedText, 0, headLen);
  const mid = sliceAtWordBoundary(cleanedText, midStart, midStart + midLen);
  const tail = sliceAtWordBoundary(cleanedText, cleanedText.length - tailLen, cleanedText.length);

  return {
    text: `${head}${separator}${mid}${separator}${tail}`,
    truncated: true,
  };
}

const SHARED_SYSTEM_PROMPT = `You are a precise editorial analyst working strictly from a video transcript.

STRICT GROUNDING & FIDELITY RULES:
1. CLOSED-BOOK SOURCE: Base every claim, concept, reason, and takeaway ONLY on what is explicitly stated in the Transcript.
2. TITLE USAGE: Use the Video Title only to spell proper nouns (such as speaker or subject names). Do NOT import outside biography, textbook definitions, or external facts that are absent from the Transcript. If the Transcript mentions a claim without explaining it (e.g., "says altruism is evil, but we'll get back to that"), report only what was stated—never invent the unstated explanation.
3. STANCE FIDELITY: Preserve the speaker's actual argument accurately, including controversial claims, using clear attribution ("According to the video...", "Rand argues..."). Never soften, sanitize, or contradict the speaker's thesis (for example, if the speaker advocates selfishness, NEVER rewrite it as "not a selfish act").
4. ASR TYPO REPAIR: Silently fix obvious speech-to-text split-word typos (e.g., "self nness" -> "selfishness") using immediate sentence context without altering meaning.
5. PLAIN TEXT ONLY: Output clean plain text. Do NOT use Markdown bold or heading symbols (no **, __, or ###). Do NOT include introductory or closing meta-commentary.`;

export function buildTransformPrompt(
  rawMode: string,
  videoTitle: string,
  transcriptText: string,
  wordCount: number
): TransformPromptSpec {
  const validModes: TransformMode[] = ['summary', 'script', 'blog', 'thread', 'notes'];
  const mode: TransformMode = validModes.includes(rawMode as TransformMode)
    ? (rawMode as TransformMode)
    : 'summary';

  const isShort = wordCount < 260;
  const isLong = wordCount >= 900;

  let temperature = 0.15;
  let maxTokens = 750;
  let taskInstruction = '';

  switch (mode) {
    case 'summary': {
      temperature = 0.15;
      maxTokens = isShort ? 450 : 750;
      const bulletRange = isShort ? '4 to 5' : isLong ? '6 to 8' : '5 to 6';
      taskInstruction = `Produce a faithful, zero-repetition summary scaled to this ${wordCount}-word transcript using these exact plain-text headings:

Executive Summary
Write 2 crisp sentences stating what the subject is and why the speaker says we need it.

Key Takeaways
Provide ${bulletRange} bullet points starting with "• <Short Label>: ".
Cover EVERY distinct claim, tension, or step in the transcript in sequence—do not skip why an idea is controversial, core conditions or rules, how key terms are defined vs. misunderstood, or the stated outcome. Keep cause-and-effect relationships strictly faithful to the speaker's logic, and do not repeat the Executive Summary.

Bottom Line
Write 1 sharp closing sentence capturing the transcript's final takeaway or closing question without repeating the phrasing of the Executive Summary.`;
      break;
    }

    case 'script': {
      temperature = 0.35;
      maxTokens = 600;
      taskInstruction = `Rewrite this transcript into a punchy, high-retention spoken voiceover script (35–50 seconds, ~115–145 words) for TikTok, Reels, or YouTube Shorts.

STRICT SCRIPT RULES:
- Write 100% spoken teleprompter sentences meant to be read aloud word-for-word by a creator.
- Speak directly to the viewer ("you") in vivid, conversational rhythm—NEVER use dry book-report phrasing like "Her philosophy also states that" or "According to the transcript".
- Keep every factual claim faithful to the transcript (for example, do not confuse which concept the speaker calls "evil" vs. moral).
- NO bullet points, NO stage or camera directions like "(Cut to...)" or "(Music plays)", NO speaker labels like "Narrator:", and NO placeholders like "(insert link)".
- BANNED CLICHÉS: Never use "Meet [Name]", "dared to challenge the status quo", "not for the faint of heart", "on your own terms", "in today's world", or "join the conversation".
- Open HOOK with the boldest claim, tension, or question directly from the transcript so viewers stop scrolling in the first 2 seconds.
- End CTA with a sharp debate question rooted in the transcript's closing line.

Use these exact plain-text section headers:
HOOK (0-3s)
<1 to 2 spoken sentences>

BODY (3-42s)
<2 to 3 short spoken paragraphs—sentences only, zero bullets>

CTA (42-50s)
<1 to 2 spoken sentences ending with a viewer question>`;
      break;
    }

    case 'blog': {
      temperature = 0.25;
      maxTokens = isShort ? 550 : 950;
      const lengthGuide = isShort
        ? '190 to 250 words total (tight editorial brief—do NOT pad or inflate beyond the source material)'
        : isLong
          ? '450 to 650 words total'
          : '280 to 420 words total';

      taskInstruction = `Turn this transcript into a sharp, faithful article (${lengthGuide}).

STRICT ARTICLE RULES:
- Every sentence must convey concrete substance from the transcript. Never pad short transcripts with repetitive adjectives.
- If your opening raises a question (such as why the topic is controversial), answer it immediately using the exact reasons stated in the transcript.
- Attribute controversial claims accurately to the speaker ("Rand argues...", "Objectivism holds...")—never soften, apologize for, or contradict the speaker's actual thesis.
- Cover every core concept in the transcript (including non-contradiction, how key terms are defined, and the final conclusion).
- BANNED FILLER: Never write "this concept is crucial", "sets the stage", "from all walks of life", "meaningful and fulfilling", "fulfilling and meaningful", "live authentically", or "on one's own terms".
- Structure: Line 1 is a specific Headline, followed by a brief Introduction, 2 to 3 clear Subheadings, and a concise Conclusion grounded in the transcript's closing line.`;
      break;
    }

    case 'thread': {
      temperature = 0.3;
      maxTokens = 650;
      const postCount = isShort ? 5 : 6;
      taskInstruction = `Turn this transcript into a sharp ${postCount}-post X / LinkedIn thread.
- Number each post (1/${postCount}, 2/${postCount}, etc.).
- Post 1/${postCount} must open with the boldest claim or tension in the transcript (no "Thread 🧵" or "Meet [Name]" clichés).
- Posts 2 through ${postCount - 1} must each unpack one distinct principle from the transcript without outside padding.
- Post ${postCount}/${postCount} must close with the transcript's final takeaway or question.`;
      break;
    }

    case 'notes': {
      temperature = 0.1;
      maxTokens = isShort ? 600 : 850;
      const quoteCount = isShort ? '3 to 4' : '4 to 5';
      taskInstruction = `Create high-precision Study Notes strictly from the transcript using these exact plain-text headings:

Core Topic
1 concise sentence stating the topic, author/speaker (if named), and purpose described in the transcript.

Key Concepts & Definitions
• <Concept>: <Exact definition, premise, or role stated in the transcript. Include why the topic is controversial, foundational premises, non-contradiction, ethical definitions, and stated outcomes. Do NOT add outside explanations.>

Verbatim Quotes
• "<Exact word-for-word sentence or clause from the transcript—keep the exact words unchanged, only fixing obvious speech-to-text typos and standardizing capitalization/punctuation>"
(Include ${quoteCount} quotes. NEVER paraphrase or swap words inside quotation marks.)

Self-Test Questions
• Q: <Specific comprehension question testing a key argument or distinction in the transcript>
  A: <Concise 1-sentence answer grounded strictly in the transcript>
(Include 3 Q&A pairs.)`;
      break;
    }
  }

  return {
    mode,
    temperature,
    maxTokens,
    messages: [
      { role: 'system', content: SHARED_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Video Title (for proper-noun spelling only): ${videoTitle || 'Untitled Video'}\nTranscript Word Count: ${wordCount} words\n\nTask:\n${taskInstruction}\n\nTranscript:\n${transcriptText}`,
      },
    ],
  };
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Checks whether a candidate quote in Study Notes is genuinely grounded in the source transcript
 * (guards against fabricated quotes while tolerating minor ASR typo fixes like "self nness" -> "selfishness").
 */
export function isQuoteGroundedInTranscript(quote: string, cleanedTranscript: string): boolean {
  const quoteTokens = normalizeTokens(quote);
  if (quoteTokens.length === 0) return false;

  const transcriptTokens = normalizeTokens(cleanedTranscript);
  const transcriptNormalized = transcriptTokens.join(' ');
  const transcriptTokenSet = new Set(transcriptTokens);

  const matched = quoteTokens.filter((t) => transcriptTokenSet.has(t)).length;
  const tokenOverlap = matched / quoteTokens.length;

  if (quoteTokens.length >= 5) {
    let hasContiguousSpan = false;
    for (let i = 0; i <= quoteTokens.length - 4; i++) {
      const span = quoteTokens.slice(i, i + 4).join(' ');
      if (transcriptNormalized.includes(span)) {
        hasContiguousSpan = true;
        break;
      }
    }
    return tokenOverlap >= 0.8 && hasContiguousSpan;
  }

  return tokenOverlap >= 0.8;
}

/**
 * Lightweight, <1ms deterministic post-processor to strip Markdown artifacts,
 * remove accidental screenplay stage directions in scripts, and filter ungrounded quotes in notes.
 */
export function postProcessTransformOutput(
  rawOutput: string,
  mode: TransformMode,
  cleanedTranscript: string
): string {
  if (!rawOutput) return '';

  let text = rawOutput
    .replace(/^(?:here is|sure,? here is|below is)[^\n]*\n+/i, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#{1,4}\s+/gm, '')
    .trim();

  if (mode === 'script') {
    const cleanedLines = text
      .split('\n')
      .map((line) => {
        const hadSpeakerLabel = /^(?:Narrator|Speaker|Host|Voiceover)\s*:/i.test(line.trim());
        let next = line.trim().replace(/^(?:Narrator|Speaker|Host|Voiceover)\s*:\s*/i, '');
        if (hadSpeakerLabel) {
          next = next.replace(/^["“](.+)["”]$/, '$1');
        }
        return next;
      })
      // Drop standalone parenthetical stage directions like "(Upbeat music...)" or "(Cut to...)"
      .filter((line) => !/^\([^)]*\)$/.test(line))
      // Convert accidental bullet lines in voiceover body into plain spoken lines
      .map((line) => line.replace(/^[•*-]\s+/, ''));

    text = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (mode === 'notes' && cleanedTranscript) {
    const lines = text.split('\n');
    let inQuotesSection = false;
    const filtered: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^Verbatim Quotes$/i.test(trimmed)) {
        inQuotesSection = true;
        filtered.push(line);
        continue;
      }
      if (
        inQuotesSection &&
        trimmed.length > 0 &&
        !/^[•*-]/.test(trimmed) &&
        !/^["“]/.test(trimmed)
      ) {
        inQuotesSection = false;
      }

      if (inQuotesSection) {
        const quoteMatch = trimmed.match(/^[•*-]?\s*["“](.+?)["”]\s*$/);
        if (quoteMatch) {
          const candidate = quoteMatch[1];
          if (!isQuoteGroundedInTranscript(candidate, cleanedTranscript)) {
            continue; // Drop hallucinated or heavily paraphrased quote
          }
        }
      }
      filtered.push(line);
    }

    text = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return text;
}
