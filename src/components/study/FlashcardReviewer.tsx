import React, { useEffect, useState } from 'react';
import { Flashcard } from '../../types';
import { scheduleFlashcardSm2, Sm2Rating } from '../../utils/sm2';
import { AiNote, Kbd, QuoteBlock, SourceChip } from './StudyBits';

/**
 * One flashcard at a time, spaced-repetition style (the method Anki uses):
 * 1. read the question and try to remember the answer;
 * 2. show the answer;
 * 3. say how well you knew it, which decides when the card comes back.
 */

export const GRADES: Array<{
  rating: Sm2Rating;
  label: string;
  hint: string;
  key: string;
  tone: { ring: string; text: string; bar: string };
}> = [
  { rating: 'again', label: 'Forgot', hint: "Didn't remember", key: '1', tone: { ring: 'hover:border-red-400 focus-visible:border-red-400', text: 'text-red-700', bar: 'bg-red-500' } },
  { rating: 'hard', label: 'Hard', hint: 'Took real effort', key: '2', tone: { ring: 'hover:border-amber-400 focus-visible:border-amber-400', text: 'text-amber-700', bar: 'bg-amber-500' } },
  { rating: 'good', label: 'Good', hint: 'Remembered it', key: '3', tone: { ring: 'hover:border-accent focus-visible:border-accent', text: 'text-accent', bar: 'bg-accent' } },
  { rating: 'easy', label: 'Easy', hint: 'Knew it instantly', key: '4', tone: { ring: 'hover:border-emerald-500 focus-visible:border-emerald-500', text: 'text-emerald-700', bar: 'bg-emerald-600' } },
];

/** When the card will come back after this rating, in plain words. */
export function nextReviewLabel(card: Flashcard, rating: Sm2Rating): string {
  const days = scheduleFlashcardSm2(card, rating).interval;
  if (days <= 0) return 'Again in this session';
  if (days === 1) return 'Back tomorrow';
  return `Back in ${days} days`;
}

interface Props {
  card: Flashcard;
  /** 1-based position in the session */
  position: number;
  total: number;
  /** Colour accent for the card edge */
  accent?: string;
  deckLabel?: string;
  rtl?: boolean;
  onGrade: (rating: Sm2Rating) => void;
  onSeek: (seconds: number, quote: string) => void;
}

export const FlashcardReviewer: React.FC<Props> = ({ card, position, total, accent, deckLabel, rtl, onGrade, onSeek }) => {
  const [flipped, setFlipped] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setFlipped(false);
  }, [card.id]);

  const grade = (rating: Sm2Rating) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    onGrade(rating);
  };

  // Keyboard: Space / Enter shows the answer; 1-4 rates it once the answer is showing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(t.tagName)) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        grade(GRADES[Number(e.key) - 1].rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const translationDir = rtl ? 'rtl' : 'auto';
  const pct = Math.round((Math.max(0, position - 1) / Math.max(1, total)) * 100);

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Progress */}
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-ink">
          Card {position} <span className="text-muted font-normal">of {total}</span>
          {deckLabel && <span className="ml-2 text-muted font-normal truncate">· {deckLabel}</span>}
        </span>
        <SourceChip source={card.source} onSeek={onSeek} />
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-rule" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Session progress">
        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      {/* The card: front = question, back = answer (3D flip) */}
      <div className="flip-scene mt-6">
        <div
          role="button"
          tabIndex={0}
          aria-label={flipped ? 'Show the question again' : 'Show the answer'}
          onClick={() => setFlipped((f) => !f)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setFlipped((f) => !f);
            }
          }}
          className={`flip-card cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-2xl ${flipped ? 'is-flipped' : ''}`}
        >
          {/* FRONT */}
          <div
            aria-hidden={flipped}
            className="flip-face relative flex min-h-[300px] flex-col rounded-2xl border border-rule bg-surface p-7 sm:p-10 shadow-[0_18px_50px_-24px_rgba(2,20,51,0.28)]"
            style={{ borderTop: `4px solid ${accent || '#2E62F4'}` }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Question</span>
            <div className="flex flex-1 flex-col justify-center py-6">
              <p dir="auto" className="font-serif text-[1.7rem] sm:text-[2rem] leading-snug text-ink">
                {card.front}
              </p>
              {card.front_translation && (
                <p dir={translationDir} className="mt-4 border-t border-rule pt-4 text-lg text-ink/75">
                  {card.front_translation}
                </p>
              )}
            </div>
            <p className="text-sm text-muted">Try to answer in your head, then flip the card.</p>
          </div>

          {/* BACK */}
          <div
            aria-hidden={!flipped}
            className="flip-face flip-back relative flex min-h-[300px] flex-col rounded-2xl border border-rule bg-surface p-7 sm:p-10 shadow-[0_18px_50px_-24px_rgba(2,20,51,0.28)]"
            style={{ borderTop: `4px solid ${accent || '#2E62F4'}` }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Answer</span>
            <div className="flex-1 py-5">
              <p dir="auto" className="text-xl sm:text-[1.4rem] leading-relaxed text-ink">
                {card.back}
              </p>
              {card.back_translation && (
                <p dir={translationDir} className="mt-4 border-t border-rule pt-4 text-lg text-ink/75">
                  {card.back_translation}
                </p>
              )}
              <QuoteBlock source={card.source} onSeek={onSeek} className="mt-6" />
              <AiNote text={card.ai_explanation} className="mt-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Step 2 / 3 controls */}
      {!flipped ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setFlipped(true)}
            className="w-full sm:w-auto sm:min-w-[260px] rounded-xl bg-ink px-8 py-3.5 text-base font-semibold text-white hover:bg-ink/90 transition-colors"
          >
            Show answer
          </button>
          <p className="text-xs text-muted">
            or press <Kbd>Space</Kbd>
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <p className="text-center text-sm font-medium text-ink">How well did you know it?</p>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {GRADES.map((g) => {
              const when = nextReviewLabel(card, g.rating);
              return (
                <button
                  key={g.rating}
                  type="button"
                  onClick={() => grade(g.rating)}
                  aria-label={`${g.label}: ${g.hint}. ${when}.`}
                  className={`group relative overflow-hidden rounded-xl border border-rule bg-surface px-3 pb-3 pt-3.5 text-left transition-colors focus:outline-none ${g.tone.ring}`}
                >
                  <span className={`absolute inset-x-0 top-0 h-1 ${g.tone.bar} opacity-80`} aria-hidden="true" />
                  <span className="flex items-center justify-between">
                    <span className={`text-base font-semibold ${g.tone.text}`}>{g.label}</span>
                    <Kbd>{g.key}</Kbd>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{g.hint}</span>
                  <span className="mt-2 block text-xs font-medium text-ink">{when}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setShowHelp((s) => !s)}
              aria-expanded={showHelp}
              className="text-xs font-medium text-muted underline underline-offset-2 hover:text-ink"
            >
              How does this work?
            </button>
            {showHelp && (
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">
                This is spaced repetition, the method Anki uses. Cards you forget come back soon; cards you know come back
                later and later. You spend your time on what you don't know yet, and remember the rest for longer.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** End-of-session summary. */
export const SessionSummary: React.FC<{
  results: Record<string, Sm2Rating>;
  onRestart: () => void;
  onReviewForgotten?: () => void;
  extra?: React.ReactNode;
}> = ({ results, onRestart, onReviewForgotten, extra }) => {
  const counts = { again: 0, hard: 0, good: 0, easy: 0 } as Record<Sm2Rating, number>;
  Object.values(results).forEach((r) => (counts[r] += 1));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-rule bg-surface p-7 sm:p-9 text-center shadow-[0_18px_50px_-24px_rgba(2,20,51,0.28)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Session complete</p>
      <h4 className="mt-2 font-serif text-3xl text-ink">You reviewed {total} {total === 1 ? 'card' : 'cards'}</h4>
      <div className="mt-6 grid grid-cols-4 gap-2">
        {GRADES.map((g) => (
          <div key={g.rating} className="rounded-xl bg-paper px-2 py-3">
            <div className={`text-2xl font-semibold tabular-nums ${g.tone.text}`}>{counts[g.rating]}</div>
            <div className="text-xs text-muted">{g.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-sm text-muted">
        Each card is scheduled for the right day. Come back to <span className="font-medium text-ink">Today's review</span> and only
        the cards that are due will show up.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {onReviewForgotten && counts.again > 0 && (
          <button type="button" onClick={onReviewForgotten} className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-ink/90">
            Go over the {counts.again} you forgot
          </button>
        )}
        <button type="button" onClick={onRestart} className="rounded-xl border border-rule bg-surface px-5 py-3 text-sm font-semibold text-ink hover:border-ink">
          Study all again
        </button>
        {extra}
      </div>
    </div>
  );
};
