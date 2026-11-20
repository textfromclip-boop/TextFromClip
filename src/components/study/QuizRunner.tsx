import React, { useEffect, useState } from 'react';
import { QuizQuestion } from '../../types';
import { trackEvent } from '../../utils/analytics';
import { AiNote, Kbd, QuoteBlock, SourceChip } from './StudyBits';

const LETTERS = ['A', 'B', 'C', 'D'];

interface Props {
  questions: QuizQuestion[];
  onSeek: (seconds: number, quote: string) => void;
  /** Turn the missed questions into flashcards. */
  onReviewMissed?: (missed: QuizQuestion[]) => void;
  trackPath?: string;
}

/** Practice exam: one question at a time, instant feedback with the lecture quote, then a scored summary. */
export const QuizRunner: React.FC<Props> = ({ questions, onSeek, onReviewMissed, trackPath }) => {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [finished, setFinished] = useState(false);

  const q = questions[idx];
  const chosen = q ? answers[q.id] : undefined;
  const answered = chosen !== undefined;
  const correctCount = questions.filter((x) => answers[x.id] === x.correct_index).length;
  const missed = questions.filter((x) => answers[x.id] !== x.correct_index);
  const isLast = idx + 1 >= questions.length;

  const choose = (o: number) => {
    if (!q || answered) return;
    setAnswers((prev) => ({ ...prev, [q.id]: o }));
  };
  const next = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (isLast) {
      trackEvent('quiz_finished', trackPath);
      setFinished(true);
    } else setIdx((i) => i + 1);
  };
  const restart = () => {
    setAnswers({});
    setIdx(0);
    setFinished(false);
  };

  // Keyboard: 1-4 or A-D picks an answer, Enter goes on.
  useEffect(() => {
    if (finished) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const k = e.key.toUpperCase();
      const pick = ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1 : LETTERS.indexOf(k);
      if (pick >= 0 && !answered && !(t && /^(BUTTON|A)$/.test(t.tagName) && e.key === 'Enter')) {
        e.preventDefault();
        choose(pick);
      } else if (e.key === 'Enter' && answered && !(t && /^(BUTTON|A)$/.test(t.tagName))) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!questions.length) return <p className="text-sm text-muted">This pack has no quiz questions.</p>;

  if (finished) {
    const pct = Math.round((correctCount / questions.length) * 100);
    const R = 54;
    const C = 2 * Math.PI * R;
    const verdict = pct >= 90 ? 'Excellent. You know this lecture.' : pct >= 70 ? 'Good work. A few to go over.' : pct >= 50 ? 'Getting there. Review the ones you missed.' : 'Worth another pass. Start with what you missed.';
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-2xl border border-rule bg-surface p-7 sm:p-9 shadow-[0_18px_50px_-24px_rgba(2,20,51,0.28)]">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={`Score ${correctCount} out of ${questions.length}`} className="shrink-0">
              <circle cx="66" cy="66" r={R} fill="none" stroke="#E3E3DE" strokeWidth="12" />
              <circle
                cx="66" cy="66" r={R} fill="none" stroke={pct >= 70 ? '#15803D' : pct >= 50 ? '#2E62F4' : '#B45309'} strokeWidth="12" strokeLinecap="round"
                strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 66 66)"
              />
              <text x="66" y="62" textAnchor="middle" className="fill-ink" style={{ font: '600 30px Inter, sans-serif' }}>{correctCount}/{questions.length}</text>
              <text x="66" y="84" textAnchor="middle" style={{ font: '500 13px Inter, sans-serif', fill: '#5B6476' }}>{pct}%</text>
            </svg>
            <div className="text-center sm:text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Practice exam complete</p>
              <h4 className="mt-1.5 font-serif text-3xl text-ink">{verdict}</h4>
              <div className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start">
                {missed.length > 0 && onReviewMissed && (
                  <button type="button" onClick={() => onReviewMissed(missed)} className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-ink/90">
                    Review what you missed ({missed.length} cards) →
                  </button>
                )}
                <button type="button" onClick={restart} className="rounded-xl border border-rule bg-surface px-5 py-3 text-sm font-semibold text-ink hover:border-ink">
                  Retake quiz
                </button>
              </div>
            </div>
          </div>
        </div>

        <ol className="mt-6 space-y-2">
          {questions.map((x, i) => {
            const ok = answers[x.id] === x.correct_index;
            const skipped = answers[x.id] === undefined;
            return (
              <li key={x.id} className="flex items-start gap-3 rounded-xl border border-rule bg-surface px-4 py-3">
                <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${ok ? 'bg-emerald-600' : skipped ? 'bg-slate-400' : 'bg-red-600'}`} aria-label={ok ? 'Correct' : skipped ? 'Skipped' : 'Wrong'}>
                  {ok ? '✓' : skipped ? '–' : '✕'}
                </span>
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="text-sm font-medium text-ink">{i + 1}. {x.question}</p>
                  {!ok && (
                    <p dir="auto" className="mt-1 text-sm text-muted">
                      Answer: <span className="font-medium text-ink">{LETTERS[x.correct_index]}. {x.options[x.correct_index]}</span>
                    </p>
                  )}
                </div>
                <SourceChip source={x.source} onSeek={onSeek} label="Lecture" />
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Progress: one dot per question */}
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-ink">
          Question {idx + 1} <span className="font-normal text-muted">of {questions.length}</span>
        </span>
        <span className="text-muted">
          Score <span className="font-semibold text-ink tabular-nums">{correctCount}</span>
        </span>
      </div>
      <div className="mt-2.5 flex gap-1.5" aria-hidden="true">
        {questions.map((x, i) => {
          const a = answers[x.id];
          const color = a === undefined ? (i === idx ? 'bg-ink' : 'bg-rule') : a === x.correct_index ? 'bg-emerald-600' : 'bg-red-500';
          return <span key={x.id} className={`h-1.5 flex-1 rounded-full transition-colors ${color}`} />;
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-rule bg-surface p-6 sm:p-8 shadow-[0_18px_50px_-24px_rgba(2,20,51,0.28)]">
        <div className="flex items-start justify-between gap-4">
          <h4 dir="auto" className="font-serif text-2xl sm:text-[1.65rem] leading-snug text-ink">
            {q.question}
          </h4>
        </div>

        <div className="mt-6 space-y-2.5" role="radiogroup" aria-label="Answers">
          {q.options.map((opt, o) => {
            const isCorrect = o === q.correct_index;
            const isChosen = chosen === o;
            let cls = 'border-rule bg-surface hover:border-ink hover:bg-paper';
            let badge = 'border-rule bg-paper text-ink';
            if (answered) {
              if (isCorrect) {
                cls = 'border-emerald-600 bg-emerald-50';
                badge = 'border-emerald-600 bg-emerald-600 text-white';
              } else if (isChosen) {
                cls = 'border-red-500 bg-red-50';
                badge = 'border-red-500 bg-red-500 text-white';
              } else {
                cls = 'border-rule bg-surface opacity-60';
              }
            }
            return (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={isChosen}
                disabled={answered}
                onClick={() => choose(o)}
                dir="auto"
                className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left text-[15px] text-ink transition-colors disabled:cursor-default ${cls}`}
              >
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${badge}`}>
                  {answered && isCorrect ? '✓' : answered && isChosen ? '✕' : LETTERS[o]}
                </span>
                <span className="flex-1">{opt}</span>
                {answered && isCorrect && <span className="hidden sm:inline text-xs font-semibold text-emerald-700">Correct answer</span>}
                {answered && isChosen && !isCorrect && <span className="hidden sm:inline text-xs font-semibold text-red-700">Your answer</span>}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className={`mt-5 rounded-xl px-5 py-4 ${chosen === q.correct_index ? 'bg-emerald-50' : 'bg-red-50'}`} role="status">
            <p className={`font-semibold ${chosen === q.correct_index ? 'text-emerald-800' : 'text-red-800'}`}>
              {chosen === q.correct_index ? 'Correct' : `Not quite. The answer is ${LETTERS[q.correct_index]}.`}
            </p>
            <p dir="auto" className="mt-1 text-sm leading-relaxed text-ink/80">{q.explanation}</p>
            <QuoteBlock source={q.source} onSeek={onSeek} className="mt-4" />
            <AiNote text={q.ai_explanation} className="mt-3" />
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-rule pt-5">
          <button
            type="button"
            disabled={idx === 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            className="text-sm font-medium text-muted hover:text-ink disabled:opacity-40"
          >
            ← Previous
          </button>
          <div className="flex items-center gap-3">
            {!answered && (
              <span className="hidden text-xs text-muted sm:inline">
                Pick with <Kbd>A</Kbd>–<Kbd>D</Kbd>
              </span>
            )}
            <button
              type="button"
              onClick={next}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors ${answered ? 'bg-ink text-white hover:bg-ink/90' : 'border border-rule bg-surface text-muted hover:border-ink hover:text-ink'}`}
            >
              {isLast ? 'Finish & see score →' : answered ? 'Next question →' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
