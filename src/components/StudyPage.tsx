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
  StoredStudyDeck,
  StudyMetaState,
  syncDecksWithCloud,
} from '../utils/studyStore';
import { isCardDueToday, Sm2Rating } from '../utils/sm2';
import { visualColor } from '../utils/packVisuals';
import {
  exportRevisionPackPdf,
  generateAnkiCsv,
  generatePackMarkdown,
} from '../utils/packExporters';
import { trackEvent } from '../utils/analytics';

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

  // Cloud sync (paid + signed in): who am I, then pull/push decks
  const [account, setAccount] = useState<{ signedIn: boolean; email: string | null; cloudSync: boolean } | null>(null);
  const [devLoginUrl, setDevLoginUrl] = useState<string | null>(null);

  useEffect(() => {
    refreshStore();
    (async () => {
      try {
        const res = await fetch('/api/me');
        const json: any = await res.json();
        if (json?.success) {
          setAccount(json.data);
          if (json.data.cloudSync && (await syncDecksWithCloud())) {
            await refreshStore();
          }
        }
      } catch {
        // offline: local decks still work
      }
    })();
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('login') === 'expired') {
        setSyncStatus('That sign-in link has expired or was already used. Request a new one below.');
        setSyncModalOpen(true);
      }
    } catch {
      // ignore
    }
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
    trackEvent('card_reviewed', '/study');
    const { meta: updatedMeta } = await recordCardReviewInStore(
      currentDueItem.deck.id,
      currentDueItem.card.id,
      rating
    );
    const refreshedDecks = await loadAllStudyDecks();
    setDecks(refreshedDecks);
    setMeta(updatedMeta);
    if (account?.cloudSync) {
      void syncDecksWithCloud([currentDueItem.deck.id]);
    }
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
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setDevLoginUrl(json.data?.devVerifyUrl || null);
        setSyncStatus(
          `Sign-in link sent to ${syncEmail.trim()}. It works once and expires in 15 minutes.`
        );
      } else {
        setSyncStatus(json?.error?.message || 'Could not send the sign-in link. Please try again.');
      }
    } catch {
      setSyncStatus('Could not send magic link right now. Please try again.');
    } finally {
      setSyncSubmitting(false);
    }
  };

  const downloadFile = (content: string, ext: string, mime: string, title: string) => {
    trackEvent('export_clicked', '/study');
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
      {/* Today header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-rule">
        <div>
          <p className="text-sm text-muted">
            {account?.cloudSync && account.email
              ? `Synced to cloud (${account.email})`
              : account?.signedIn && account.email
              ? `Signed in (${account.email}) · saved on this device`
              : 'Saved on this device'}
          </p>
          <h1 className="mt-1 text-4xl sm:text-5xl text-ink leading-[1.1]">Today’s study</h1>
          <p className="mt-3 text-base text-muted">
            {totalDueToday > 0
              ? `You have ${totalDueToday} ${
                  totalDueToday === 1 ? 'flashcard' : 'flashcards'
                } due for review today.`
              : decks.length > 0
              ? 'All caught up for today. You can still review any deck or take a quiz below.'
              : 'Paste a lecture link or upload a recording to build your first study deck.'}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {totalDueToday > 0 && mode === 'dashboard' && (
              <button
                type="button"
                onClick={() => {
                  setActiveDeckId('all');
                  setCardIdx(0);
                  setFlipped(false);
                  setMode('review');
                }}
                className="px-4 py-2.5 rounded-md font-semibold text-sm text-white bg-accent hover:bg-accent-dark transition-colors"
              >
                Review {totalDueToday} due today
              </button>
            )}
            <button
              type="button"
              onClick={() => setSyncModalOpen(true)}
              className="px-4 py-2.5 rounded-md font-semibold text-sm text-ink border border-rule bg-surface hover:border-ink transition-colors"
            >
              Sign in to sync
            </button>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-8 text-sm">
          <div>
            <dd aria-hidden="true" className="font-serif text-4xl text-ink tabular-nums">{totalDueToday}</dd>
            <dt className="mt-1 text-muted">due today</dt>
          </div>
          <div>
            <dd aria-hidden="true" className="font-serif text-4xl text-ink tabular-nums">{meta.streakDays}</dd>
            <dt className="mt-1 text-muted">
              <span className="sr-only">{meta.streakDays} </span>
              {meta.streakDays === 1 ? 'day' : 'days'} streak
            </dt>
          </div>
          <div>
            <dd aria-hidden="true" className="font-serif text-4xl text-ink tabular-nums">{meta.totalReviewsCount}</dd>
            <dt className="mt-1 text-muted">
              <span className="sr-only">{meta.totalReviewsCount} </span>total card reviews
            </dt>
          </div>
        </dl>
      </div>

      {/* Interactive Lecture Timestamp Player (when "From lecture · MM:SS" is tapped) */}
      {seekInfo && (
        <div className="mt-6 p-4 sm:p-5 rounded-lg bg-slate-900 text-white border border-slate-800">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
              <span className="font-mono text-xs text-sky-300">
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
            <div className="aspect-video w-full max-w-2xl mx-auto rounded-md overflow-hidden bg-black">
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
              <div className="rounded-lg border-2 border-accent/25 bg-surface p-6 sm:p-8">
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
                    className="inline-flex items-center gap-1.5 font-mono text-xs text-accent hover:underline underline-offset-2"
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
                  key={`${currentDueItem.card.id}-${flipped ? 'b' : 'f'}`}
                  style={{ borderTopColor: visualColor(cardIdx), borderTopWidth: 4 }}
                  className="card-flip cursor-pointer relative overflow-hidden rounded-lg border border-rule bg-surface p-6 sm:p-8 min-h-[260px] flex flex-col justify-between hover:border-ink transition-colors"
                >
                  <span
                  aria-hidden="true"
                  className="card-number"
                  data-n={String(cardIdx + 1).padStart(2, '0')}
                  style={{ color: visualColor(cardIdx) }}
                />
                  {!flipped ? (
                    <div>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted mb-3">
                        Question
                      </span>
                      <p dir="auto" className="font-serif text-2xl sm:text-[1.7rem] text-ink leading-snug">
                        {currentDueItem.card.front}
                      </p>
                      {currentDueItem.card.front_translation && (
                        <p
                          dir={
                            currentDueItem.card.bilingual_language?.toLowerCase() === 'arabic'
                              ? 'rtl'
                              : 'auto'
                          }
                          className="mt-3 p-3 rounded-md bg-slate-50 border border-slate-200 text-base text-slate-800"
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
                      <p dir="auto" className="text-lg sm:text-xl text-ink leading-relaxed">
                        {currentDueItem.card.back}
                      </p>
                      {currentDueItem.card.back_translation && (
                        <p
                          dir={
                            currentDueItem.card.bilingual_language?.toLowerCase() === 'arabic'
                              ? 'rtl'
                              : 'auto'
                          }
                          className="mt-3 p-3 rounded-md bg-slate-50 border border-slate-200 text-base text-slate-800"
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
                          className="mt-3 p-3 rounded-md bg-[#F5F3FF] border border-[#502EF0]/25 text-xs text-[#1E1B4B]"
                        >
                          <span className="inline-block px-2 py-0.5 mr-2 rounded bg-[#502EF0] text-white font-bold text-[10px] uppercase">
                            AI explanation
                          </span>
                          <bdi dir="auto">{currentDueItem.card.ai_explanation}</bdi>
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
                      {flipped ? 'Show Question' : 'Flip card'}
                    </span>
                  </div>
                </div>
              </div>

              {/* SM-2 Buttons: Again / Hard / Good / Easy */}
              <div className="mt-4 grid grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleGrade('again')}
                  className="py-3 px-3 rounded-md border border-rule bg-surface hover:border-ink text-ink font-semibold text-xs sm:text-sm"
                >
                  Again
                  <span className="block text-[11px] font-normal text-muted">Due today</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGrade('hard')}
                  className="py-3 px-3 rounded-md border border-rule bg-surface hover:border-ink text-ink font-semibold text-xs sm:text-sm"
                >
                  Hard
                  <span className="block text-[11px] font-normal text-muted">Short interval</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGrade('good')}
                  className="py-3 px-3 rounded-md border border-rule bg-surface hover:border-ink text-ink font-semibold text-xs sm:text-sm"
                >
                  Good
                  <span className="block text-[11px] font-normal text-muted">Standard SM-2</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleGrade('easy')}
                  className="py-3 px-3 rounded-md border border-rule bg-surface hover:border-ink text-ink font-semibold text-xs sm:text-sm"
                >
                  Easy
                  <span className="block text-[11px] font-normal text-muted">Bonus interval</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-lg mx-auto text-center p-8 rounded-lg bg-surface border border-rule">
              <h3 className="text-xl font-semibold text-ink">You finished today’s queue.</h3>
              <p className="mt-1.5 text-sm text-muted">
                Your streak is now {meta.streakDays} {meta.streakDays === 1 ? 'day' : 'days'}.
              </p>
              <button
                type="button"
                onClick={() => setMode('dashboard')}
                className="mt-5 px-5 py-2.5 rounded-md bg-accent text-white font-bold text-xs sm:text-sm"
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
                <div className="rounded-lg border border-rule bg-surface p-6">
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
                      className="inline-flex items-center gap-1.5 font-mono text-xs text-accent hover:underline underline-offset-2"
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
                          className={`w-full text-left p-3.5 rounded-md border text-sm flex items-start gap-3 ${cls}`}
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
                    <div className="mt-4 p-4 rounded-md bg-slate-50 border border-slate-200 text-xs sm:text-sm">
                      <p className="font-bold text-ink">
                        {chosen === q.correct_index
                          ? 'Correct'
                          : `Incorrect. Answer is ${String.fromCharCode(65 + q.correct_index)}`}
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
                        className="px-4 py-2 rounded-md bg-accent text-white text-xs font-bold"
                      >
                        Next Question →
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          trackEvent('quiz_finished', '/study');
                          setQuizDone(true);
                        }}
                        className="px-5 py-2 rounded-md bg-accent text-white text-xs font-bold"
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
                <div className="rounded-lg border border-rule bg-surface p-6 text-center">
                  <h3 className="text-2xl font-semibold text-ink">
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
                        className="px-5 py-2.5 rounded-md bg-accent text-white font-bold text-xs sm:text-sm"
                      >
                        Review what you missed ({wrongQs.length} cards) →
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMode('dashboard')}
                      className="px-4 py-2.5 rounded-md border border-rule font-bold text-xs sm:text-sm"
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
            <div className="rounded-lg border border-rule bg-surface p-10 text-center max-w-xl mx-auto">
              <h2 className="text-xl font-medium text-ink">No revision packs saved yet</h2>
              <p className="mt-2 text-sm text-muted">
                Paste a YouTube lecture link or upload a recording, then click{' '}
                <strong>Make my revision pack</strong> to build your first deck.
              </p>
              <Link
                to="/youtube"
                className="mt-5 inline-flex items-center gap-2 px-6 py-3 rounded-md font-bold text-sm text-white bg-accent"
              >
                Create my first revision pack
              </Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              {decks.map((deck) => {
                const stats = getDeckDueStats(deck);
                return (
                  <div
                    key={deck.id}
                    className="rounded-lg border border-rule bg-surface p-5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
                        <span className="uppercase tracking-[0.12em] text-[11px]">{deck.provider.replace('_', ' ')}</span>
                        <span>
                          {stats.dueTodayCount} due today · {stats.totalCards} cards
                        </span>
                      </div>

                      <h3 dir="auto" className="mt-2 font-serif text-2xl text-ink leading-snug">
                        {deck.title}
                      </h3>

                      {/* Progress bar per deck */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted mb-1">
                          <span>Reviewed and scheduled</span>
                          <span className="tabular-nums text-ink">
                            {stats.progressPercent}%
                          </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-ink"
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
                          className="px-3.5 py-2 rounded-md bg-ink text-white text-sm font-semibold hover:bg-ink/90"
                        >
                          Study cards ({stats.dueTodayCount || stats.totalCards})
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
                            className="px-3.5 py-2 rounded-md border border-rule bg-surface text-sm font-semibold text-ink hover:border-ink"
                          >
                            Quiz ({deck.pack.quiz.length})
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            trackEvent('export_clicked', '/study');
                            exportRevisionPackPdf(deck.pack);
                          }}
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
        <div className="fixed inset-0 z-50 bg-black/50  flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="sync-title" className="w-full max-w-md rounded-lg bg-surface border border-rule p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 id="sync-title" className="text-lg font-semibold text-ink">Sign in & sync decks</h3>
              <button
                type="button"
                onClick={() => {
                  setSyncModalOpen(false);
                  setSyncStatus(null);
                }}
                aria-label="Close"
                className="text-muted hover:text-ink text-sm"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-xs sm:text-sm text-muted leading-relaxed">
              On the free plan, your decks stay on this browser. With an Exam Pass, Monthly, or Semester Pass, sign in with an email magic link (no password needed) to sync your decks and streak across all your devices.
            </p>

            <form onSubmit={handleRequestMagicLink} className="mt-4 space-y-3">
              <label htmlFor="sync-email" className="sr-only">Email address</label>
              <input
                id="sync-email"
                type="email"
                required
                autoFocus
                value={syncEmail}
                onChange={(e) => setSyncEmail(e.target.value)}
                placeholder="you@university.edu"
                className="w-full px-3.5 py-2.5 rounded-md border border-rule text-sm text-ink focus:outline-none focus:border-accent"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={syncSubmitting}
                  className="flex-1 py-2.5 px-4 rounded-md font-bold text-xs sm:text-sm text-white bg-accent"
                >
                  {syncSubmitting ? 'Sending magic link…' : 'Send Email Magic Link'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSyncModalOpen(false);
                    navigate('/pricing');
                  }}
                  className="py-2.5 px-4 rounded-md border border-rule font-bold text-xs sm:text-sm text-ink hover:bg-slate-50"
                >
                  View Plans
                </button>
              </div>
            </form>

            {devLoginUrl && (
              <p className="mt-2 text-xs text-muted">
                Development mode (no email provider configured):{' '}
                <a href={devLoginUrl} className="text-accent underline font-semibold">open sign-in link</a>
              </p>
            )}
            {syncStatus && (
              <p className="mt-3 p-3 rounded-md bg-accent-soft text-accent text-xs font-semibold">
                {syncStatus}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
