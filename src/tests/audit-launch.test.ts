// Launch audit tests: every item here maps to a line in AUDIT_REPORT.md.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../server/index';
import {
  chunkTranscriptByTime,
  generateVerifiedRevisionPack,
  parseJsonFromLlmResponse,
  validateAndFilterParsedPack,
  verifyAndAnchorQuote,
  CHUNK_OVERLAP_SECONDS,
} from '../server/utils/revisionPackGenerator';
import {
  consumeQuota,
  getDailyQuotaStatus,
  normalizeIpForCeiling,
  reserveQuota,
  resetMemoryQuotasAndCacheForTests,
} from '../server/utils/quotasAndCache';
import {
  getActiveEntitlementForUser,
  processPaymentWebhook,
  readLemonSqueezyConfig,
  resetMemoryAuthAndPaymentsForTests,
  upsertEntitlement,
} from '../server/utils/paymentsAndAuth';
import { hmacSha256Hex } from '../server/utils/crypto';
import { scheduleFlashcardSm2, updateDailyStreak } from '../utils/sm2';
import { generateAnkiCsv, buildPrintablePackHtml } from '../utils/packExporters';
import { Flashcard, RevisionPack, TranscriptSegment } from '../types';

const PROD_SECRET = 'prod-cookie-secret-0123456789abcdef-XYZ';

// ------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------

/** Parses the CSV produced by generateAnkiCsv (RFC 4180) back into rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && src[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cookieFrom(res: Response, name: string): string | null {
  const all = (res.headers as any).getSetCookie?.() || [res.headers.get('set-cookie') || ''];
  for (const c of all) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return `${name}=${m[1]}`;
  }
  return null;
}

/** A 10-minute "normal" lecture: 60 caption lines of 10 s each. */
function buildNormalLecture(): TranscriptSegment[] {
  const topics = [
    'Enzymes are biological catalysts that speed up chemical reactions without being consumed',
    'The active site of an enzyme binds a specific substrate like a lock and key',
    'Temperature increases reaction rate until the enzyme starts to denature above its optimum',
    'Competitive inhibitors bind to the active site and compete with the substrate',
    'Non competitive inhibitors bind elsewhere and change the shape of the active site',
    'The Michaelis constant is the substrate concentration at half of the maximum rate',
  ];
  const segs: TranscriptSegment[] = [];
  for (let i = 0; i < 60; i++) {
    const t = topics[i % topics.length];
    segs.push({
      id: i + 1,
      start: i * 10,
      duration: 10,
      text: `${i % 2 === 0 ? 'So, ' : 'Now remember: '}${t.toLowerCase()} (point ${i + 1}).`,
    });
  }
  return segs;
}

function card(partial: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'c1',
    front: 'Q',
    back: 'A',
    source: { start_seconds: 0, end_seconds: 5, quote: 'q' },
    due_date: '2026-11-09',
    interval: 0,
    ease: 2.5,
    reps: 0,
    ...partial,
  };
}

beforeEach(() => {
  resetMemoryQuotasAndCacheForTests();
  resetMemoryAuthAndPaymentsForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------------------------------
// Accuracy engine
// ------------------------------------------------------------------------------------------
describe('Accuracy: quote verification', () => {
  const segs: TranscriptSegment[] = [
    { id: 1, start: 100, duration: 6, text: 'The Krebs cycle takes place in the mitochondrial matrix.' },
    { id: 2, start: 106, duration: 6, text: 'It produces NADH, FADH2 and two molecules of carbon dioxide.' },
    { id: 3, start: 2400, duration: 6, text: 'Glycolysis, by contrast, happens in the cytoplasm of the cell.' },
  ];

  it('rejects a fabricated quote', () => {
    expect(
      verifyAndAnchorQuote({ start_seconds: 100, end_seconds: 110, quote: 'The Krebs cycle happens in the nucleus of every cell' }, segs)
    ).toBeNull();
  });

  it('rejects a real quote cited at the wrong timestamp (40 minutes away)', () => {
    expect(
      verifyAndAnchorQuote({ start_seconds: 100, end_seconds: 106, quote: 'Glycolysis, by contrast, happens in the cytoplasm' }, segs)
    ).toBeNull();
  });

  it('rejects a quote with no timestamp at all', () => {
    expect(verifyAndAnchorQuote({ quote: 'The Krebs cycle takes place in the mitochondrial matrix' } as any, segs)).toBeNull();
  });

  it('accepts punctuation / case / whitespace differences and snaps the timestamp', () => {
    const v = verifyAndAnchorQuote(
      { start_seconds: 130, end_seconds: 140, quote: 'it PRODUCES nadh fadh2   and two molecules of carbon-dioxide' },
      segs
    );
    expect(v).not.toBeNull();
    expect(v!.start_seconds).toBe(106);
  });

  it('accepts a quote spanning two caption lines', () => {
    const v = verifyAndAnchorQuote(
      { start_seconds: 100, end_seconds: 112, quote: 'in the mitochondrial matrix. It produces NADH' },
      segs
    );
    expect(v?.start_seconds).toBe(100);
  });

  it('rejects trivially short quotes that would match anything', () => {
    expect(verifyAndAnchorQuote({ start_seconds: 100, end_seconds: 106, quote: 'in the' }, segs)).toBeNull();
    expect(verifyAndAnchorQuote({ start_seconds: 100, end_seconds: 106, quote: 'takes place' }, segs)).toBeNull();
  });

  it('rejects a quote that is mostly invented text wrapped around a real caption line', () => {
    const v = verifyAndAnchorQuote(
      {
        start_seconds: 100,
        end_seconds: 106,
        quote:
          'The Krebs cycle takes place in the mitochondrial matrix and was discovered by Albert Einstein in 1990 while studying quantum chromodynamics at night',
      },
      segs
    );
    expect(v).toBeNull();
  });

  it('drops invalid items and keeps valid ones in a mixed model response', () => {
    const result = validateAndFilterParsedPack(
      {
        notes: [
          {
            heading: 'Krebs',
            bullets: [
              { text: 'Krebs cycle location.', source: { start_seconds: 100, end_seconds: 106, quote: 'takes place in the mitochondrial matrix' } },
              { text: 'Invented.', source: { start_seconds: 100, end_seconds: 106, quote: 'the cycle was invented in Paris in 1802' } },
              { text: 'No source at all.' },
            ],
          },
        ],
        flashcards: [
          { front: 'Where?', back: 'Matrix', source: { start_seconds: 101, end_seconds: 106, quote: 'The Krebs cycle takes place in the mitochondrial matrix' } },
          { front: 'Wrong time?', back: 'x', source: { start_seconds: 2400, end_seconds: 2406, quote: 'It produces NADH, FADH2 and two molecules' } },
        ],
        quiz: [
          { question: 'Q?', options: ['a', 'b', 'c', 'd'], correct_index: 0, explanation: 'e', source: { start_seconds: 2400, end_seconds: 2406, quote: 'happens in the cytoplasm of the cell' } },
          { question: 'Bad options', options: ['a', 'b'], correct_index: 0, source: { start_seconds: 2400, end_seconds: 2406, quote: 'happens in the cytoplasm of the cell' } },
          { question: 'Bad index', options: ['a', 'b', 'c', 'd'], correct_index: 7, source: { start_seconds: 2400, end_seconds: 2406, quote: 'happens in the cytoplasm of the cell' } },
        ],
      },
      segs
    );
    expect(result.notes[0].bullets.length).toBe(1);
    expect(result.flashcards.length).toBe(1);
    expect(result.quiz.length).toBe(1);
    expect(result.droppedCount).toBe(5);
    for (const item of [...result.notes[0].bullets, ...result.flashcards, ...result.quiz]) {
      expect(item.source).toMatchObject({
        start_seconds: expect.any(Number),
        end_seconds: expect.any(Number),
        quote: expect.any(String),
      });
    }
  });

  it('keeps AI explanation in a separate field, never inside lecture text', () => {
    const result = validateAndFilterParsedPack(
      {
        notes: [
          {
            heading: 'K',
            bullets: [
              {
                text: 'The Krebs cycle runs in the matrix. AI explanation: it is also called the citric acid cycle',
                source: { start_seconds: 100, end_seconds: 106, quote: 'takes place in the mitochondrial matrix' },
              },
            ],
          },
        ],
        flashcards: [],
        quiz: [],
      },
      segs
    );
    const b = result.notes[0].bullets[0];
    expect(b.text).not.toMatch(/AI explanation/i);
    expect(b.ai_explanation).toMatch(/citric acid/);
  });
});

describe('Accuracy: model output robustness', () => {
  it('handles a model response that is not JSON at all (falls back to verified transcript items)', async () => {
    const ai = { run: vi.fn(async () => ({ response: 'Sure! Here are your notes: * enzymes are cool' })) };
    const pack = await generateVerifiedRevisionPack({ videoTitle: 'Enzymes', segments: buildNormalLecture() }, ai);
    expect(pack.quiz.length).toBe(10);
    expect(pack.flashcards.length).toBeGreaterThan(0);
    const segsText = buildNormalLecture().map((s) => s.text);
    for (const c of pack.flashcards) expect(segsText.some((t) => t.includes(c.source.quote) || c.source.quote.includes(t.slice(0, 20)))).toBe(true);
  });

  it('repairs JSON truncated by max_tokens and keeps the complete items', () => {
    const full = JSON.stringify({
      notes: [],
      flashcards: [
        { front: 'A?', back: 'a', source: { start_seconds: 0, end_seconds: 5, quote: 'x y z' } },
        { front: 'B?', back: 'b', source: { start_seconds: 0, end_seconds: 5, quote: 'x y z' } },
      ],
      quiz: [],
    });
    const truncated = full.slice(0, full.indexOf('"B?"') + 10); // cut in the middle of card 2
    const parsed = parseJsonFromLlmResponse('```json\n' + truncated);
    expect(parsed).not.toBeNull();
    expect(parsed.flashcards.length).toBeGreaterThanOrEqual(1);
    expect(parsed.flashcards[0].front).toBe('A?');
  });

  it('does not drop almost everything on a normal lecture (realistic model variance)', () => {
    const segs = buildNormalLecture();
    // Simulated model output: quotes copied from the transcript with the variance real models
    // show (case, punctuation, timestamps up to ~60s off, quotes spanning two lines), plus 2 fakes.
    const items = segs.slice(0, 40).map((s, i) => {
      const words = s.text.replace(/[.,:()]/g, '').split(' ');
      const quote =
        i % 4 === 0
          ? words.slice(1, 10).join(' ').toUpperCase()
          : i % 4 === 1
          ? `${words.slice(-4).join(' ')} ${segs[i + 1].text.split(' ').slice(0, 3).join(' ')}`
          : words.slice(2, 12).join(' ');
      return {
        front: `Question ${i}?`,
        back: `Answer ${i}`,
        source: { start_seconds: s.start + ((i * 17) % 60), end_seconds: s.start + 20, quote },
      };
    });
    items.push({ front: 'Fake 1?', back: 'x', source: { start_seconds: 30, end_seconds: 40, quote: 'enzymes are made of pure gold and silver' } });
    items.push({ front: 'Fake 2?', back: 'x', source: { start_seconds: 30, end_seconds: 40, quote: 'the michaelis constant equals the speed of light' } });

    const result = validateAndFilterParsedPack({ notes: [], flashcards: items, quiz: [] }, segs);
    const keptRate = result.flashcards.length / 40;
    expect(keptRate).toBeGreaterThanOrEqual(0.9);
    expect(result.flashcards.find((c) => c.front.startsWith('Fake'))).toBeUndefined();
  });
});

describe('Accuracy: long lectures are chunked by time and merged without duplicates', () => {
  it('covers the WHOLE of a 2-hour lecture (no skipped windows)', async () => {
    const segs: TranscriptSegment[] = [];
    for (let t = 0; t < 7200; t += 15) {
      segs.push({ id: segs.length + 1, start: t, duration: 15, text: `At minute ${Math.floor(t / 60)} the lecturer explains concept number ${t}.` });
    }
    const prompts: string[] = [];
    const ai = {
      run: vi.fn(async (_model: string, payload: any) => {
        prompts.push(payload.messages[1].content);
        return { response: '{"notes":[],"flashcards":[],"quiz":[]}' };
      }),
    };
    await generateVerifiedRevisionPack({ videoTitle: 'Long', segments: segs, isPaid: true, maxCards: 150 }, ai);
    const firstModelPrompts = prompts.filter((_, i) => i % 2 === 0); // primary + fallback per chunk
    const covered = new Set<number>();
    for (const p of prompts) {
      for (const m of p.matchAll(/\[(\d+)s \|/g)) covered.add(Number(m[1]));
    }
    expect(firstModelPrompts.length).toBeLessThanOrEqual(6);
    expect(covered.has(0)).toBe(true);
    expect(covered.has(7185)).toBe(true);
    expect(covered.size).toBe(segs.length);
  });

  it('merges overlapping chunks without duplicate cards or quiz questions', async () => {
    const segs: TranscriptSegment[] = [];
    for (let t = 0; t < 1500; t += 10) {
      segs.push({ id: segs.length + 1, start: t, duration: 10, text: `Statement ${t} explains an important idea about thermodynamics clearly.` });
    }
    const chunks = chunkTranscriptByTime(segs);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].startSeconds).toBeLessThan(chunks[0].endSeconds); // overlap exists
    expect(chunks[0].endSeconds - chunks[1].startSeconds).toBeLessThanOrEqual(CHUNK_OVERLAP_SECONDS + 10);

    // The model returns the SAME card for the overlapping region in both chunks
    const dup = (start: number) => ({
      front: 'What does statement 560 explain?',
      back: 'Thermodynamics',
      source: { start_seconds: start, end_seconds: start + 10, quote: 'Statement 560 explains an important idea about thermodynamics' },
    });
    const ai = {
      run: vi.fn(async () => ({
        response: JSON.stringify({
          notes: [],
          flashcards: [dup(560)],
          quiz: [
            { question: 'Which statement is about thermodynamics at 560?', options: ['a', 'b', 'c', 'd'], correct_index: 0, explanation: 'x', source: { start_seconds: 560, end_seconds: 570, quote: 'Statement 560 explains an important idea about thermodynamics' } },
          ],
        }),
      })),
    };
    const pack = await generateVerifiedRevisionPack({ videoTitle: 'Thermo', segments: segs }, ai);
    const fronts = pack.flashcards.map((c) => c.front);
    expect(new Set(fronts).size).toBe(fronts.length);
    const qs = pack.quiz.map((q) => q.question);
    expect(new Set(qs).size).toBe(qs.length);
  });
});

// ------------------------------------------------------------------------------------------
// Study mode
// ------------------------------------------------------------------------------------------
describe('SM-2 interval maths', () => {
  const today = '2026-11-09';
  it('Again resets to 0 days (due today) and lowers ease by 0.2, floor 1.3', () => {
    const r = scheduleFlashcardSm2(card({ reps: 5, interval: 20, ease: 1.4 }), 'again', today);
    expect(r).toMatchObject({ reps: 0, interval: 0, ease: 1.3, due_date: today });
  });
  it('Good: 1 day, then 3 days, then interval × ease', () => {
    const r1 = scheduleFlashcardSm2(card(), 'good', today);
    expect(r1).toMatchObject({ interval: 1, reps: 1, due_date: '2026-11-10' });
    const r2 = scheduleFlashcardSm2(r1, 'good', today);
    expect(r2).toMatchObject({ interval: 3, reps: 2, due_date: '2026-11-12' });
    const r3 = scheduleFlashcardSm2(r2, 'good', today);
    expect(r3).toMatchObject({ interval: 8, reps: 3 }); // round(3 × 2.5) = 8
  });
  it('Hard: ×1.2 and ease −0.15; Easy: 4 days first, ease +0.15', () => {
    const h = scheduleFlashcardSm2(card({ reps: 3, interval: 10, ease: 2.5 }), 'hard', today);
    expect(h).toMatchObject({ interval: 12, ease: 2.35 });
    const e = scheduleFlashcardSm2(card(), 'easy', today);
    expect(e).toMatchObject({ interval: 4, ease: 2.65, due_date: '2026-11-13' });
    const e3 = scheduleFlashcardSm2(card({ reps: 2, interval: 10, ease: 2.5 }), 'easy', today);
    expect(e3.interval).toBe(33); // round(10 × 2.5 × 1.3) = 33 (32.5 rounds up)
  });
  it('crosses month/year boundaries in UTC', () => {
    const r = scheduleFlashcardSm2(card({ reps: 2, interval: 10, ease: 2.5 }), 'good', '2026-12-25');
    expect(r.due_date).toBe('2027-01-19');
  });
  it('streak: same UTC day unchanged, next day +1, gap resets', () => {
    expect(updateDailyStreak(4, '2026-11-09', '2026-11-09').streakDays).toBe(4);
    expect(updateDailyStreak(4, '2026-11-08', '2026-11-09').streakDays).toBe(5);
    expect(updateDailyStreak(4, '2026-11-06', '2026-11-09').streakDays).toBe(1);
    expect(updateDailyStreak(9, '2026-12-31', '2027-01-01').streakDays).toBe(10);
  });
});

// ------------------------------------------------------------------------------------------
// Export
// ------------------------------------------------------------------------------------------
describe('Export', () => {
  const pack: RevisionPack = {
    id: 'p',
    title: 'Pack',
    provider: 'youtube',
    videoId: 'v',
    durationSeconds: 60,
    secondLanguage: 'Arabic',
    notes: [],
    flashcards: [
      card({
        front: 'What is "ATP", exactly?',
        back: 'Energy, currency\nof the cell',
        back_translation: 'عملة الطاقة في الخلية',
        bilingual_language: 'Arabic',
        source: { start_seconds: 75, end_seconds: 80, quote: 'ATP is the "energy currency", folks' },
      }),
    ],
    quiz: [],
    metadata: { totalChunks: 1, verifiedItemsCount: 1, droppedQuotesCount: 0, generatedAt: 0, modelUsed: 'x' },
  };

  it('Anki CSV is valid RFC-4180: 3 columns (front, back, source timestamp), quotes/commas/newlines escaped', () => {
    const rows = parseCsv(generateAnkiCsv(pack));
    expect(rows.length).toBe(1);
    expect(rows[0].length).toBe(3);
    expect(rows[0][0]).toBe('What is "ATP", exactly?');
    expect(rows[0][1]).toContain('Energy, currency\nof the cell');
    expect(rows[0][1]).toContain('عملة الطاقة في الخلية');
    expect(rows[0][2]).toContain('01:15');
  });

  it('PDF HTML marks Arabic translations RTL and loads an Arabic font', () => {
    const html = buildPrintablePackHtml(pack);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('Noto Sans Arabic');
    expect(html).toContain('عملة الطاقة في الخلية');
  });
});

// ------------------------------------------------------------------------------------------
// Limits, abuse and cost protection
// ------------------------------------------------------------------------------------------
describe('Limits & abuse protection', () => {
  it('clearing cookies does NOT give unlimited AI actions: per-IP ceiling of 30/day', async () => {
    const ipKey = 'ip:same-network';
    let granted = 0;
    for (let browser = 0; browser < 20; browser++) {
      for (let i = 0; i < 3; i++) {
        const r = await reserveQuota({
          actorKey: `anon:cleared_cookie_${browser}`,
          networkFallbackKey: ipKey,
          plan: 'free',
          delta: { aiHalfUnits: 2 },
        });
        if (r.ok) granted++;
      }
    }
    expect(granted).toBe(30);
  });

  it('is campus-friendly: 10 students on one IP each still get their full 3 AI actions', async () => {
    const ipKey = 'ip:campus-nat';
    for (let s = 0; s < 10; s++) {
      for (let i = 0; i < 3; i++) {
        const r = await reserveQuota({ actorKey: `anon:student_${s}`, networkFallbackKey: ipKey, plan: 'free', delta: { aiHalfUnits: 2 } });
        expect(r.ok).toBe(true);
      }
      const fourth = await reserveQuota({ actorKey: `anon:student_${s}`, networkFallbackKey: ipKey, plan: 'free', delta: { aiHalfUnits: 2 } });
      expect(fourth.ok).toBe(false);
    }
  });

  it('parallel requests cannot overshoot the limit (atomic reservation)', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        reserveQuota({ actorKey: 'anon:racer', networkFallbackKey: 'ip:r', plan: 'free', delta: { aiHalfUnits: 2 } })
      )
    );
    expect(results.filter((r) => r.ok).length).toBe(3);
  });

  it('a failed job releases its reserved quota', async () => {
    const r = await reserveQuota({ actorKey: 'anon:fail', networkFallbackKey: 'ip:f', plan: 'free', delta: { links: 1 } });
    await r.release();
    const s = await getDailyQuotaStatus({ actorKey: 'anon:fail', networkFallbackKey: 'ip:f', plan: 'free' });
    expect(s.linksUsed).toBe(0);
  });

  it('IPv6 users share one ceiling per /64', () => {
    expect(normalizeIpForCeiling('2001:db8:1:2:aaaa::1')).toBe(normalizeIpForCeiling('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(normalizeIpForCeiling('2001:db8:1:3::1')).not.toBe(normalizeIpForCeiling('2001:db8:1:2::1'));
  });

  it('Exam Pass upload limit is 10 h per rolling week, Monthly 30 h per rolling 30 days, free 20 min/day', async () => {
    const day = (n: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    // 3 h on each of the last 3 days = 9 h this week
    for (const n of [0, 1, 2]) await consumeQuota({ actorKey: 'user:exam', utcDate: day(n), uploadSeconds: 3 * 3600 });
    await consumeQuota({ actorKey: 'user:exam', utcDate: day(9), uploadSeconds: 5 * 3600 }); // outside the week
    const exam = await getDailyQuotaStatus({ actorKey: 'user:exam', plan: 'exam_pass' });
    expect(exam.uploadWindow).toBe('week');
    expect(exam.uploadSecondsUsed).toBe(9 * 3600);
    expect(exam.uploadSecondsLimit).toBe(10 * 3600);

    const monthly = await getDailyQuotaStatus({ actorKey: 'user:exam', plan: 'monthly' });
    expect(monthly.uploadSecondsUsed).toBe(14 * 3600);
    expect(monthly.uploadSecondsLimit).toBe(30 * 3600);

    const free = await getDailyQuotaStatus({ actorKey: 'anon:x', plan: 'free' });
    expect(free.uploadSecondsLimit).toBe(20 * 60);
    expect(free.uploadWindow).toBe('day');
  });

  it('daily counters reset at 00:00 UTC (new UTC date = new bucket)', async () => {
    await consumeQuota({ actorKey: 'anon:reset', utcDate: '2026-11-08', aiHalfUnits: 6 });
    const yesterday = await getDailyQuotaStatus({ actorKey: 'anon:reset', plan: 'free', utcDate: '2026-11-08' });
    const today = await getDailyQuotaStatus({ actorKey: 'anon:reset', plan: 'free', utcDate: '2026-11-09' });
    expect(yesterday.aiActionsUsed).toBe(3);
    expect(today.aiActionsUsed).toBe(0);
  });
});

describe('API: server-side enforcement', () => {
  const env = { ENVIRONMENT: 'test' } as any;
  const segments = buildNormalLecture();

  it('ignores body.isPaid — free users stay at 30 cards', async () => {
    const res = await app.request(
      '/api/revision-pack',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-enforce-quota': '1', 'x-forwarded-for': '10.1.1.1' },
        body: JSON.stringify({ segments, videoTitle: 'Enzymes', isPaid: true }),
      },
      env
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.flashcards.length).toBeLessThanOrEqual(30);
  });

  it('free user: second fresh pack the same day is refused (1 quiz/day), cached pack costs 0.5', async () => {
    const headers = { 'Content-Type': 'application/json', 'x-enforce-quota': '1', 'x-forwarded-for': '10.2.2.2' };
    const first = await app.request('/api/revision-pack', { method: 'POST', headers, body: JSON.stringify({ segments, videoTitle: 'A' }) }, env);
    expect(first.status).toBe(200);
    const cookie = cookieFrom(first, 'lfc_aid')!;
    const other = segments.map((s) => ({ ...s, text: s.text + ' extra' }));
    const second = await app.request('/api/revision-pack', { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ segments: other, videoTitle: 'B' }) }, env);
    expect(second.status).toBe(429);
    const usage: any = await (await app.request('/api/usage', { headers: { ...headers, cookie } }, env)).json();
    expect(usage.data.aiActionsUsed).toBe(1);
  });

  it('cached transcripts do not use link quota', async () => {
    const { setCachedTranscript } = await import('../server/utils/quotasAndCache');
    await setCachedTranscript({
      id: 'x', provider: 'youtube', videoId: 'jNQXAC9IVRw', language: 'en', sourceType: 'captions',
      segments: [{ id: 1, start: 0, duration: 3, text: 'hello there everyone' }], fullText: 'hello there everyone', srt: '', vtt: '', createdAt: 0,
    });
    const headers = { 'Content-Type': 'application/json', 'x-enforce-quota': '1', 'x-forwarded-for': '10.3.3.3' };
    let cookie = '';
    for (let i = 0; i < 8; i++) {
      const res = await app.request('/api/transcript', { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }) }, env);
      expect(res.status).toBe(200);
      cookie = cookie || cookieFrom(res, 'lfc_aid')!;
    }
    const usage: any = await (await app.request('/api/usage', { headers: { cookie, 'x-enforce-quota': '1', 'x-forwarded-for': '10.3.3.3' } }, env)).json();
    expect(usage.data.linksUsed).toBe(0);
  });

  it('/api/admin/costs: stranger gets 401, unset token gets 403, correct token 200', async () => {
    const token = 'admin-token-0123456789abcdefghij';
    expect((await app.request('/api/admin/costs', {}, { ...env, ADMIN_TOKEN: token })).status).toBe(401);
    expect((await app.request('/api/admin/costs', { headers: { authorization: 'Bearer wrong-token-0123456789abcdef' } }, { ...env, ADMIN_TOKEN: token })).status).toBe(401);
    expect((await app.request('/api/admin/costs', {}, env)).status).toBe(403);
    expect((await app.request('/api/admin/costs', { headers: { authorization: `Bearer ${token}` } }, { ...env, ADMIN_TOKEN: token })).status).toBe(200);
  });

  it('production refuses to run without COOKIE_SECRET (no forgeable default secret)', async () => {
    const res = await app.request('/api/usage', {}, { ENVIRONMENT: 'production' } as any);
    expect(res.status).toBe(503);
    const ok = await app.request('/api/usage', {}, { ENVIRONMENT: 'production', COOKIE_SECRET: PROD_SECRET } as any);
    expect(ok.status).toBe(200);
  });

  it('per-IP burst rate limit on auth routes', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await app.request('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.9.9.9' },
        body: JSON.stringify({ email: `a${i}@example.com` }),
      }, env);
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('Turnstile: when configured, cost-bearing routes require a token; a passed check sets a 24h cookie', async () => {
    const tEnv = { ...env, TURNSTILE_SECRET_KEY: 'secret' };
    const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': '10.4.4.4' };
    const denied = await app.request('/api/revision-pack', { method: 'POST', headers, body: JSON.stringify({ segments }) }, tEnv);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as any).error.code).toBe('TURNSTILE_REQUIRED');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    const aid = cookieFrom(denied, 'lfc_aid')!;
    const ok = await app.request('/api/revision-pack', { method: 'POST', headers: { ...headers, cookie: aid, 'x-turnstile-token': 'tok' }, body: JSON.stringify({ segments }) }, tEnv);
    expect(ok.status).toBe(200);
    const hv = cookieFrom(ok, 'lfc_hv')!;
    expect(hv).toBeTruthy();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    const again = await app.request('/api/revision-pack', { method: 'POST', headers: { ...headers, cookie: `${aid}; ${hv}` }, body: JSON.stringify({ segments }) }, tEnv);
    expect(again.status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------
// Accounts & payments
// ------------------------------------------------------------------------------------------
describe('Magic link login', () => {
  it('production: never returns the link in the API response; refuses without an email provider', async () => {
    const prodEnv = { ENVIRONMENT: 'production', COOKIE_SECRET: PROD_SECRET } as any;
    const noProvider = await app.request('/api/auth/magic-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.5.5.1' }, body: JSON.stringify({ email: 'a@b.edu' }),
    }, prodEnv);
    expect(noProvider.status).toBe(503);

    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return new Response('{"id":"e1"}', { status: 200 });
    }));
    const res = await app.request('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.5.5.2', host: 'evil.example' },
      body: JSON.stringify({ email: 'student@uni.edu' }),
    }, { ...prodEnv, RESEND_API_KEY: 're_test' });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(JSON.stringify(json)).not.toContain('token=');
    expect(sent[0].url).toBe('https://api.resend.com/emails');
    // Link uses the canonical domain, never the attacker-controlled Host header
    expect(sent[0].body.text).toContain('https://learnfromclip.com/api/auth/verify?token=');
    expect(sent[0].body.text).not.toContain('evil.example');
  });

  it('dev: logs the link; token is single-use; GET does not consume it; expired after 15 min', async () => {
    const env = { ENVIRONMENT: 'development' } as any;
    const res = await app.request('/api/auth/magic-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.6.6.1' }, body: JSON.stringify({ email: 'dev@uni.edu' }),
    }, env);
    const { devVerifyUrl } = ((await res.json()) as any).data;
    const token = new URL(devVerifyUrl).searchParams.get('token')!;
    expect(token.length).toBeGreaterThanOrEqual(40);

    const get = await app.request(`/api/auth/verify?token=${token}`, {}, env);
    expect(get.status).toBe(200); // confirmation page only

    const post = (t: string) => app.request('/api/auth/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.6.6.2' }, body: JSON.stringify({ token: t }),
    }, env);
    const first = await post(token);
    expect(first.status).toBe(200);
    expect(cookieFrom(first, 'lfc_uid')).toBeTruthy();
    expect((await post(token)).status).toBe(400); // reused
    expect((await post(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).status).toBe(400); // guessed

    vi.useFakeTimers();
    const res2 = await app.request('/api/auth/magic-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.6.6.3' }, body: JSON.stringify({ email: 'late@uni.edu' }),
    }, env);
    const t2 = new URL(((await res2.json()) as any).data.devVerifyUrl).searchParams.get('token')!;
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    const late = await post(t2);
    vi.useRealTimers();
    expect(late.status).toBe(400);
  });
});

describe('Cloud deck sync', () => {
  const env = { ENVIRONMENT: 'development' } as any;
  async function login(email: string, ip: string) {
    const res = await app.request('/api/auth/magic-link', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email }) }, env);
    const token = new URL(((await res.json()) as any).data.devVerifyUrl).searchParams.get('token')!;
    const v = await app.request('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ token }) }, env);
    return cookieFrom(v, 'lfc_uid')!;
  }

  it('anonymous → 401, signed-in free → 403, paid → 200; users cannot read or overwrite each other’s decks', async () => {
    expect((await app.request('/api/decks/sync', {}, env)).status).toBe(401);
    const alice = await login('alice@uni.edu', '10.7.7.1');
    expect((await app.request('/api/decks/sync', { headers: { cookie: alice, 'x-enforce-quota': '1' } }, env)).status).toBe(403);

    await upsertEntitlement({ id: 'e_alice', email: 'alice@uni.edu', planType: 'monthly', status: 'active' });
    await upsertEntitlement({ id: 'e_bob', email: 'bob@uni.edu', planType: 'monthly', status: 'active' });
    const bob = await login('bob@uni.edu', '10.7.7.2');

    const put = (cookie: string, title: string) =>
      app.request('/api/decks/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ decks: [{ id: 'deck_1', title, packJson: '{}', updatedAt: Date.now() }] }) }, env);
    expect((await put(alice, 'Alice deck')).status).toBe(200);
    expect((await put(bob, 'Bob deck')).status).toBe(200); // same deck id

    const aliceDecks: any = await (await app.request('/api/decks/sync', { headers: { cookie: alice } }, env)).json();
    const bobDecks: any = await (await app.request('/api/decks/sync', { headers: { cookie: bob } }, env)).json();
    expect(aliceDecks.data.decks.map((d: any) => d.title)).toEqual(['Alice deck']);
    expect(bobDecks.data.decks.map((d: any) => d.title)).toEqual(['Bob deck']);
  });

  it('a forged lfc_uid cookie is rejected', async () => {
    const res = await app.request('/api/decks/sync', { headers: { cookie: 'lfc_uid=usr_victim.deadbeef' } }, env);
    expect(res.status).toBe(401);
  });
});

describe('Lemon Squeezy', () => {
  const LS_ENV = {
    ENVIRONMENT: 'test',
    LEMONSQUEEZY_API_KEY: 'test_key',
    LEMONSQUEEZY_STORE_ID: '1234',
    LEMONSQUEEZY_WEBHOOK_SECRET: 'whsec_test_0123456789',
    LEMONSQUEEZY_VARIANT_EXAM_PASS: '101',
    LEMONSQUEEZY_VARIANT_EXAM_PASS_REGIONAL: '102',
    LEMONSQUEEZY_VARIANT_MONTHLY: '201',
    LEMONSQUEEZY_VARIANT_MONTHLY_REGIONAL: '202',
    LEMONSQUEEZY_VARIANT_SEMESTER_PASS: '301',
    LEMONSQUEEZY_VARIANT_SEMESTER_PASS_REGIONAL: '302',
  } as any;

  it('checkout: creates a Lemon Squeezy checkout with the correct store + variant for every plan and region', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ data: { attributes: { url: 'https://learnfromclip.lemonsqueezy.com/checkout/custom/abc' } } }), { status: 201 });
    }));
    const cases: Array<[string, string, string]> = [
      ['exam_pass', 'US', '101'], ['exam_pass', 'EG', '102'],
      ['monthly', 'GB', '201'], ['monthly', 'IN', '202'],
      ['semester_pass', 'DE', '301'], ['semester_pass', 'TR', '302'],
    ];
    for (const [plan, country, variant] of cases) {
      const res = await app.request('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-IPCountry': country, 'x-forwarded-for': `10.8.${variant}.1` },
        body: JSON.stringify({ plan, email: 'buyer@uni.edu', billingCountry: 'EG' }), // body country is ignored
      }, LS_ENV);
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.checkoutUrl).toContain('lemonsqueezy.com');
      const last = calls[calls.length - 1];
      expect(last.url).toBe('https://api.lemonsqueezy.com/v1/checkouts');
      expect(last.init.headers.Authorization).toBe('Bearer test_key');
      expect(last.body.data.relationships.store.data.id).toBe('1234');
      expect(last.body.data.relationships.variant.data.id).toBe(variant);
      expect(last.body.data.attributes.checkout_data.custom.aid).toMatch(/^u_/);
    }
  });

  it('checkout without configuration returns a clear 503 (no fake URL)', async () => {
    const res = await app.request('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'exam_pass' }) }, { ENVIRONMENT: 'test' } as any);
    expect(res.status).toBe(503);
  });

  async function deliver(payload: any, opts: { secret?: string; sig?: string } = {}) {
    const raw = JSON.stringify(payload);
    const sig = opts.sig ?? (await hmacSha256Hex(opts.secret ?? LS_ENV.LEMONSQUEEZY_WEBHOOK_SECRET, raw));
    return app.request('/api/webhooks/lemonsqueezy', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': sig }, body: raw }, LS_ENV);
  }
  const order = (id: string, variant: number, email = 'buyer@uni.edu', custom: any = {}) => ({
    meta: { event_name: 'order_created', custom_data: custom },
    data: { type: 'orders', id, attributes: { user_email: email, status: 'paid', customer_id: 55, first_order_item: { variant_id: variant } } },
  });

  it('rejects unsigned / wrongly-signed webhooks, and all webhooks when the secret is not configured', async () => {
    expect((await deliver(order('1', 101), { sig: '' })).status).toBe(401);
    expect((await deliver(order('1', 101), { secret: 'attacker-secret' })).status).toBe(401);
    const noSecret = await app.request('/api/webhooks/lemonsqueezy', { method: 'POST', body: JSON.stringify(order('1', 101)) }, { ENVIRONMENT: 'test' } as any);
    expect(noSecret.status).toBe(503);
    expect(await getActiveEntitlementForUser('buyer@uni.edu')).toBeNull();
  });

  it('purchase grants the pass to the email AND the buying browser; duplicates never grant twice', async () => {
    const payload = order('5001', 101, 'buyer@uni.edu', { aid: 'u_0123456789abcdef01234567' });
    expect((await deliver(payload)).status).toBe(200);
    const ent = await getActiveEntitlementForUser('buyer@uni.edu');
    expect(ent?.planType).toBe('exam_pass');
    expect(await getActiveEntitlementForUser('u_0123456789abcdef01234567@guest.learnfromclip.com')).not.toBeNull();
    const firstExpiry = ent!.expiresAt;
    expect(firstExpiry - Math.floor(Date.now() / 1000)).toBeGreaterThan(6.9 * 86400);
    expect(firstExpiry - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(7 * 86400);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3 * 86400 * 1000);
    const dupRes: any = await (await deliver(payload)).json();
    expect(dupRes.data.duplicate).toBe(true);
    const order2 = { ...payload, meta: { ...payload.meta, webhook_id: 'x' } }; // same order, re-sent with different body
    await deliver(order2);
    const after = await getActiveEntitlementForUser('buyer@uni.edu');
    vi.useRealTimers();
    expect(after!.expiresAt).toBe(firstExpiry); // not extended
  });

  it('plan comes from the variant, not from forgeable custom data', async () => {
    await deliver(order('6001', 101, 'cheap@uni.edu', { plan: 'semester_pass', plan_type: 'semester_pass' }));
    expect((await getActiveEntitlementForUser('cheap@uni.edu'))?.planType).toBe('exam_pass');
    await deliver(order('6002', 999, 'unknown@uni.edu'));
    expect(await getActiveEntitlementForUser('unknown@uni.edu')).toBeNull();
  });

  it('Exam Pass expires after 7 days and never auto-renews; Semester Pass after 120 days', async () => {
    await deliver(order('7001', 101, 'exam@uni.edu'));
    await deliver(order('7002', 301, 'sem@uni.edu'));
    const now = Math.floor(Date.now() / 1000);
    expect(await getActiveEntitlementForUser('exam@uni.edu', undefined, now + 7 * 86400 + 1)).toBeNull();
    expect(await getActiveEntitlementForUser('sem@uni.edu', undefined, now + 119 * 86400)).not.toBeNull();
    expect(await getActiveEntitlementForUser('sem@uni.edu', undefined, now + 121 * 86400)).toBeNull();
  });

  it('refund removes access immediately (all rows of that order)', async () => {
    await deliver(order('8001', 301, 'refund@uni.edu', { aid: 'u_aaaaaaaaaaaaaaaaaaaaaaaa' }));
    await deliver({ meta: { event_name: 'order_refunded' }, data: { type: 'orders', id: '8001', attributes: { user_email: 'refund@uni.edu', refunded: true } } });
    expect(await getActiveEntitlementForUser('refund@uni.edu')).toBeNull();
    expect(await getActiveEntitlementForUser('u_aaaaaaaaaaaaaaaaaaaaaaaa@guest.learnfromclip.com')).toBeNull();
  });

  it('subscription: create → update (renew) → cancel (access until ends_at) → expire; refunded stays revoked', async () => {
    const sub = (event: string, attrs: any) => ({
      meta: { event_name: event },
      data: { type: 'subscriptions', id: '9100', attributes: { user_email: 'sub@uni.edu', variant_id: 201, order_id: 9000, customer_id: 1, ...attrs } },
    });
    const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
    await deliver(order('9000', 201, 'sub@uni.edu')); // subscription order is handled by subscription_created
    expect(await getActiveEntitlementForUser('sub@uni.edu')).toBeNull();
    await deliver(sub('subscription_created', { status: 'active', renews_at: iso(30) }));
    expect((await getActiveEntitlementForUser('sub@uni.edu'))?.planType).toBe('monthly');
    await deliver(sub('subscription_updated', { status: 'active', renews_at: iso(60) }));
    expect((await getActiveEntitlementForUser('sub@uni.edu'))!.expiresAt).toBeGreaterThan(Date.now() / 1000 + 59 * 86400);
    await deliver(sub('subscription_cancelled', { status: 'cancelled', cancelled: true, ends_at: iso(5) }));
    const cancelled = await getActiveEntitlementForUser('sub@uni.edu');
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled!.expiresAt).toBeLessThan(Date.now() / 1000 + 6 * 86400);
    await deliver(sub('subscription_expired', { status: 'expired' }));
    expect(await getActiveEntitlementForUser('sub@uni.edu')).toBeNull();

    // A refunded subscription is not re-activated by a later update
    const sub2 = (event: string, attrs: any) => ({ meta: { event_name: event }, data: { type: 'subscriptions', id: '9200', attributes: { user_email: 'sub2@uni.edu', variant_id: 201, customer_id: 1, ...attrs } } });
    await deliver(sub2('subscription_created', { status: 'active', renews_at: iso(30) }));
    await deliver({ meta: { event_name: 'subscription_payment_refunded' }, data: { type: 'subscription-invoices', id: 'inv1', attributes: { subscription_id: 9200, user_email: 'sub2@uni.edu' } } });
    await deliver(sub2('subscription_updated', { status: 'active', renews_at: iso(31) }));
    expect(await getActiveEntitlementForUser('sub2@uni.edu')).toBeNull();
  });

  it('regional price is validated against the BILLING country (VPN abuse blocked)', async () => {
    const config = readLemonSqueezyConfig(LS_ENV);
    const customerApi = (country: string) =>
      vi.fn(async () => new Response(JSON.stringify({ data: { attributes: { country } } }), { status: 200 }));

    const vpn = await processPaymentWebhook(order('a1', 102, 'vpn@uni.edu'), { eventHash: 'r1', config, fetchImpl: customerApi('US') as any });
    expect(vpn.entitlements?.[0].status).toBe('region_mismatch');
    expect(await getActiveEntitlementForUser('vpn@uni.edu')).toBeNull();

    const real = await processPaymentWebhook(order('a2', 102, 'cairo@uni.edu'), { eventHash: 'r2', config, fetchImpl: customerApi('EG') as any });
    expect(real.entitlements?.[0].status).toBe('active');

    // If the country cannot be checked right now, the webhook errors so Lemon Squeezy retries
    await expect(
      processPaymentWebhook(order('a3', 102, 'later@uni.edu'), { eventHash: 'r3', config, fetchImpl: vi.fn(async () => new Response('', { status: 500 })) as any })
    ).rejects.toThrow();
  });
});

describe('Referral', () => {
  const env = { ENVIRONMENT: 'test' } as any;
  it('friend’s first deck rewards both with a 3-day Exam Pass; self-referral blocked; max 5', async () => {
    const refRes = await app.request('/api/referral/code', { method: 'POST', headers: { 'x-forwarded-for': '10.10.0.1', 'user-agent': 'ReferrerBrowser' } }, env);
    const refCookie = cookieFrom(refRes, 'lfc_aid')!;
    const { code } = ((await refRes.json()) as any).data;
    expect(code).toMatch(/^LFC/);

    const segments = buildNormalLecture();
    const makePack = async (ip: string, ua: string, cookie = '') =>
      (await (await app.request('/api/revision-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, 'user-agent': ua, cookie },
        body: JSON.stringify({ segments, referralCode: code }),
      }, env)).json()) as any;

    // Self-referral: same browser cookie, and same device after clearing cookies
    expect((await makePack('10.10.0.1', 'ReferrerBrowser', refCookie)).referral.rewarded).toBe(false);
    expect((await makePack('10.10.0.1', 'ReferrerBrowser')).referral.reason).toBe('SAME_DEVICE_SELF_REFERRAL_BLOCKED');

    const friend = await makePack('10.10.1.1', 'FriendBrowser');
    expect(friend.referral.rewarded).toBe(true);
    const usage: any = await (await app.request('/api/usage', { headers: { cookie: refCookie, 'x-enforce-quota': '1', 'x-forwarded-for': '10.10.0.1' } }, env)).json();
    expect(usage.data.plan).toBe('exam_pass');

    for (let i = 2; i <= 7; i++) await makePack(`10.10.${i}.1`, `Friend${i}`);
    const { getUserByReferralCode } = await import('../server/utils/paymentsAndAuth');
    expect((await getUserByReferralCode(code))!.referralRewardsCount).toBe(5);
  });
});
