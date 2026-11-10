import React, { useEffect, useRef, useState } from 'react';
import {
  BILINGUAL_LANGUAGES,
  Flashcard,
  RevisionPack,
} from '../types';
import { formatTimestamp } from '../server/utils/formatters';
import {
  exportRevisionPackPdf,
  generateAnkiCsv,
  generatePackMarkdown,
} from '../utils/packExporters';
import { trackEvent } from '../utils/analytics';
import { scheduleFlashcardSm2, Sm2Rating } from '../utils/sm2';
import { visualColor } from '../utils/packVisuals';
import { CardSheetVisual, MindMapVisual, SketchnotesVisual } from './PackVisuals';

/** Shows the interval SM-2 will actually schedule for this card and rating. */
function intervalLabel(card: Flashcard, rating: Sm2Rating): string {
  const days = scheduleFlashcardSm2(card, rating).interval;
  return days === 0 ? 'today' : `${days}d`;
}

interface RevisionPackViewProps {
  pack: RevisionPack;
  localMediaUrl?: string;
  sourceUrl?: string;
  onRegenerateWithLanguage?: (secondLanguage: string) => void;
  isRegenerating?: boolean;
  onCardReviewed?: (card: Flashcard, rating: 'again' | 'hard' | 'good' | 'easy') => void;
  onBuildMissedDeck?: (missedCards: Flashcard[]) => void;
  onOpenFullStudyPage?: () => void;
}

type PackSectionTab = 'notes' | 'flashcards' | 'quiz' | 'visuals';
type VisualKind = 'mindmap' | 'sketch' | 'sheet';

export const RevisionPackView: React.FC<RevisionPackViewProps> = ({
  pack,
  localMediaUrl,
  sourceUrl,
  onRegenerateWithLanguage,
  isRegenerating = false,
  onCardReviewed,
  onBuildMissedDeck,
  onOpenFullStudyPage,
}) => {
  const [activeSection, setActiveSection] = useState<PackSectionTab>('notes');
  const [visualKind, setVisualKind] = useState<VisualKind>('mindmap');
  const [seekSeconds, setSeekSeconds] = useState<number | null>(null);
  const [seekQuote, setSeekQuote] = useState<string>('');
  const [seekCounter, setSeekCounter] = useState(0);

  // Flashcard study state
  const [cardViewMode, setCardViewMode] = useState<'study' | 'list'>('study');
  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [reviewedCardIds, setReviewedCardIds] = useState<Record<string, string>>({});
  const [customDeckCards, setCustomDeckCards] = useState<Flashcard[] | null>(null);

  // Quiz interactive state (1 question at a time)
  const [quizIdx, setQuizIdx] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [quizFinished, setQuizFinished] = useState(false);

  const mediaPlayerRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  // Reset internal state when a new pack arrives
  useEffect(() => {
    setActiveCardIdx(0);
    setIsCardFlipped(false);
    setReviewedCardIds({});
    setCustomDeckCards(null);
    setQuizIdx(0);
    setSelectedAnswers({});
    setQuizFinished(false);
  }, [pack.id]);

  // Seek local HTML5 video/audio element when seekSeconds updates
  useEffect(() => {
    if (seekSeconds === null || !mediaPlayerRef.current) return;
    try {
      mediaPlayerRef.current.currentTime = seekSeconds;
      mediaPlayerRef.current.play().catch(() => {
        // Autoplay may require user interaction in some browsers
      });
    } catch {
      // ignore
    }
  }, [seekSeconds, seekCounter]);

  const handleSeekToLecture = (seconds: number, quote: string) => {
    const floored = Math.max(0, Math.floor(seconds));
    setSeekSeconds(floored);
    setSeekQuote(quote);
    setSeekCounter((c) => c + 1);
    window.setTimeout(() => {
      playerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const downloadFile = (content: string, ext: string, mime: string, suffix: string = '') => {
    trackEvent('export_clicked');
    const base =
      (pack.title || 'revision-pack')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'revision-pack';
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const activeDeck = customDeckCards || pack.flashcards;
  const currentCard = activeDeck[activeCardIdx] || activeDeck[0];

  const handleGradeCard = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!currentCard) return;
    // Release focus from the clicked grade button so Space flips the next card instead of re-grading.
    (document.activeElement as HTMLElement | null)?.blur?.();
    trackEvent('card_reviewed');
    setReviewedCardIds((prev) => ({ ...prev, [currentCard.id]: rating }));
    onCardReviewed?.(currentCard, rating);
    setIsCardFlipped(false);
    if (activeCardIdx + 1 < activeDeck.length) {
      setActiveCardIdx((i) => i + 1);
    } else {
      setActiveCardIdx(0);
    }
  };

  const currentQuestion = pack.quiz[quizIdx] || pack.quiz[0];
  const wrongQuestions = pack.quiz.filter(
    (q) =>
      selectedAnswers[q.id] !== undefined &&
      selectedAnswers[q.id] !== q.correct_index
  );
  const quizScore = pack.quiz.reduce(
    (acc, q) => acc + (selectedAnswers[q.id] === q.correct_index ? 1 : 0),
    0
  );

  const handleReviewMissedFromQuiz = () => {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const missedCards: Flashcard[] = wrongQuestions.map((q, idx) => ({
      id: `missed-${q.id}-${idx}`,
      front: q.question,
      back: `${q.options[q.correct_index]} — ${q.explanation}`,
      source: q.source,
      ai_explanation: q.ai_explanation,
      due_date: todayUtc,
      interval: 0,
      ease: 2.5,
      reps: 0,
    }));
    if (missedCards.length > 0) {
      setCustomDeckCards(missedCards);
      setActiveCardIdx(0);
      setIsCardFlipped(false);
      setCardViewMode('study');
      setActiveSection('flashcards');
      onBuildMissedDeck?.(missedCards);
    }
  };

  const renderSourceBadge = (startSeconds: number, quote: string) => {
    const label = `From lecture · ${formatTimestamp(startSeconds)}`;
    return (
      <button
        type="button"
        onClick={() => handleSeekToLecture(startSeconds, quote)}
        title={`Play lecture at ${formatTimestamp(startSeconds)} — "${quote}"`}
        className="inline-flex items-center gap-1.5 font-mono text-xs text-accent hover:text-accent-dark hover:underline underline-offset-2 shrink-0"
        dir="ltr"
      >
        <svg className="w-3 h-3 fill-current shrink-0" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        <span>{label}</span>
      </button>
    );
  };

  const renderAiExplanationBox = (aiExplanation?: string) => {
    if (!aiExplanation) return null;
    return (
      <div dir="auto" className="mt-3 border-l-2 border-[#502EF0] pl-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#502EF0]">AI explanation</p>
        <p className="mt-0.5 text-sm text-muted leading-relaxed">
          <bdi dir="auto">{aiExplanation}</bdi>
        </p>
      </div>
    );
  };

  // Study shortcuts: Space/Enter flips, 1-4 = Again/Hard/Good/Easy (after flipping)
  useEffect(() => {
    if (activeSection !== 'flashcards' || cardViewMode !== 'study') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(t.tagName)) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setIsCardFlipped((f) => !f);
      } else if (isCardFlipped && ['1', '2', '3', '4'].includes(e.key)) {
        handleGradeCard((['again', 'hard', 'good', 'easy'] as const)[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const isArabic =
    pack.secondLanguage?.toLowerCase() === 'arabic' ||
    pack.flashcards.some((c) => c.bilingual_language?.toLowerCase() === 'arabic');

  return (
    <div className="mt-6 rounded-lg bg-surface border border-rule overflow-hidden">
      {/* Pack header: title, counts, language and exports */}
      <div className="p-5 sm:p-6 border-b border-rule">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
              Quote-verified revision pack
              {pack.metadata.cached && <span className="ml-2 font-normal normal-case tracking-normal text-muted">· loaded from cache</span>}
            </p>
            <h3 className="mt-1.5 font-serif text-2xl sm:text-3xl text-ink leading-tight" dir="auto">
              {pack.title}
            </h3>
            <p className="mt-1.5 text-sm text-muted">
              {pack.notes.reduce((sum, s) => sum + s.bullets.length, 0)} note points ·{' '}
              {pack.flashcards.length} flashcards · {pack.quiz.length} quiz questions. Tap any{' '}
              <span className="font-mono text-xs text-accent">From lecture · MM:SS</span> to jump to that moment.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {onRegenerateWithLanguage && (
              <select
                aria-label="Second language for flashcards"
                value={pack.secondLanguage || ''}
                disabled={isRegenerating}
                onChange={(e) => onRegenerateWithLanguage(e.target.value)}
                className="rounded-md border border-rule bg-surface px-2.5 py-2 text-sm font-medium text-ink focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="">Original only</option>
                {BILINGUAL_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    + {lang}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => {
                trackEvent('export_clicked');
                exportRevisionPackPdf(pack);
              }}
              className="px-3 py-2 rounded-md border border-rule bg-surface font-medium text-ink hover:border-ink transition-colors"
            >
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => downloadFile(generateAnkiCsv(pack), 'csv', 'text/csv', '-anki')}
              className="px-3 py-2 rounded-md border border-rule bg-surface font-medium text-ink hover:border-ink transition-colors"
            >
              Anki CSV
            </button>
            <button
              type="button"
              onClick={() => downloadFile(generatePackMarkdown(pack), 'md', 'text/markdown', '-notes')}
              className="px-3 py-2 rounded-md border border-rule bg-surface font-medium text-ink hover:border-ink transition-colors"
            >
              Markdown (.MD)
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Lecture Player (Appears when any "From lecture · MM:SS" badge is tapped) */}
      {seekSeconds !== null && (
        <div
          ref={playerContainerRef}
          className="p-4 sm:p-5 bg-slate-900 text-white border-b border-slate-800"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
              <span className="font-mono text-xs text-sky-300">
                Playing at {formatTimestamp(seekSeconds)}
              </span>
              <span className="text-slate-300 truncate max-w-md" dir="auto">
                “{seekQuote}”
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSeekSeconds(null)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded"
            >
              Close player ✕
            </button>
          </div>

          {pack.provider === 'youtube' && pack.videoId ? (
            <div className="aspect-video w-full max-w-2xl mx-auto rounded-md overflow-hidden bg-black border border-slate-700">
              <iframe
                key={`${pack.videoId}-${seekSeconds}-${seekCounter}`}
                title="Lecture video player"
                src={`https://www.youtube.com/embed/${pack.videoId}?start=${seekSeconds}&autoplay=1&rel=0`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : localMediaUrl || (sourceUrl && /\.(mp4|webm|mov|mp3|wav|m4a|ogg)$/i.test(sourceUrl)) ? (
            <div className="max-w-2xl mx-auto">
              <video
                ref={mediaPlayerRef as React.RefObject<HTMLVideoElement>}
                src={localMediaUrl || sourceUrl}
                controls
                className="w-full max-h-80 rounded-md bg-black"
              />
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 rounded-md bg-slate-800 text-xs text-slate-200">
              <span>
                Timestamp {formatTimestamp(seekSeconds)} — verbatim quote verified from lecture audio.
              </span>
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 font-semibold hover:underline"
                >
                  Open original link ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Navigation Tabs: Structured Notes | Flashcards | 10-Question Quiz */}
      <div className="px-5 sm:px-6 border-b border-rule flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-5 sm:gap-7 text-sm font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSection('notes')}
            className={`py-3.5 border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSection === 'notes'
                ? 'border-ink text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            Notes ({pack.notes.length} sections)
          </button>
          <button
            type="button"
            onClick={(e) => {
              (e.currentTarget as HTMLElement).blur();
              setActiveSection('flashcards');
            }}
            className={`py-3.5 border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSection === 'flashcards'
                ? 'border-ink text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            Flashcards ({activeDeck.length})
            {pack.secondLanguage && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-accent-soft text-accent text-[10px]">
                + {pack.secondLanguage}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('quiz')}
            className={`py-3.5 border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSection === 'quiz'
                ? 'border-ink text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            Quiz ({pack.quiz.length} questions)
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('visuals')}
            className={`py-3.5 border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSection === 'visuals'
                ? 'border-ink text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            Visuals
          </button>
        </div>

        <div className="flex items-center gap-3 py-2 text-xs text-muted">
          <span>Saved on this device</span>
          {onOpenFullStudyPage && (
            <button
              type="button"
              onClick={onOpenFullStudyPage}
              className="font-bold text-accent hover:underline"
            >
              Open today’s review
            </button>
          )}
        </div>
      </div>

      {/* SECTION 1: STRUCTURED NOTES — reads like a page of notes, not a stack of cards */}
      {activeSection === 'notes' && (
        <div className="px-5 sm:px-8 py-6 sm:py-8 max-w-3xl">
          {pack.notes.map((section, sIdx) => (
            <section key={section.id} className={sIdx > 0 ? 'mt-10' : ''}>
              <h4 dir="auto" className="font-serif text-xl sm:text-2xl text-ink">
                {section.heading}
              </h4>

              <ul className="mt-3 border-t border-rule">
                {section.bullets.map((bullet) => (
                  <li key={bullet.id} className="py-4 border-b border-rule">
                    <p dir="auto" className="text-[15px] sm:text-base text-ink leading-relaxed">
                      {bullet.is_definition && bullet.term ? (
                        <strong className="font-semibold">{bullet.term}: </strong>
                      ) : null}
                      {bullet.text}
                    </p>

                    <p dir="auto" className="mt-1.5 text-sm text-ink/75 leading-relaxed">
                      <span className="sr-only">Verbatim lecture quote: </span>
                      <span className="quote-mark">“{bullet.source.quote}”</span>
                    </p>

                    <div className="mt-2">{renderSourceBadge(bullet.source.start_seconds, bullet.source.quote)}</div>

                    {renderAiExplanationBox(bullet.ai_explanation)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* VISUALS: mind map, sketchnotes and card sheet, all derived from the verified pack */}
      {activeSection === 'visuals' && (
        <div className="px-5 sm:px-6 py-6">
          <div role="tablist" aria-label="Visual style" className="flex flex-wrap gap-2 mb-5">
            {([
              ['mindmap', 'Mind map'],
              ['sketch', 'Sketchnotes'],
              ['sheet', 'Card sheet'],
            ] as [VisualKind, string][]).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={visualKind === kind}
                onClick={() => setVisualKind(kind)}
                className={`px-3.5 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                  visualKind === kind ? 'bg-ink text-white' : 'bg-slate-100 text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {visualKind === 'mindmap' && <MindMapVisual pack={pack} onSeek={handleSeekToLecture} />}
          {visualKind === 'sketch' && <SketchnotesVisual pack={pack} />}
          {visualKind === 'sheet' && <CardSheetVisual pack={pack} />}
        </div>
      )}

      {/* SECTION 2: FLASHCARDS (DAILY STUDY FLIP MODE + LIST VIEW) */}
      {activeSection === 'flashcards' && (
        <div className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCardViewMode('study')}
                className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  cardViewMode === 'study'
                    ? 'bg-ink text-white'
                    : 'bg-slate-100 text-muted hover:text-ink'
                }`}
              >
                Study
              </button>
              <button
                type="button"
                onClick={() => setCardViewMode('list')}
                className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  cardViewMode === 'list'
                    ? 'bg-ink text-white'
                    : 'bg-slate-100 text-muted hover:text-ink'
                }`}
              >
                All cards ({activeDeck.length})
              </button>
              {customDeckCards && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomDeckCards(null);
                    setActiveCardIdx(0);
                  }}
                  className="text-xs font-semibold text-accent hover:underline ml-2"
                >
                  Show all {pack.flashcards.length} cards
                </button>
              )}
            </div>

            <div className="text-xs font-semibold text-muted">
              Reviewed in this session: {Object.keys(reviewedCardIds).length} / {activeDeck.length}
            </div>
          </div>

          {cardViewMode === 'study' && currentCard ? (
            <div className="max-w-2xl mx-auto">
              {/* Progress Bar */}
              <div className="flex items-center justify-between text-xs font-semibold text-muted mb-2">
                <span>
                  Card {activeCardIdx + 1} of {activeDeck.length}
                </span>
                {renderSourceBadge(currentCard.source.start_seconds, currentCard.source.quote)}
              </div>
              <div className="h-1 w-full rounded-full bg-slate-200 overflow-hidden mb-5">
                <div
                  className="h-full bg-accent transition-all"
                  style={{
                    width: `${Math.round(((activeCardIdx + 1) / Math.max(1, activeDeck.length)) * 100)}%`,
                  }}
                />
              </div>

              {/* Flip Card Box */}
              <div
                onClick={() => setIsCardFlipped((f) => !f)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsCardFlipped((f) => !f);
                  }
                }}
                key={`${currentCard.id}-${isCardFlipped ? 'b' : 'f'}`}
                style={{ borderTopColor: visualColor(activeCardIdx), borderTopWidth: 4 }}
                className="card-flip cursor-pointer relative overflow-hidden rounded-lg border border-rule bg-surface p-6 sm:p-9 hover:border-ink transition-colors min-h-[280px] flex flex-col justify-between"
              >
                <span
                  aria-hidden="true"
                  className="card-number"
                  data-n={String(activeCardIdx + 1).padStart(2, '0')}
                  style={{ color: visualColor(activeCardIdx) }}
                />
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted mb-3">
                    {isCardFlipped ? 'Answer' : 'Question'}
                  </span>

                  {!isCardFlipped ? (
                    <>
                      <p dir="auto" className="font-serif text-2xl sm:text-[1.7rem] text-ink leading-snug">
                        {currentCard.front}
                      </p>
                      {currentCard.front_translation && (
                        <p
                          dir={isArabic ? 'rtl' : 'auto'}
                          className="mt-3 pt-3 border-t border-rule text-base text-ink/80"
                        >
                          {currentCard.front_translation}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p dir="auto" className="text-lg sm:text-xl text-ink leading-relaxed">
                        {currentCard.back}
                      </p>
                      {currentCard.back_translation && (
                        <p
                          dir={isArabic ? 'rtl' : 'auto'}
                          className="mt-3 pt-3 border-t border-rule text-base text-ink/80"
                        >
                          {currentCard.back_translation}
                        </p>
                      )}
                      <p dir="auto" className="mt-4 text-sm text-ink/75"><span className="quote-mark">“{currentCard.source.quote}”</span></p>
                      {renderAiExplanationBox(currentCard.ai_explanation)}
                    </>
                  )}
                </div>

                <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-muted">
                  <span>Click the card or press Space to flip. After flipping, press 1 to 4 to grade.</span>
                  <span className="font-semibold text-accent">
                    {isCardFlipped ? 'Show Question' : 'Reveal Answer'}
                  </span>
                </div>
              </div>

              {/* Spaced Repetition Buttons: Again / Hard / Good / Easy */}
              <div className="mt-4 grid grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleGradeCard('again')}
                  className="py-2.5 px-3 rounded-md border border-rule bg-surface hover:border-ink text-ink font-semibold text-xs sm:text-sm transition-colors"
                >
                  Again
                  <span className="block text-[11px] font-normal text-muted">{currentCard ? intervalLabel(currentCard, 'again') : ''}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGradeCard('hard')}
                  className="py-2.5 px-3 rounded-md border border-rule bg-surface hover:border-ink text-ink font-semibold text-xs sm:text-sm transition-colors"
                >
                  Hard
                  <span className="block text-[11px] font-normal text-muted">{currentCard ? intervalLabel(currentCard, 'hard') : ''}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGradeCard('good')}
                  className="py-2.5 px-3 rounded-md border border-rule bg-surface hover:border-ink text-ink font-semibold text-xs sm:text-sm transition-colors"
                >
                  Good
                  <span className="block text-[11px] font-normal text-muted">{currentCard ? intervalLabel(currentCard, 'good') : ''}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGradeCard('easy')}
                  className="py-2.5 px-3 rounded-md border border-rule bg-surface hover:border-ink text-ink font-semibold text-xs sm:text-sm transition-colors"
                >
                  Easy
                  <span className="block text-[11px] font-normal text-muted">{currentCard ? intervalLabel(currentCard, 'easy') : ''}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {activeDeck.map((card, idx) => (
                <div
                  key={card.id}
                  className="rounded-lg border border-rule bg-surface p-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span className="text-xs font-mono font-bold text-muted">
                        Card #{idx + 1}
                      </span>
                      {renderSourceBadge(card.source.start_seconds, card.source.quote)}
                    </div>
                    <p dir="auto" className="text-sm font-bold text-ink">
                      Q: {card.front}
                    </p>
                    {card.front_translation && (
                      <p
                        dir={isArabic ? 'rtl' : 'auto'}
                        className="mt-1 text-sm text-slate-700 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/80"
                      >
                        {card.front_translation}
                      </p>
                    )}
                    <p dir="auto" className="mt-2.5 text-sm text-ink/90">
                      <span className="font-semibold">A:</span> {card.back}
                    </p>
                    {card.back_translation && (
                      <p
                        dir={isArabic ? 'rtl' : 'auto'}
                        className="mt-1 text-sm text-slate-700 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/80"
                      >
                        {card.back_translation}
                      </p>
                    )}
                    {renderAiExplanationBox(card.ai_explanation)}
                  </div>
                  <p dir="auto" className="mt-3 text-sm text-ink/75"><span className="quote-mark">“{card.source.quote}”</span></p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: 10-QUESTION MULTIPLE CHOICE QUIZ */}
      {activeSection === 'quiz' && (
        <div className="p-4 sm:p-6">
          {!quizFinished && currentQuestion ? (
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-xs font-mono font-bold uppercase text-accent">
                  Question {quizIdx + 1} of {pack.quiz.length}
                </span>
                {renderSourceBadge(
                  currentQuestion.source.start_seconds,
                  currentQuestion.source.quote
                )}
              </div>

              <div className="rounded-lg border border-rule bg-surface p-5 sm:p-6">
                <h4 dir="auto" className="text-base sm:text-lg font-bold text-ink leading-snug">
                  {currentQuestion.question}
                </h4>

                <div className="mt-4 space-y-2.5">
                  {currentQuestion.options.map((opt, oIdx) => {
                    const chosen = selectedAnswers[currentQuestion.id];
                    const isAnswered = chosen !== undefined;
                    const isCorrect = oIdx === currentQuestion.correct_index;
                    const isSelected = chosen === oIdx;

                    let btnClass =
                      'border-rule bg-surface hover:border-accent text-ink';
                    if (isAnswered) {
                      if (isCorrect) {
                        btnClass =
                          'border-emerald-500 bg-emerald-50 text-emerald-950 font-semibold';
                      } else if (isSelected) {
                        btnClass = 'border-red-400 bg-red-50 text-red-900';
                      } else {
                        btnClass = 'border-rule bg-slate-50/60 text-muted';
                      }
                    }

                    return (
                      <button
                        key={oIdx}
                        type="button"
                        disabled={isAnswered}
                        onClick={() =>
                          setSelectedAnswers((prev) => ({
                            ...prev,
                            [currentQuestion.id]: oIdx,
                          }))
                        }
                        dir="auto"
                        className={`w-full text-left p-3.5 rounded-md border text-sm transition-all flex items-start gap-3 ${btnClass}`}
                      >
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-100 text-ink shrink-0">
                          {String.fromCharCode(65 + oIdx)}
                        </span>
                        <span className="flex-1">{opt}</span>
                      </button>
                    );
                  })}
                </div>

                {selectedAnswers[currentQuestion.id] !== undefined && (
                  <div className="mt-4 p-4 rounded-md bg-slate-50 border border-slate-200 text-xs sm:text-sm">
                    <p dir="auto" className="font-bold text-ink">
                      {selectedAnswers[currentQuestion.id] === currentQuestion.correct_index
                        ? 'Correct'
                        : `Incorrect. Correct answer is ${String.fromCharCode(
                            65 + currentQuestion.correct_index
                          )}`}
                    </p>
                    <p dir="auto" className="mt-1 text-slate-700 leading-relaxed">
                      {currentQuestion.explanation}
                    </p>
                    <p dir="auto" className="mt-2 text-sm text-ink/75"><span className="quote-mark">“{currentQuestion.source.quote}”</span></p>
                    {renderAiExplanationBox(currentQuestion.ai_explanation)}
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={quizIdx === 0}
                    onClick={() => setQuizIdx((i) => Math.max(0, i - 1))}
                    className="text-xs font-semibold text-muted hover:text-ink disabled:opacity-40"
                  >
                    ← Previous
                  </button>

                  {quizIdx + 1 < pack.quiz.length ? (
                    <button
                      type="button"
                      onClick={() => setQuizIdx((i) => i + 1)}
                      className="px-4 py-2 rounded-md bg-accent text-white text-xs font-bold hover:bg-accent-dark"
                    >
                      Next Question →
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        trackEvent('quiz_finished');
                        setQuizFinished(true);
                      }}
                      className="px-5 py-2 rounded-md bg-accent text-white text-xs font-bold"
                    >
                      Finish & See Score →
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto text-center p-6 rounded-lg border border-rule bg-slate-50/70">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                Mock Exam Complete
              </span>
              <h4 className="mt-3 text-2xl sm:text-3xl font-semibold text-ink">
                You scored {quizScore} / {pack.quiz.length}
              </h4>
              <p className="mt-1 text-sm text-muted">
                Every question is linked directly to its source moment in the lecture.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                {wrongQuestions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleReviewMissedFromQuiz}
                    className="px-5 py-2.5 rounded-md bg-accent text-white text-xs sm:text-sm font-bold"
                  >
                    Review what you missed ({wrongQuestions.length} cards) →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAnswers({});
                    setQuizIdx(0);
                    setQuizFinished(false);
                  }}
                  className="px-4 py-2.5 rounded-md border border-rule bg-surface text-xs sm:text-sm font-bold text-ink hover:bg-slate-100"
                >
                  Retake Quiz
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
