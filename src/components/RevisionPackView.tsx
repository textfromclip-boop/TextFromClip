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
import { FlashcardReviewer, SessionSummary } from './study/FlashcardReviewer';
import { QuizRunner } from './study/QuizRunner';
import { AiNote, QuoteBlock, SourceChip } from './study/StudyBits';
import { QuizQuestion } from '../types';

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
  const [liveFlashcards, setLiveFlashcards] = useState<Flashcard[]>(pack.flashcards);
  const [cardViewMode, setCardViewMode] = useState<'study' | 'list'>('study');
  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [reviewedCardIds, setReviewedCardIds] = useState<Record<string, Sm2Rating>>({});
  const [customDeckCards, setCustomDeckCards] = useState<Flashcard[] | null>(null);
  const [sessionDone, setSessionDone] = useState(false);
  const [quizKey, setQuizKey] = useState(0);

  const mediaPlayerRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLiveFlashcards(pack.flashcards);
  }, [pack.id, pack.flashcards]);

  // Reset internal state when a new pack arrives
  useEffect(() => {
    setActiveCardIdx(0);
    setIsCardFlipped(false);
    setReviewedCardIds({});
    setCustomDeckCards(null);
    setSessionDone(false);
    setQuizKey((k) => k + 1);
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

  const activeDeck = customDeckCards || liveFlashcards;
  const currentCard = activeDeck[activeCardIdx] || activeDeck[0];

  const handleGradeCard = (rating: Sm2Rating) => {
    if (!currentCard) return;
    trackEvent('card_reviewed');
    const updatedCard = scheduleFlashcardSm2(currentCard, rating);
    const applyCardUpdate = (cards: Flashcard[]) =>
      cards.map((c) => (c.id === currentCard.id ? updatedCard : c));
    setLiveFlashcards(applyCardUpdate);
    setCustomDeckCards((prev) => (prev ? applyCardUpdate(prev) : prev));
    setReviewedCardIds((prev) => ({ ...prev, [currentCard.id]: rating }));
    onCardReviewed?.(currentCard, rating);
    if (activeCardIdx + 1 < activeDeck.length) {
      setActiveCardIdx((i) => i + 1);
    } else {
      setSessionDone(true);
    }
  };

  const startSession = (cards: Flashcard[] | null) => {
    setCustomDeckCards(cards);
    setActiveCardIdx(0);
    setReviewedCardIds({});
    setSessionDone(false);
    setCardViewMode('study');
  };

  const handleReviewMissedFromQuiz = (missed: QuizQuestion[]) => {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const missedCards: Flashcard[] = missed.map((q, idx) => ({
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
      startSession(missedCards);
      setActiveSection('flashcards');
      onBuildMissedDeck?.(missedCards);
    }
  };

  const renderSourceBadge = (startSeconds: number, quote: string) => (
    <SourceChip source={{ start_seconds: startSeconds, end_seconds: startSeconds, quote }} onSeek={handleSeekToLecture} />
  );

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

      {/* SECTION 1: STRUCTURED NOTES — numbered sections, contents rail, quotes as real quotations */}
      {activeSection === 'notes' && (
        <div className={`px-5 sm:px-8 py-7 sm:py-10 ${pack.notes.length > 1 ? 'lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12' : ''}`}>
          {pack.notes.length > 1 && (
            <nav aria-label="Note sections" className="hidden lg:block sticky top-24 self-start">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Contents</p>
              <ol className="mt-3 space-y-1 border-l border-rule">
                {pack.notes.map((section, sIdx) => (
                  <li key={section.id}>
                    <a
                      href={`#note-${section.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`note-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="-ml-px block border-l-2 border-transparent py-1.5 pl-3 text-sm text-muted hover:border-accent hover:text-ink"
                    >
                      <span className="mr-2 font-mono text-xs text-accent">{String(sIdx + 1).padStart(2, '0')}</span>
                      <span dir="auto">{section.heading}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="max-w-3xl">
            {pack.notes.map((section, sIdx) => (
              <section key={section.id} id={`note-${section.id}`} className={`scroll-mt-24 ${sIdx > 0 ? 'mt-14' : ''}`}>
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-sm font-medium text-accent">{String(sIdx + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <h4 dir="auto" className="font-serif text-2xl sm:text-[1.75rem] leading-tight text-ink">
                      {section.heading}
                    </h4>
                    <p className="mt-1 text-sm text-muted">
                      {section.bullets.length} {section.bullets.length === 1 ? 'point' : 'points'}, each checked against the lecture
                    </p>
                  </div>
                </div>

                <ul className="mt-6 space-y-4">
                  {section.bullets.map((bullet) => (
                    <li key={bullet.id} className="rounded-2xl border border-rule bg-surface px-5 py-5 sm:px-6">
                      {bullet.is_definition && bullet.term && (
                        <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">
                          Definition
                        </p>
                      )}
                      <p dir="auto" className="text-[16px] sm:text-[17px] leading-relaxed text-ink">
                        {bullet.is_definition && bullet.term ? <strong className="font-semibold">{bullet.term}: </strong> : null}
                        {bullet.text}
                      </p>
                      <QuoteBlock source={bullet.source} onSeek={handleSeekToLecture} className="mt-4" />
                      <AiNote text={bullet.ai_explanation} className="mt-4" />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
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
                  Show all {liveFlashcards.length} cards
                </button>
              )}
            </div>

            <div className="text-xs font-semibold text-muted">
              Reviewed in this session: {Object.keys(reviewedCardIds).length} / {activeDeck.length}
            </div>
          </div>

          {cardViewMode === 'study' && currentCard ? (
            sessionDone ? (
              <SessionSummary
                results={reviewedCardIds}
                onRestart={() => startSession(customDeckCards)}
                onReviewForgotten={() =>
                  startSession(activeDeck.filter((c) => reviewedCardIds[c.id] === 'again'))
                }
              />
            ) : (
              <FlashcardReviewer
                card={currentCard}
                position={activeCardIdx + 1}
                total={activeDeck.length}
                accent={visualColor(activeCardIdx)}
                rtl={isArabic}
                onGrade={handleGradeCard}
                onSeek={handleSeekToLecture}
              />
            )
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
                    <AiNote text={card.ai_explanation} className="mt-3" />
                  </div>
                  <p dir="auto" className="mt-3 text-sm text-ink/75"><span className="quote-mark">“{card.source.quote}”</span></p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: PRACTICE EXAM */}
      {activeSection === 'quiz' && (
        <div className="px-4 py-7 sm:px-6 sm:py-10">
          <QuizRunner key={quizKey} questions={pack.quiz} onSeek={handleSeekToLecture} onReviewMissed={handleReviewMissedFromQuiz} />
        </div>
      )}
    </div>
  );
};
