import { describe, it, expect } from 'vitest';
import app from '../server/index';
import {
  chunkTranscriptByTime,
  verifyAndAnchorQuote,
  separateAiExplanation,
  validateAndFilterParsedPack,
  generateVerifiedRevisionPack,
} from '../server/utils/revisionPackGenerator';
import {
  generateAnkiCsv,
  generatePackMarkdown,
  buildPrintablePackHtml,
} from '../utils/packExporters';
import { TranscriptSegment } from '../types';

const SAMPLE_LECTURE_SEGMENTS: TranscriptSegment[] = [
  {
    id: 1,
    start: 10,
    duration: 6,
    text: 'Mitochondria generate most of the chemical energy needed to power the cell biochemical reactions.',
  },
  {
    id: 2,
    start: 16,
    duration: 5,
    text: 'Chemical energy produced by the mitochondria is stored in a small molecule called adenosine triphosphate, or ATP.',
  },
  {
    id: 3,
    start: 724,
    duration: 6,
    text: 'Oxidative phosphorylation occurs across the inner mitochondrial membrane via the electron transport chain.',
  },
  {
    id: 4,
    start: 1420,
    duration: 6,
    text: 'Unlike nuclear DNA, mitochondrial DNA is inherited almost exclusively from the maternal line in mammals.',
  },
];

describe('Phase 1 — LearnFromClip Revision Pack & Accuracy Engine', () => {
  it('verifies verbatim quotes (ignoring punctuation/case) and rejects fabricated quotes', () => {
    const valid = verifyAndAnchorQuote(
      {
        start_seconds: 720,
        end_seconds: 730,
        quote: 'oxidative phosphorylation occurs across the inner mitochondrial membrane',
      },
      SAMPLE_LECTURE_SEGMENTS
    );
    expect(valid).not.toBeNull();
    expect(valid?.start_seconds).toBe(724);

    // Hallucinated / paraphrased quote must be rejected
    const hallucinated = verifyAndAnchorQuote(
      {
        start_seconds: 10,
        end_seconds: 20,
        quote: 'Chloroplasts convert sunlight into glucose during photosynthesis in plant cells.',
      },
      SAMPLE_LECTURE_SEGMENTS
    );
    expect(hallucinated).toBeNull();
  });

  it('drops unverified items and logs dropped count during server validation', () => {
    const rawDraft = {
      notes: [
        {
          heading: 'Bioenergetics',
          bullets: [
            {
              text: 'ATP stores chemical energy produced by mitochondria.',
              is_definition: true,
              term: 'ATP',
              source: {
                start_seconds: 16,
                end_seconds: 21,
                quote: 'stored in a small molecule called adenosine triphosphate, or ATP',
              },
              ai_explanation: 'ATP stands for adenosine 5-triphosphate.',
            },
            {
              text: 'Invented point not in the lecture.',
              source: {
                start_seconds: 50,
                end_seconds: 55,
                quote: 'This quote does not exist anywhere in the lecture transcript',
              },
            },
          ],
        },
      ],
      flashcards: [
        {
          front: 'Where does oxidative phosphorylation occur?',
          back: 'Across the inner mitochondrial membrane.',
          source: {
            start_seconds: 724,
            end_seconds: 730,
            quote: 'Oxidative phosphorylation occurs across the inner mitochondrial membrane',
          },
        },
        {
          front: 'Fake question?',
          back: 'Fake answer.',
          source: {
            start_seconds: 100,
            end_seconds: 105,
            quote: 'Completely fabricated quote that must be dropped',
          },
        },
      ],
      quiz: [],
    };

    const validated = validateAndFilterParsedPack(
      rawDraft,
      SAMPLE_LECTURE_SEGMENTS,
      'Arabic'
    );
    expect(validated.verifiedCount).toBe(2);
    expect(validated.droppedCount).toBe(2);
    expect(validated.notes[0].bullets).toHaveLength(1);
    expect(validated.notes[0].bullets[0].ai_explanation).toBe(
      'ATP stands for adenosine 5-triphosphate.'
    );
    expect(validated.flashcards).toHaveLength(1);
  });

  it('separates inline AI explanations so they never mix into lecture content', () => {
    const res = separateAiExplanation(
      'The inner membrane houses the electron transport chain. [AI explanation: Complex I to IV pump protons across this membrane.]'
    );
    expect(res.cleanLectureText).toBe(
      'The inner membrane houses the electron transport chain.'
    );
    expect(res.aiExplanation).toBe(
      'Complex I to IV pump protons across this membrane.'
    );
  });

  it('chunks a 60-minute lecture into 10-minute windows with 60-second overlap', () => {
    const sixtyMinSegments: TranscriptSegment[] = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1,
      start: i * 30, // every 30s up to 3600s (60 min)
      duration: 25,
      text: `Segment number ${i + 1} discusses key cellular mechanism ${i + 1} in detail.`,
    }));

    const chunks = chunkTranscriptByTime(sixtyMinSegments, 600, 60);
    expect(chunks.length).toBeGreaterThanOrEqual(6);
    // Verify overlap between chunk 0 and chunk 1
    expect(chunks[1].startSeconds).toBeLessThan(chunks[0].endSeconds);
  });

  it('rejects lectures exceeding the 2-hour free tier duration limit', async () => {
    const overTwoHours: TranscriptSegment[] = [
      {
        id: 1,
        start: 0,
        duration: 10,
        text: 'Introduction to the three hour seminar on thermodynamics.',
      },
      {
        id: 2,
        start: 7500, // > 7200s (2 hours)
        duration: 15,
        text: 'Final conclusion of the three hour seminar on thermodynamics.',
      },
    ];

    await expect(
      generateVerifiedRevisionPack({
        videoTitle: 'Long Seminar',
        segments: overTwoHours,
        isPaid: false,
      })
    ).rejects.toThrow(/2-hour maximum/);
  });

  it('POST /api/revision-pack produces verified notes, bilingual flashcards, and quiz, and exports Anki CSV + RTL PDF HTML', async () => {
    const res = await app.request(
      '/api/revision-pack',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: 'bio101',
          provider: 'youtube',
          videoTitle: 'Cell Biology Lecture',
          segments: SAMPLE_LECTURE_SEGMENTS,
          secondLanguage: 'Arabic',
        }),
      },
      { ENVIRONMENT: 'test' }
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);

    const pack = json.data;
    expect(pack.notes.length).toBeGreaterThan(0);
    expect(pack.flashcards.length).toBeGreaterThan(0);
    expect(pack.quiz.length).toBeGreaterThan(0);
    expect(pack.secondLanguage).toBe('Arabic');

    // Every item must have a verified quote in SAMPLE_LECTURE_SEGMENTS
    for (const sec of pack.notes) {
      for (const b of sec.bullets) {
        expect(verifyAndAnchorQuote(b.source, SAMPLE_LECTURE_SEGMENTS)).not.toBeNull();
      }
    }
    for (const c of pack.flashcards) {
      expect(verifyAndAnchorQuote(c.source, SAMPLE_LECTURE_SEGMENTS)).not.toBeNull();
      expect(c.front_translation).toBeDefined();
      expect(c.back_translation).toBeDefined();
    }
    for (const q of pack.quiz) {
      expect(verifyAndAnchorQuote(q.source, SAMPLE_LECTURE_SEGMENTS)).not.toBeNull();
    }

    // Verify Anki CSV export
    const csv = generateAnkiCsv(pack);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('From lecture ·');

    // Verify Markdown export
    const md = generatePackMarkdown(pack);
    expect(md).toContain('# Cell Biology Lecture — Revision Pack');
    expect(md).toContain('From lecture ·');

    // Verify PDF Printable HTML has Noto Sans Arabic and dir="rtl"
    const html = buildPrintablePackHtml(pack);
    expect(html).toContain('Noto Sans Arabic');
    expect(html).toContain('dir="rtl"');
  });
});
