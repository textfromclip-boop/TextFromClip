import React from 'react';
import { TranscriptSegment } from '../types';
import { formatTimestamp } from '../server/utils/formatters';

export type ContentTabKind = 'original' | 'transform';

export interface ResolvedTranslationSource {
  sourceKind: ContentTabKind;
  sourceLabel: string;
  sourceText: string;
}

export interface TimestampedSegmentLine {
  timestamp: string;
  seconds: number;
  text: string;
}

export interface ParsedTimestampedTranscript {
  items: TimestampedSegmentLine[];
  trailingNote?: string;
}

const BULLET_ITEM_REGEX = /^[ \t]*(?:[•・]\s*(.+)|[-*][ \t]+(.+))$/u;
const NUMBERED_ITEM_REGEX = /^[ \t]*(\d+)[.)、][ \t]+(.+)$/u;
const MD_HEADING_REGEX = /^[ \t]*(#{1,6})[ \t]+(.+)$/;
const TIMESTAMP_LINE_REGEX = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s+(.+)$/;
const TRUNCATION_NOTE_REGEX = /^\[Note:\s+.+\]$/i;
const INLINE_TOKEN_REGEX =
  /(`[^`\n]+`|\*\*[^\s*](?:[^\n*]*?[^\s*])?\*\*|\*[^\s*](?:[^\n*]*?[^\s*])?\*)/g;

function parseTimestampSeconds(ts: string): number {
  const parts = ts.split(':').map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Resolves the exact structured content to translate based on the user's active view:
 * - Translates the active AI transformation when viewing (or re-translating from) the Transform tab.
 * - Otherwise translates the Original transcript preserving either segment timestamps or paragraph breaks.
 */
export function resolveTranslationSource(params: {
  activeTab: 'original' | 'transform' | 'translate';
  lastContentTab: ContentTabKind;
  transformedText: string | null;
  transformLabel: string;
  showTimes: boolean;
  segments: TranscriptSegment[];
  paragraphs: Array<{ id: number; start: number; text: string }>;
}): ResolvedTranslationSource {
  const effectiveKind: ContentTabKind =
    (params.activeTab === 'transform' ||
      (params.activeTab === 'translate' && params.lastContentTab === 'transform')) &&
    Boolean(params.transformedText && params.transformedText.trim())
      ? 'transform'
      : 'original';

  if (effectiveKind === 'transform' && params.transformedText) {
    return {
      sourceKind: 'transform',
      sourceLabel: params.transformLabel || 'AI Summary',
      sourceText: params.transformedText.trim(),
    };
  }

  if (params.showTimes) {
    const timestamped = params.segments
      .filter((s) => s.text && s.text.trim().length > 0)
      .map((s) => `[${formatTimestamp(s.start)}] ${s.text.trim()}`)
      .join('\n');
    return {
      sourceKind: 'original',
      sourceLabel: 'Transcript',
      sourceText: timestamped,
    };
  }

  const paragraphText = params.paragraphs
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n');

  return {
    sourceKind: 'original',
    sourceLabel: 'Transcript',
    sourceText: paragraphText,
  };
}

/**
 * Parses a timestamped transcript ("[00:00] ...\n[00:08] ...") into structured segment rows
 * when every non-empty content line carries a leading timestamp.
 */
export function parseTimestampedTranscript(text: string): ParsedTimestampedTranscript | null {
  if (!text || typeof text !== 'string') return null;

  const nonEmptyLines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (nonEmptyLines.length === 0) return null;

  let trailingNote: string | undefined;
  let contentLines = nonEmptyLines;
  if (
    nonEmptyLines.length >= 2 &&
    TRUNCATION_NOTE_REGEX.test(nonEmptyLines[nonEmptyLines.length - 1])
  ) {
    trailingNote = nonEmptyLines[nonEmptyLines.length - 1];
    contentLines = nonEmptyLines.slice(0, -1);
  }

  if (contentLines.length === 0) return null;

  const items: TimestampedSegmentLine[] = [];
  for (const line of contentLines) {
    const m = line.match(TIMESTAMP_LINE_REGEX);
    if (!m) {
      return null;
    }
    items.push({
      timestamp: m[1],
      seconds: parseTimestampSeconds(m[1]),
      text: m[2].trim(),
    });
  }

  return { items, trailingNote };
}

function isPlainHeadingCandidate(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 85) return false;
  if (
    MD_HEADING_REGEX.test(t) ||
    BULLET_ITEM_REGEX.test(t) ||
    NUMBERED_ITEM_REGEX.test(t) ||
    /^\d+\s*\/\s*\d+\b/.test(t) ||
    TIMESTAMP_LINE_REGEX.test(t) ||
    /^["“'‘«„「『\[]/.test(t)
  ) {
    return false;
  }
  return !/[.。।!！;؛]$/.test(t);
}

export function renderInlineFormatting(text: string): React.ReactNode {
  if (!text) return text;
  const parts = text.split(INLINE_TOKEN_REGEX);
  if (parts.length === 1) return text;

  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-[13.5px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={idx} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

type StructuredNode =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'p'; text: string }
  | { kind: 'code'; code: string };

function parseStructuredNodes(rawText: string): StructuredNode[] {
  const normalized = (rawText || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const nodes: StructuredNode[] = [];
  const segments = normalized.split(/(```[\s\S]*?```)/g);

  for (const segment of segments) {
    if (!segment.trim()) continue;

    if (segment.startsWith('```') && segment.endsWith('```')) {
      const inner = segment.slice(3, -3).replace(/^[a-zA-Z0-9_+-]*\n/, '').replace(/\n$/, '');
      nodes.push({ kind: 'code', code: inner });
      continue;
    }

    const blocks = segment
      .split(/\n\s*\n/)
      .map((b) => b.replace(/^\n+|\n+$/g, ''))
      .filter((b) => b.trim().length > 0);

    blocks.forEach((block, blockIdx) => {
      const lines = block.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) return;

      // Single-line standalone plain-text heading (e.g. Blog headline or subheading)
      if (
        lines.length === 1 &&
        blockIdx < blocks.length - 1 &&
        isPlainHeadingCandidate(lines[0])
      ) {
        nodes.push({
          kind: 'heading',
          level: nodes.length === 0 ? 2 : 3,
          text: lines[0].trim(),
        });
        return;
      }

      let i = 0;
      // Opening plain-text section heading inside a multi-line block (e.g. "Executive Summary\n<overview>" or "Puntos clave\n• ...")
      if (lines.length >= 2 && isPlainHeadingCandidate(lines[0])) {
        nodes.push({
          kind: 'heading',
          level: nodes.length === 0 ? 2 : 3,
          text: lines[0].trim(),
        });
        i = 1;
      }

      let paragraphBuf: string[] = [];
      const flushParagraph = () => {
        if (paragraphBuf.length > 0) {
          nodes.push({ kind: 'p', text: paragraphBuf.join('\n') });
          paragraphBuf = [];
        }
      };

      while (i < lines.length) {
        const line = lines[i];
        const mdHeading = line.match(MD_HEADING_REGEX);
        if (mdHeading) {
          flushParagraph();
          nodes.push({
            kind: 'heading',
            level: Math.min(4, mdHeading[1].length),
            text: mdHeading[2].trim(),
          });
          i++;
          continue;
        }

        const bulletMatch = line.match(BULLET_ITEM_REGEX);
        if (bulletMatch) {
          flushParagraph();
          const items: string[] = [];
          while (i < lines.length) {
            const bm = lines[i].match(BULLET_ITEM_REGEX);
            if (bm) {
              items.push((bm[1] ?? bm[2] ?? '').trim());
              i++;
              // Attach indented continuation lines or translated Q&A answer lines (e.g. "  A: ...", "R: ...", "ج: ...")
              while (
                i < lines.length &&
                (/^[ \t]{2,}\S/.test(lines[i]) ||
                  /^[ \t]*(?:A|R|ج|答|Ответ|उत्तर)\s*[:：]\s*\S/iu.test(lines[i])) &&
                !BULLET_ITEM_REGEX.test(lines[i]) &&
                !NUMBERED_ITEM_REGEX.test(lines[i])
              ) {
                items[items.length - 1] += `\n${lines[i].trim()}`;
                i++;
              }
            } else {
              break;
            }
          }
          nodes.push({ kind: 'ul', items });
          continue;
        }

        const numberedMatch = line.match(NUMBERED_ITEM_REGEX);
        if (numberedMatch) {
          flushParagraph();
          const items: string[] = [];
          while (i < lines.length) {
            const nm = lines[i].match(NUMBERED_ITEM_REGEX);
            if (nm) {
              items.push(nm[2].trim());
              i++;
              while (
                i < lines.length &&
                /^[ \t]{2,}\S/.test(lines[i]) &&
                !BULLET_ITEM_REGEX.test(lines[i]) &&
                !NUMBERED_ITEM_REGEX.test(lines[i])
              ) {
                items[items.length - 1] += `\n${lines[i].trim()}`;
                i++;
              }
            } else {
              break;
            }
          }
          nodes.push({ kind: 'ol', items });
          continue;
        }

        paragraphBuf.push(line.trim());
        i++;
      }

      flushParagraph();
    });
  }

  return nodes;
}

export const FormattedContent: React.FC<{ text: string }> = ({ text }) => {
  const nodes = parseStructuredNodes(text);

  return (
    <div className="space-y-3 text-[15px] text-ink leading-relaxed">
      {nodes.map((node, idx) => {
        switch (node.kind) {
          case 'heading':
            return node.level <= 2 ? (
              <h3
                key={idx}
                className="text-base sm:text-[17px] font-bold text-ink pt-2 first:pt-0"
              >
                {renderInlineFormatting(node.text)}
              </h3>
            ) : (
              <h4 key={idx} className="text-[15px] font-bold text-ink pt-2 first:pt-0">
                {renderInlineFormatting(node.text)}
              </h4>
            );

          case 'ul':
            return (
              <ul key={idx} className="list-disc pl-5 space-y-2 marker:text-accent">
                {node.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="whitespace-pre-line leading-relaxed">
                    {renderInlineFormatting(item)}
                  </li>
                ))}
              </ul>
            );

          case 'ol':
            return (
              <ol
                key={idx}
                className="list-decimal pl-5 space-y-2 marker:font-semibold marker:text-accent"
              >
                {node.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="whitespace-pre-line leading-relaxed">
                    {renderInlineFormatting(item)}
                  </li>
                ))}
              </ol>
            );

          case 'code':
            return (
              <pre
                key={idx}
                className="p-3.5 rounded-xl bg-slate-900 text-slate-100 text-[13px] font-mono overflow-x-auto leading-relaxed"
              >
                <code>{node.code}</code>
              </pre>
            );

          case 'p':
          default:
            return (
              <p key={idx} className="whitespace-pre-line leading-relaxed">
                {renderInlineFormatting(node.text)}
              </p>
            );
        }
      })}
    </div>
  );
};

