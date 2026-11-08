import React, { useEffect, useState } from 'react';
import { Link, navigate } from '../router';
import { Flashcard } from '../types';
import { formatTimestamp } from '../server/utils/formatters';
import {
  createMissedQuestionsDeck,
  deleteStudyDeck,
  getDeckDueStats,
  loadAllStudyDecks,
  loadStudyMeta,
  recordCardReviewInStore,
  saveStudyMeta,
  StoredStudyDeck,
  StudyMetaState,
} from '../utils/studyStore';
import { isCardDueToday, Sm2Rating } from '../utils/sm2';
import {
  exportRevisionPackPdf,
  generateAnkiCsv,
  generatePackMarkdown,
} from '../utils/packExporters';

export const StudyPage: React.FC = () => {
  const [decks, setDecks] = useState<StoredStudyDeck[]>([]);
  const [meta, setMeta] = useState<StudyMetaState>({
    streakDays: 0,
    lastStudyUtcDate: null,
    totalReviewsCount: 0,
    syncedUserEmail: null,
  });
  const [loading, setLoading] = useState(true);

  // Active review session state
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [mode, setMode] = useState<'dashboard' | 'review' | 'quiz'>('dashboard');
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Interactive lecture timestamp player inside /study
  const [seekInfo, setSeekInfo] = useState<{
    provider: string;
    videoId: string;
    seconds: number;
    quote: string;
    sourceUrl?: string;
  } | null>(null);

  // Quiz state
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizDone, setQuizDone] = useState(false);

  // "Save my streak" magic link modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncEmail, setSyncEmail] = useState('');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncSubmitting, setSyncSubmitting] = useState(false);

  const refreshStore = async () => {
    setLoading(true);
    const [loadedDecks, loadedMeta] = await Promise.all([
      loadAllStudyDecks(),
      loadStudyMeta(),
    ]);
    setDecks(loadedDecks);
    setMeta(loadedMeta);
    setLoading(false);
  };

  useEffect(() => {
    refreshStore();
  }, []);

  const totalDueToday = decks.reduce(
    (sum, d) => sum + getDeckDueStats(d).dueTodayCount,
    0
  );

  // Build list of due cards (either for the selected deck, or across all decks if activeDeckId === 'all')
  const selectedDeck = decks.find((d) => d.id === activeDeckId) || null;
  const dueQueue: Array<{ deck: StoredStudyDeck; card: Flashcard }> = [];

  if (activeDeckId === 'all') {
    for (const d of decks) {
      for (const c of d.pack.flashcards) {
        if (isCardDueToday(c)) {
          dueQueue.push({ deck: d, card: c });
        }
      }
    }
  } else if (selectedDeck) {
    const dueInDeck = selectedDeck.pack.flashcards.filter((c) => isCardDueToday(c));
    const sourceCards = dueInDeck.length > 0 ? dueInDeck : selectedDeck.pack.flashcards;
    for (const c of sourceCards) {
      dueQueue.push({ deck: selectedDeck, card: c });
    }
  }

  const currentDueItem = dueQueue[cardIdx] || dueQueue[0] || null;

  const handleGrade = async (rating: Sm2Rating) => {
    if (!currentDueItem) return;
    const { meta: updatedMeta } = await recordCardReviewInStore(
      currentDueItem.deck.id,
      currentDueItem.card.id,
      rating
    );
    const refreshedDecks = await loadAllStudyDecks();
    setDecks(refreshedDecks);
    setMeta(updatedMeta);
    setFlipped(false);
    if (cardIdx + 1 < dueQueue.length) {
      setCardIdx(cardIdx);
    } else {
      setCardIdx(0);
    }
  };

  const handleRequestMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!syncEmail.trim()) return;
    setSyncSubmitting(true);
    setSyncStatus(null);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: syncEmail.trim() }),
      });
      const json: any = await res.json();
      if (res.ok && json?.success) {
        const updated = await saveStudyMeta({
          ...meta,
          syncedUserEmail: syncEmail.trim(),
        });
        setMeta(updated);
        setSyncStatus(
          json.data?.message ||
            `Magic link sent to ${syncEmail.trim()}! Check your inbox to sync your decks across devices.`
        );
      } else {
        setSyncStatus(
          json?.error?.message ||
            'Cloud sync requires an active Exam Pass, Monthly, or Semester Pass. Visit Pricing to upgrade!'
        );
      }
    } catch {
      setSyncStatus('Could not send magic link right now. Please try again.');
    } finally {
      setSyncSubmitting(false);
    }
  };

  const downloadFile = (content: string, ext: string, mime: string, title: string) => {
    const base =
      (title || 'study-deck')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'study-deck';
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 pt-8 sm:pt-12 pb-12">
      {/* TODAY HEADER */}
      <div className="rounded-2xl bg-gradient-to-r from-[#021433] via-[#0B2559] to-[#1E1B4B] p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-emerald-300 border border-emerald-400/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {meta.syncedUserEmail
                  ? `Synced (${meta.syncedUserEmail})`
                  : 'Saved on this device'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 font-bold">
                🔥 {meta.streakDays} {meta.streakDays === 1 ? 'day' : 'days'} streak
              </span>
              <span className="text-slate-300">
                {meta.totalReviewsCount} total card reviews
              </span>
            </div>

            <h1 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight text-white">
              Today’s Study Schedule
            </h1>
            <p className="mt-1.5 text-sm sm:text-base text-slate-300">
              {totalDueToday > 0
                ? `You have ${totalDueToday} ${
                    totalDueToday === 1 ? 'flashcard' : 'flashcards'
                  } due for spaced-repetition review today.`
                : decks.length > 0
                ? 'All caught up for today! You can still review any deck or take a mock exam below.'
                : 'Paste a lecture link or upload a recording to build your first study deck.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {totalDueToday > 0 && mode === 'dashboard' && (
              <button
                type="button"
                onClick={() => {
                  setActiveDeckId('all');
                  setCardIdx(0);
                  setFlipped(false);
                  setMode('review');
                }}
                className="px-5 py-3 rounded-xl font-extrabold text-sm text-white bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] shadow-lg hover:opacity-95 transition-opacity"
              >
                Review {totalDueToday} Due Today →
              </button>
            )}

            <button
              type="button"
              onClick={() => setSyncModalOpen(true)}
              className="px-4 py-3 rounded-xl font-bold text-xs sm:text-sm bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors"
            >
              🔒 Save my streak
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Lecture Timestamp Player (when "From lecture · MM:SS" is tapped) */}
      {seekInfo && (
        <div className="mt-6 p-4 sm:p-5 rounded-2xl bg-slate-900 text-white border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
              <span className="px-2.5 py-0.5 rounded-full bg-[#2E62F4] text-white font-mono text-xs">
                From lecture · {formatTimestamp(seekInfo.seconds)}
              </span>
              <span className="text-slate-300 truncate max-w-md" dir="auto">
                “{seekInfo.quote}”
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSeekInfo(null)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1"
            >
              Close ✕
            </button>
          </div>
          {seekInfo.provider === 'youtube' && seekInfo.videoId ? (
            <div className="aspect-video w-full max-w-2xl mx-auto rounded-xl overflow-hidden bg-black">
              <iframe
                key={`${seekInfo.videoId}-${seekInfo.seconds}`}
                title="Lecture player"
                src={`https://www.youtube.com/embed/${seekInfo.videoId}?start=${Math.floor(
                  seekInfo.seconds
                )}&autoplay=1&rel=0`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <p className="text-xs text-slate-300">
              Verified lecture quote at {formatTimestamp(seekInfo.seconds)}: “{seekInfo.quote}”
            </p>
          )}
        </div>
      )}

      {/* MODE 1: SPACED REPETITION FLIP REVIEWER */}
      {mode === 'review' && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => setMode('dashboard')}
              className="text-xs sm:text-sm font-bold text-accent hover:underline"
            >
              ← Back to Today’s Decks
            </button>
            <span className="text-xs font-semibold text-muted">
              {dueQueue.length > 0
                ? `${dueQueue.length} cards remaining in queue`
                : 'Queue complete!'}
            </span>
          </div>

          {currentDueItem ? (
            <div className="max-w-2xl mx-auto">
              <div className="rounded-2xl border-2 border-accent/25 bg-surface p-6 sm:p-8 shadow-md">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <span className="text-xs font-bold text-muted truncate">
                    {currentDueItem.deck.title}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSeekInfo({
                        provider: currentDueItem.deck.provider,
                        videoId: currentDueItem.deck.videoId,
                        seconds: currentDueItem.card.source.start_seconds,
                        quote: currentDueItem.card.source.quote,
                        sourceUrl: currentDueItem.deck.sourceUrl,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-accent-soft text-accent hover:bg-accent hover:text-white transition-colors"
                    dir="ltr"
                  >
                    <span>
                      From lecture · {formatTimestamp(currentDueItem.card.source.start_seconds)}
                    </span>
                  </button>
                </div>

                <div
                  onClick={() => setFlipped((f) => !f)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFlipped((f) => !f);
                    }
                  }}
                  className="cursor-pointer min-h-[200px] flex flex-col justify-between py-2"
                >
                  {!flipped ? (
                    <div>
                      <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-[11px] font-mono uppercase text-muted mb-2">
                        Question · Tap to flip
                      </span>
                      <p dir="auto" className="text-lg sm:text-xl font-bold text-ink">
                        {currentDueItem.card.front}
                      </p>
                      {currentDueItem.card.front_translation && (
                        <p
                          dir={
                            currentDueItem.card.bilingual_language?.toLowerCase() === 'arabic'
                              ? 'rtl'
                              : 'auto'
                          }
                          className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-base text-slate-800"
                        >
                          {currentDueItem.card.front_translation}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 text-[11px] font-mono uppercase text-emerald-700 mb-2">
                        Answer
                      </span>
                      <p dir="auto" className="text-base sm:text-lg font-semibold text-ink">
                        {currentDueItem.card.back}
                      </p>
                      {currentDueItem.card.back_translation && (
                        <p
                          dir={
                            currentDueItem.card.bilingual_language?.toLowerCase() === 'arabic'
                              ? 'rtl'
                              : 'auto'
                          }
                          className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-base text-slate-800"
                        >
                          {currentDueItem.card.back_translation}
                        </p>
                      )}
                      <p dir="auto" className="mt-3 text-xs text-muted italic">
                        Verbatim lecture quote: “{currentDueItem.card.source.quote}”
                      </p>
                      {currentDueItem.card.ai_explanation && (
                        <div
                          dir="auto"
                          className="mt-3 p-3 rounded-xl bg-[#F5F3FF] border border-[#502EF0]/25 text-xs text-[#1E1B4B]"
                        >
                          <span className="inline-block px-2 py-0.5 mr-2 rounded bg-[#502EF0] text-white font-bold text-[10px] uppercase">
                            AI explanation
                          </span>
                          {currentDueItem.card.ai_explanation}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-muted">
                    <span>
                      Interval: {currentDueItem.card.interval}d · Ease: {currentDueItem.card.ease} · Reps:{' '}
                      {currentDueItem.card.reps}
                    </span>
                    <span className="font-semibold text-accent">
                      {flipped ? 'Show Question' : 'Flip Card →'}
                    </span>
                  </div>
                </div>
              </div>

              {/* SM-2 Buttons: Again / Hard / Good / Easy */}
              <div className="mt-4 grid grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleGrade('again')}
                  className="py-3 px-3 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-900 font-bold text-xs sm:text-sm"
                >
                  Again
                  <span className="block text-[10px] font-normal text-red-700">Due today</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGrade('hard')}
                  className="py-3 px-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs sm:text-sm"
                >
                  Hard
                  <span className="block text-[10px] font-normal text-amber-700">Short interval</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGrade('good')}
                  className="py-3 px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs sm:text-sm"
                >
                  Good
                  <span className="block text-[10px] font-normal text-emerald-700">Standard SM-2</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGrade('easy')}
                  className="py-3 px-3 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-900 font-bold text-xs sm:text-sm"
                >
                  Easy
                  <span className="block text-[10px] font-normal text-sky-700">Bonus interval</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-lg mx-auto text-center p-8 rounded-2xl bg-surface border border-rule">
              <h3 className="text-xl font-black text-ink">🎉 You finished today’s queue!</h3>
              <p className="mt-1.5 text-sm text-muted">
                Your streak is now {meta.streakDays} {meta.streakDays === 1 ? 'day' : 'days'}.
              </p>
              <button
                type="button"
                onClick={() => setMode('dashboard')}
                className="mt-5 px-5 py-2.5 rounded-xl bg-accent text-white font-bold text-xs sm:text-sm"
              >
                Return to Decks
              </button>
            </div>
          )}
        </div>
      )}

      {/* MODE 2: ONE-AT-A-TIME QUIZ MODE */}
      {mode === 'quiz' && selectedDeck && (
        <div className="mt-8 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => setMode('dashboard')}
              className="text-xs sm:text-sm font-bold text-accent hover:underline"
            >
              ← Back to Today’s Decks
            </button>
            <span className="text-xs font-semibold text-muted">{selectedDeck.title}</span>
          </div>

          {!quizDone && selectedDeck.pack.quiz[quizIdx] ? (
            (() => {
              const q = selectedDeck.pack.quiz[quizIdx];
              const chosen = quizAnswers[q.id];
              return (
                <div className="rounded-2xl border border-rule bg-surface p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs font-mono font-bold text-accent uppercase">
                      Question {quizIdx + 1} of {selectedDeck.pack.quiz.length}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSeekInfo({
                          provider: selectedDeck.provider,
                          videoId: selectedDeck.videoId,
                          seconds: q.source.start_seconds,
                          quote: q.source.quote,
                          sourceUrl: selectedDeck.sourceUrl,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-accent-soft text-accent"
                      dir="ltr"
                    >
                      From lecture · {formatTimestamp(q.source.start_seconds)}
                    </button>
                  </div>

                  <h3 dir="auto" className="text-lg font-bold text-ink">
                    {q.question}
                  </h3>

                  <div className="mt-4 space-y-2.5">
                    {q.options.map((opt, oIdx) => {
                      const isAnswered = chosen !== undefined;
                      const isCorrect = oIdx === q.correct_index;
                      const isSelected = chosen === oIdx;
                      let cls = 'border-rule bg-surface hover:border-accent text-ink';
                      if (isAnswered) {
                        if (isCorrect) cls = 'border-emerald-500 bg-emerald-50 text-emerald-950 font-semibold';
                        else if (isSelected) cls = 'border-red-400 bg-red-50 text-red-900';
                        else cls = 'border-rule bg-slate-50 text-muted';
                      }
                      return (
                        <button
                          key={oIdx}
                          type="button"
                          disabled={isAnswered}
                          onClick={() =>
                            setQuizAnswers((prev) => ({ ...prev, [q.id]: oIdx }))
                          }
                          dir="auto"
                          className={`w-full text-left p-3.5 rounded-xl border text-sm flex items-start gap-3 ${cls}`}
                        >
                          <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-100 text-ink">
                            {String.fromCharCode(65 + oIdx)}
                          </span>
                          <span className="flex-1">{opt}</span>
                        </button>
                      );
                    })}
                  </div>

                  {chosen !== undefined && (
                    <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm">
                      <p className="font-bold text-ink">
                        {chosen === q.correct_index
                          ? '✓ Correct!'
                          : `✕ Incorrect — Answer is ${String.fromCharCode(65 + q.correct_index)}`}
                      </p>
                      <p dir="auto" className="mt-1 text-slate-700">
                        {q.explanation}
                      </p>
                    </div>
                  )}

                  <div className="mt-5 pt-4 border-t border-slate-100 flex justify-between">
                    <button
                      type="button"
                      disabled={quizIdx === 0}
                      onClick={() => setQuizIdx((i) => Math.max(0, i - 1))}
                      className="text-xs font-semibold text-muted disabled:opacity-40"
                    >
                      ← Previous
                    </button>
                    {quizIdx + 1 < selectedDeck.pack.quiz.length ? (
                      <button
                        type="button"
                        onClick={() => setQuizIdx((i) => i + 1)}
                        className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-bold"
                      >
                        Next Question →
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setQuizDone(true)}
                        className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] text-white text-xs font-bold"
                      >
                        Finish Quiz →
                      </button>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            (() => {
              const wrongQs = selectedDeck.pack.quiz.filter(
                (q) => quizAnswers[q.id] !== q.correct_index
              );
              const score = selectedDeck.pack.quiz.length - wrongQs.length;
              return (
                <div className="rounded-2xl border border-rule bg-surface p-6 text-center">
                  <h3 className="text-2xl font-black text-ink">
                    Score: {score} / {selectedDeck.pack.quiz.length}
                  </h3>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    {wrongQs.length > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          const todayUtc = new Date().toISOString().slice(0, 10);
                          const missedCards: Flashcard[] = wrongQs.map((q, idx) => ({
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
                          const newDeck = await createMissedQuestionsDeck(
                            selectedDeck.title,
                            missedCards,
                            selectedDeck.provider,
                            selectedDeck.videoId
                          );
                          await refreshStore();
                          setActiveDeckId(newDeck.id);
                          setCardIdx(0);
                          setFlipped(false);
                          setMode('review');
                        }}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] text-white font-bold text-xs sm:text-sm"
                      >
                        Review what you missed ({wrongQs.length} cards) →
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMode('dashboard')}
                      className="px-4 py-2.5 rounded-xl border border-rule font-bold text-xs sm:text-sm"
                    >
                      Back to Decks
                    </button>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* MODE 3: DECKS DASHBOARD */}
      {mode === 'dashboard' && (
        <div className="mt-8">
          {loading ? (
            <p className="text-sm text-muted py-12 text-center">Loading your study decks…</p>
          ) : decks.length === 0 ? (
            <div className="rounded-2xl border border-rule bg-surface p-10 text-center max-w-xl mx-auto">
              <h2 className="text-xl font-black text-ink">No revision packs saved yet</h2>
              <p className="mt-2 text-sm text-muted">
                Paste a YouTube lecture link or upload a recording, then click{' '}
                <strong>Make my revision pack</strong> to build your first deck.
              </p>
              <Link
                to="/youtube"
                className="mt-5 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] shadow-md"
              >
                Create my first revision pack →
              </Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              {decks.map((deck) => {
                const stats = getDeckDueStats(deck);
                return (
                  <div
                    key={deck.id}
                    className="rounded-2xl border border-rule bg-surface p-5 shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
                        <span className="px-2.5 py-0.5 rounded-md bg-accent-soft text-accent uppercase font-mono">
                          {deck.provider}
                        </span>
                        <span>
                          {stats.dueTodayCount} due today · {stats.totalCards} cards
                        </span>
                      </div>

                      <h3 dir="auto" className="mt-2.5 text-lg font-extrabold text-ink">
                        {deck.title}
                      </h3>

                      {/* Progress bar per deck */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted mb-1">
                          <span>Mastery schedule progress</span>
                          <span className="font-mono font-bold text-ink">
                            {stats.progressPercent}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0]"
                            style={{ width: `${stats.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDeckId(deck.id);
                            setCardIdx(0);
                            setFlipped(false);
                            setMode('review');
                          }}
                          className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:opacity-95"
                        >
                          Study Cards ({stats.dueTodayCount || stats.totalCards})
                        </button>

                        {deck.pack.quiz.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveDeckId(deck.id);
                              setQuizIdx(0);
                              setQuizAnswers({});
                              setQuizDone(false);
                              setMode('quiz');
                            }}
                            className="px-3.5 py-2 rounded-xl border border-rule bg-surface text-xs font-bold text-ink hover:border-accent"
                          >
                            Quiz ({deck.pack.quiz.length})
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => exportRevisionPackPdf(deck.pack)}
                          className="font-semibold text-muted hover:text-accent"
                        >
                          PDF
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() =>
                            downloadFile(
                              generateAnkiCsv(deck.pack),
                              'csv',
                              'text/csv',
                              `${deck.title}-anki`
                            )
                          }
                          className="font-semibold text-muted hover:text-accent"
                        >
                          Anki
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() =>
                            downloadFile(
                              generatePackMarkdown(deck.pack),
                              'md',
                              'text/markdown',
                              deck.title
                            )
                          }
                          className="font-semibold text-muted hover:text-accent"
                        >
                          MD
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteStudyDeck(deck.id);
                            await refreshStore();
                          }}
                          className="font-semibold text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* "Save my streak" Magic Link Modal */}
      {syncModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface border border-rule p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-ink">Save my streak & sync decks</h3>
              <button
                type="button"
                onClick={() => {
                  setSyncModalOpen(false);
                  setSyncStatus(null);
                }}
                className="text-muted hover:text-ink text-sm"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-xs sm:text-sm text-muted leading-relaxed">
              On the free plan, your decks stay on this browser. With an Exam Pass, Monthly, or Semester Pass, sign in with an email magic link (no password needed) to sync your decks and streak across all your devices.
            </p>

            <form onSubmit={handleRequestMagicLink} className="mt-4 space-y-3">
              <input
                type="email"
                required
                value={syncEmail}
                onChange={(e) => setSyncEmail(e.target.value)}
                placeholder="you@university.edu"
                className="w-full px-3.5 py-2.5 rounded-xl border border-rule text-sm text-ink focus:outline-none focus:border-accent"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={syncSubmitting}
                  className="flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0]"
                >
                  {syncSubmitting ? 'Sending magic link…' : 'Send Email Magic Link'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSyncModalOpen(false);
                    navigate('/pricing');
                  }}
                  className="py-2.5 px-4 rounded-xl border border-rule font-bold text-xs sm:text-sm text-ink hover:bg-slate-50"
                >
                  View Plans
                </button>
              </div>
            </form>

            {syncStatus && (
              <p className="mt-3 p-3 rounded-xl bg-accent-soft text-accent text-xs font-semibold">
                {syncStatus}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
