import React from 'react';
import { formatTimestamp } from '../../server/utils/formatters';
import { SourceAnchor } from '../../types';

/** "▶ 00:24" chip that plays the lecture at the moment a point was said. */
export const SourceChip: React.FC<{
  source: SourceAnchor;
  onSeek: (seconds: number, quote: string) => void;
  label?: string;
}> = ({ source, onSeek, label = 'From lecture' }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onSeek(source.start_seconds, source.quote);
    }}
    title={`Play the lecture at ${formatTimestamp(source.start_seconds)}`}
    className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[12px] font-medium text-accent hover:bg-accent hover:text-white transition-colors shrink-0"
    dir="ltr"
  >
    <svg aria-hidden="true" className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
    <span>
      {label} · {formatTimestamp(source.start_seconds)}
    </span>
  </button>
);

/** The lecturer's exact words, shown as a real quotation with where it was said. */
export const QuoteBlock: React.FC<{
  source: SourceAnchor;
  onSeek: (seconds: number, quote: string) => void;
  className?: string;
}> = ({ source, onSeek, className = '' }) => (
  <figure className={`border-l-2 border-accent/30 pl-4 ${className}`}>
    <blockquote dir="auto" className="text-[15px] leading-relaxed text-ink/80">
      <span className="sr-only">Verbatim lecture quote: </span>
      <span className="quote-mark">“{source.quote}”</span>
    </blockquote>
    <figcaption className="mt-2">
      <SourceChip source={source} onSeek={onSeek} />
    </figcaption>
  </figure>
);

/** Context the AI added. Always visibly separate from what the lecturer said. */
export const AiNote: React.FC<{ text?: string; className?: string }> = ({ text, className = '' }) =>
  text ? (
    <div dir="auto" className={`rounded-lg bg-[#F5F3FF] px-4 py-3 ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#502EF0]">AI explanation</p>
      <p className="mt-1 text-sm leading-relaxed text-ink/80">
        <bdi dir="auto">{text}</bdi>
      </p>
    </div>
  ) : null;

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex min-w-[1.4rem] items-center justify-center rounded border border-rule bg-paper px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted">
    {children}
  </kbd>
);
