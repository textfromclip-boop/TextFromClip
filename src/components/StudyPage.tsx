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
  onStudyStoreChanged,
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
import { PAYMENTS_ENABLED } from '../shared/launch';
import { FlashcardReviewer } from './study/FlashcardReviewer';
import { QuizRunner } from './study/QuizRunner';
import { QuizQuestion } from '../types';
import {
  fetchAuthSession,
  GoogleGLogo,
  GoogleSignInModal,
  onAuthChanged,
} from './GoogleSignInModal';

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
  const [sessionReviewed, setSessionReviewed] = useState(0);

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

  // "Continue with Google" modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  const refreshStore = async (showSpinner: boolean = false) => {
    if (showSpinner) setLoading(true);
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

  useEffect(() => {
    refreshStore(true);
    const checkAccountAndSync = async () => {
      const session = await fetchAuthSession();
      if (session) {
        setAccount({
          signedIn: session.signedIn,
          email: session.email,
          cloudSync: session.cloudSync,
        });
        if (session.cloudSync && (await syncDecksWithCloud())) {
          await refreshStore(false);
        }
      }
    };
    const handleBackgroundRefresh = () => {
      void refreshStore(false);
    };
    checkAccountAndSync();
    const unsubAuth = onAuthChanged(checkAccountAndSync);
    const unsubStore = onStudyStoreChanged(handleBackgroundRefresh);
    window.addEventListener('focus', handleBackgroundRefresh);
    return () => {
      unsubAuth();
      unsubStore();
      window.removeEventListener('focus', handleBackgroundRefresh);
    };
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
    setSessionReviewed((n) => n + 1);
    if (cardIdx + 1 < dueQueue.length) {
      setCardIdx(cardIdx);
    } else {
      setCardIdx(0);
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
                  setSessionReviewed(0);
                  setMode('review');
                }}
                className="px-4 py-2.5 rounded-md font-semibold text-sm text-white bg-accent hover:bg-accent-dark transition-colors"
              >
                Review {totalDueToday} due today
              </button>
            )}
            {/* Cloud sync is a paid feature; hidden during the free launch. */}
            {(PAYMENTS_ENABLED || account?.cloudSync) && (!account?.signedIn ? (
              <button
                type="button"
                onClick={() => setSyncModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md font-semibold text-sm text-ink border border-rule bg-surface hover:border-ink transition-colors"
              >
                <GoogleGLogo className="w-4 h-4" />
                <span>Continue with Google · Sync decks</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  if (account?.cloudSync && (await syncDecksWithCloud())) {
                    await refreshStore();
                  } else if (!account?.cloudSync) {
                    navigate('/pricing');
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md font-semibold text-sm text-ink border border-rule bg-surface hover:border-ink transition-colors"
              >
                <GoogleGLogo className="w-4 h-4" />
                <span>{account.cloudSync ? 'Sync decks now' : 'Upgrade for cloud sync'}</span>
              </button>
            ))}
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
            <FlashcardReviewer
              card={currentDueItem.card}
              position={sessionReviewed + 1}
              total={sessionReviewed + dueQueue.length}
              accent={visualColor(cardIdx + sessionReviewed)}
              deckLabel={activeDeckId === 'all' ? currentDueItem.deck.title : undefined}
              rtl={currentDueItem.card.bilingual_language?.toLowerCase() === 'arabic'}
              onGrade={handleGrade}
              onSeek={(seconds, quote) =>
                setSeekInfo({
                  provider: currentDueItem.deck.provider,
                  videoId: currentDueItem.deck.videoId,
                  seconds,
                  quote,
                  sourceUrl: currentDueItem.deck.sourceUrl,
                })
              }
            />
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

          <QuizRunner
            key={`${selectedDeck.id}-${quizIdx}`}
            questions={selectedDeck.pack.quiz}
            trackPath="/study"
            onSeek={(seconds, quote) =>
              setSeekInfo({
                provider: selectedDeck.provider,
                videoId: selectedDeck.videoId,
                seconds,
                quote,
                sourceUrl: selectedDeck.sourceUrl,
              })
            }
            onReviewMissed={async (missed: QuizQuestion[]) => {
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
              const newDeck = await createMissedQuestionsDeck(selectedDeck.title, missedCards, selectedDeck.provider, selectedDeck.videoId);
              await refreshStore();
              setActiveDeckId(newDeck.id);
              setCardIdx(0);
              setSessionReviewed(0);
              setFlipped(false);
              setSessionReviewed(0);
                  setMode('review');
            }}
          />
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
                            setSessionReviewed(0);
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

      {/* "Continue with Google" Sign-In & Cloud Sync Modal */}
      <GoogleSignInModal
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        title="Welcome to LearnFromClip"
        subtitle="Sign in with Google to sync your study decks and streaks across your devices."
        onSuccess={async (session) => {
          setAccount({
            signedIn: session.signedIn,
            email: session.email,
            cloudSync: session.cloudSync,
          });
          if (session.cloudSync && (await syncDecksWithCloud())) {
            await refreshStore();
          }
        }}
      />
    </div>
  );
};
