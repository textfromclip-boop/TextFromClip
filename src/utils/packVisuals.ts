// Pure layout helpers for the pack "Visuals": mind map, sketchnotes and card sheet.
// Everything is derived from the already quote-verified pack (headings, bullets, cards), so a
// visual can never contain a claim that is not in the lecture. No AI image generation involved.
import { Flashcard, RevisionPack } from '../types';

export const VISUAL_COLORS = [
  '#2DD4BF', // teal
  '#818CF8', // indigo
  '#FBBF24', // amber
  '#F87171', // red
  '#34D399', // green
  '#60A5FA', // blue
  '#F472B6', // pink
  '#A3E635', // lime
] as const;

export function visualColor(index: number): string {
  return VISUAL_COLORS[((index % VISUAL_COLORS.length) + VISUAL_COLORS.length) % VISUAL_COLORS.length];
}

/** Shortens text to `max` characters at a word boundary, adding an ellipsis when cut. */
export function truncateText(text: string, max: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

/** Greedy word wrap into at most `maxLines` lines of `maxChars`; the last line is truncated. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = (text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i];
    if (next.length <= maxChars || !current) {
      current = next;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        const rest = [current, ...words.slice(i + 1)].join(' ');
        lines.push(truncateText(rest, maxChars));
        return lines;
      }
    }
  }
  if (current) lines.push(truncateText(current, maxChars));
  return lines.slice(0, maxLines);
}

/** A short label for a note bullet: its defined term, otherwise its first sentence, shortened. */
export function bulletLabel(bullet: { text: string; term?: string; is_definition?: boolean }, max = 44): string {
  if (bullet.is_definition && bullet.term) return truncateText(bullet.term, max);
  const firstSentence = bullet.text.split(/(?<=[.!?])\s/)[0] || bullet.text;
  return truncateText(firstSentence, max);
}

export interface MindMapNode {
  id: string;
  side: 'left' | 'right';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  heading: string;
  sub: string;
  fullHeading: string;
  startSeconds: number;
  quote: string;
  /** Anchor point where the connector meets the node (the edge facing the centre). */
  anchorX: number;
  anchorY: number;
}

export interface MindMapLayout {
  width: number;
  height: number;
  center: { x: number; y: number; width: number; height: number; lines: string[] };
  nodes: MindMapNode[];
}

export const MINDMAP_MAX_BRANCHES = 8;

export function buildMindMapLayout(pack: RevisionPack): MindMapLayout {
  const sections = pack.notes.filter((s) => s.bullets.length > 0).slice(0, MINDMAP_MAX_BRANCHES);
  const width = 1000;
  const rowH = 112;
  const nodeW = 310;
  const nodeH = 68;
  const leftCount = Math.ceil(sections.length / 2);
  const rightCount = Math.floor(sections.length / 2);
  const rows = Math.max(leftCount, rightCount, 1);
  const top = 70;
  const height = top + rows * rowH + 40;
  const cy = top + (rows * rowH) / 2 - 20;

  const nodes: MindMapNode[] = sections.map((section, i) => {
    const side: 'left' | 'right' = i % 2 === 0 ? 'left' : 'right';
    const sideIdx = Math.floor(i / 2);
    const count = side === 'left' ? leftCount : rightCount;
    // Centre each side's column vertically around cy
    const colTop = cy - ((count - 1) * rowH) / 2 - nodeH / 2;
    const y = colTop + sideIdx * rowH;
    const x = side === 'left' ? 24 : width - 24 - nodeW;
    const first = section.bullets[0];
    const second = section.bullets[1] || first;
    return {
      id: section.id,
      side,
      x,
      y,
      width: nodeW,
      height: nodeH,
      color: visualColor(i),
      heading: truncateText(section.heading, 30),
      sub: bulletLabel(second.text === first.text ? first : second, 40),
      fullHeading: section.heading,
      startSeconds: first.source.start_seconds,
      quote: first.source.quote,
      anchorX: side === 'left' ? x + nodeW : x,
      anchorY: y + nodeH / 2,
    };
  });

  return {
    width,
    height,
    center: { x: width / 2 - 100, y: cy - 62, width: 200, height: 124, lines: wrapText(pack.title, 20, 4) },
    nodes,
  };
}

export interface CardSheetItem {
  number: string;
  front: string[];
  back: string[];
  color: string;
  startSeconds: number;
}

/** Up to `max` cards, spread across the lecture rather than just the first few. */
export function pickSheetCards(cards: Flashcard[], max = 6): Flashcard[] {
  if (cards.length <= max) return cards.slice();
  const out: Flashcard[] = [];
  for (let i = 0; i < max; i++) out.push(cards[Math.floor((i * cards.length) / max)]);
  return out;
}

export function buildCardSheet(pack: RevisionPack, max = 6): CardSheetItem[] {
  return pickSheetCards(pack.flashcards, max).map((card, i) => ({
    number: String(i + 1).padStart(2, '0'),
    front: wrapText(card.front, 30, 4),
    back: wrapText(card.back, 56, 2),
    color: visualColor(i),
    startSeconds: card.source.start_seconds,
  }));
}

export interface SketchLesson {
  number: number;
  heading: string;
  line: string;
  startSeconds: number;
}

export function buildSketchLessons(pack: RevisionPack, max = 7): SketchLesson[] {
  return pack.notes
    .filter((s) => s.bullets.length > 0)
    .slice(0, max)
    .map((section, i) => ({
      number: i + 1,
      heading: truncateText(section.heading, 48),
      line: truncateText(section.bullets[0].text, 120),
      startSeconds: section.bullets[0].source.start_seconds,
    }));
}

/** The first defined term in the pack, shown as "worth remembering" on the sketchnotes. */
export function pickKeyDefinition(pack: RevisionPack): { term: string; text: string } | null {
  for (const section of pack.notes) {
    for (const b of section.bullets) {
      if (b.is_definition && b.term) return { term: b.term, text: truncateText(b.text, 160) };
    }
  }
  return null;
}
