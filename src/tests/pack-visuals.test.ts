import { describe, it, expect } from 'vitest';
import {
  buildCardSheet,
  buildMindMapLayout,
  buildSketchLessons,
  bulletLabel,
  pickKeyDefinition,
  pickSheetCards,
  truncateText,
  visualColor,
  wrapText,
} from '../utils/packVisuals';
import { Flashcard, NoteSection, RevisionPack } from '../types';

const src = (t: number) => ({ start_seconds: t, end_seconds: t + 5, quote: `quote at ${t} seconds` });
const section = (i: number, bullets = 2): NoteSection => ({
  id: `s${i}`,
  heading: `Section ${i}: ${'long heading '.repeat(6)}`,
  bullets: Array.from({ length: bullets }, (_, b) => ({
    id: `b${i}-${b}`,
    text: `Bullet ${b} of section ${i} explains an idea. And a second sentence.`,
    source: src(i * 100 + b * 10),
    ...(b === 0 && i === 2 ? { is_definition: true, term: 'ATP' } : {}),
  })),
});
const card = (i: number): Flashcard => ({
  id: `c${i}`,
  front: `What is concept number ${i} in this lecture about cells and energy?`,
  back: `Answer ${i}`,
  source: src(i * 30),
  due_date: '2026-11-10',
  interval: 0,
  ease: 2.5,
  reps: 0,
});
const pack = (nSections: number, nCards: number): RevisionPack => ({
  id: 'p',
  title: 'Biology 101: Cellular Respiration and the Electron Transport Chain',
  provider: 'youtube',
  videoId: 'v',
  durationSeconds: 3600,
  notes: Array.from({ length: nSections }, (_, i) => section(i + 1)),
  flashcards: Array.from({ length: nCards }, (_, i) => card(i + 1)),
  quiz: [],
  metadata: { totalChunks: 1, verifiedItemsCount: 1, droppedQuotesCount: 0, generatedAt: 0, modelUsed: 'x' },
});

describe('pack visuals', () => {
  it('truncates at a word boundary and wraps with a capped line count', () => {
    expect(truncateText('short', 10)).toBe('short');
    const t = truncateText('The quick brown fox jumps over the lazy dog', 20);
    expect(t.length).toBeLessThanOrEqual(20);
    expect(t.endsWith('…')).toBe(true);
    expect(t).not.toMatch(/\s…$/);
    const lines = wrapText('one two three four five six seven eight nine ten eleven twelve', 12, 3);
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.length <= 12)).toBe(true);
    expect(lines[2].endsWith('…')).toBe(true);
    expect(wrapText('', 10, 2)).toEqual([]);
  });

  it('colours cycle and never go out of range (including negatives)', () => {
    expect(visualColor(0)).toBe(visualColor(8));
    expect(visualColor(-1)).toBe(visualColor(7));
  });

  it('bullet label prefers the defined term, else the first sentence', () => {
    expect(bulletLabel({ text: 'x', term: 'ATP', is_definition: true })).toBe('ATP');
    expect(bulletLabel({ text: 'Mitochondria make energy. They also do more.' })).toBe('Mitochondria make energy.');
  });

  it('mind map: balanced sides, max 8 branches, nodes inside the canvas, every branch seeks a real source', () => {
    const layout = buildMindMapLayout(pack(11, 5));
    expect(layout.nodes.length).toBe(8);
    expect(layout.nodes.filter((n) => n.side === 'left').length).toBe(4);
    expect(layout.nodes.filter((n) => n.side === 'right').length).toBe(4);
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(layout.width);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.height).toBeLessThanOrEqual(layout.height);
      expect(n.heading.length).toBeLessThanOrEqual(30);
      expect(n.startSeconds).toBeGreaterThan(0);
      expect(n.quote).toMatch(/^quote at/);
    }
    // nodes in one column never overlap
    for (const side of ['left', 'right'] as const) {
      const col = layout.nodes.filter((n) => n.side === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) expect(col[i].y).toBeGreaterThanOrEqual(col[i - 1].y + col[i - 1].height);
    }
    expect(layout.center.lines.length).toBeLessThanOrEqual(4);
  });

  it('mind map handles 1 section, odd counts and empty notes', () => {
    expect(buildMindMapLayout(pack(1, 1)).nodes.length).toBe(1);
    const three = buildMindMapLayout(pack(3, 1));
    expect(three.nodes.filter((n) => n.side === 'left').length).toBe(2);
    expect(buildMindMapLayout(pack(0, 0)).nodes.length).toBe(0);
  });

  it('card sheet samples across the whole deck, not just the first cards', () => {
    const picked = pickSheetCards(Array.from({ length: 30 }, (_, i) => card(i + 1)), 6);
    expect(picked.length).toBe(6);
    expect(picked[0].id).toBe('c1');
    expect(Number(picked[5].id.slice(1))).toBeGreaterThan(20);
    const sheet = buildCardSheet(pack(2, 30), 6);
    expect(sheet.map((s) => s.number)).toEqual(['01', '02', '03', '04', '05', '06']);
    expect(sheet.every((s) => s.front.length <= 4 && s.back.length <= 3)).toBe(true);
    expect(buildCardSheet(pack(2, 3), 6).length).toBe(3);
  });

  it('sketchnotes use only verified note text and a real definition', () => {
    const lessons = buildSketchLessons(pack(9, 1), 7);
    expect(lessons.length).toBe(7);
    expect(lessons[0].line).toMatch(/^Bullet 0 of section 1/);
    expect(lessons.every((l) => l.startSeconds > 0)).toBe(true);
    expect(pickKeyDefinition(pack(3, 1))?.term).toBe('ATP');
    expect(pickKeyDefinition(pack(1, 1))).toBeNull();
  });
});
