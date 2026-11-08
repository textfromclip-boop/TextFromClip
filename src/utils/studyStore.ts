import { Flashcard, RevisionPack } from '../types';
import {
  getUtcDateString,
  isCardDueToday,
  scheduleFlashcardSm2,
  Sm2Rating,
  updateDailyStreak,
} from './sm2';

export interface StoredStudyDeck {
  id: string;
  title: string;
  provider: string;
  videoId: string;
  sourceUrl?: string;
  pack: RevisionPack;
  createdAt: number;
  updatedAt: number;
  syncedToCloud?: boolean;
}

export interface StudyMetaState {
  streakDays: number;
  lastStudyUtcDate: string | null;
  totalReviewsCount: number;
  syncedUserEmail?: string | null;
}

const DB_NAME = 'learnfromclip_study_db';
const DB_VERSION = 1;
const STORE_DECKS = 'decks';
const STORE_META = 'study_meta';
const FALLBACK_DECKS_KEY = 'learnfromclip_decks_fallback_v1';
const FALLBACK_META_KEY = 'learnfromclip_meta_fallback_v1';

// In-memory store fallback when running in Node/Vitest without browser IndexedDB
const memoryDecks = new Map<string, StoredStudyDeck>();
let memoryMeta: StudyMetaState = {
  streakDays: 0,
  lastStudyUtcDate: null,
  totalReviewsCount: 0,
  syncedUserEmail: null,
};

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openStudyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DECKS)) {
        db.createObjectStore(STORE_DECKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAllStudyDecks(): Promise<StoredStudyDeck[]> {
  if (hasIndexedDb()) {
    try {
      const db = await openStudyDb();
      return await new Promise<StoredStudyDeck[]>((resolve, reject) => {
        const tx = db.transaction(STORE_DECKS, 'readonly');
        const store = tx.objectStore(STORE_DECKS);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = Array.isArray(req.result) ? req.result : [];
          list.sort((a, b) => b.updatedAt - a.updatedAt);
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      // fall through to localStorage / memory fallback
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(FALLBACK_DECKS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(memoryDecks.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveStudyDeck(
  pack: RevisionPack,
  sourceUrl?: string
): Promise<StoredStudyDeck> {
  const existingDecks = await loadAllStudyDecks();
  const existing = existingDecks.find(
    (d) =>
      d.id === pack.id ||
      (d.provider === pack.provider &&
        d.videoId === pack.videoId &&
        d.pack.secondLanguage === pack.secondLanguage)
  );

  const now = Date.now();
  const deck: StoredStudyDeck = {
    id: existing ? existing.id : pack.id,
    title: pack.title,
    provider: pack.provider,
    videoId: pack.videoId,
    sourceUrl: sourceUrl || existing?.sourceUrl,
    pack: {
      ...pack,
      id: existing ? existing.id : pack.id,
    },
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    syncedToCloud: false,
  };

  memoryDecks.set(deck.id, deck);

  if (hasIndexedDb()) {
    try {
      const db = await openStudyDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_DECKS, 'readwrite');
        tx.objectStore(STORE_DECKS).put(deck);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return deck;
    } catch {
      // fall through
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const all = await loadAllStudyDecks();
      const filtered = all.filter((d) => d.id !== deck.id);
      localStorage.setItem(FALLBACK_DECKS_KEY, JSON.stringify([deck, ...filtered]));
    } catch {
      // ignore
    }
  }

  return deck;
}

export async function deleteStudyDeck(deckId: string): Promise<void> {
  memoryDecks.delete(deckId);

  if (hasIndexedDb()) {
    try {
      const db = await openStudyDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_DECKS, 'readwrite');
        tx.objectStore(STORE_DECKS).delete(deckId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // ignore
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const all = await loadAllStudyDecks();
      localStorage.setItem(
        FALLBACK_DECKS_KEY,
        JSON.stringify(all.filter((d) => d.id !== deckId))
      );
    } catch {
      // ignore
    }
  }
}

export async function loadStudyMeta(): Promise<StudyMetaState> {
  if (hasIndexedDb()) {
    try {
      const db = await openStudyDb();
      const res = await new Promise<StudyMetaState | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const req = tx.objectStore(STORE_META).get('singleton');
        req.onsuccess = () => resolve(req.result?.value);
        req.onerror = () => reject(req.error);
      });
      if (res) return res;
    } catch {
      // fall through
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(FALLBACK_META_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
  }

  return { ...memoryMeta };
}

export async function saveStudyMeta(meta: StudyMetaState): Promise<StudyMetaState> {
  memoryMeta = { ...meta };

  if (hasIndexedDb()) {
    try {
      const db = await openStudyDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite');
        tx.objectStore(STORE_META).put({ key: 'singleton', value: meta });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return meta;
    } catch {
      // fall through
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(FALLBACK_META_KEY, JSON.stringify(meta));
    } catch {
      // ignore
    }
  }

  return meta;
}

/**
 * Records a flashcard review using SM-2, updates the deck in IndexedDB,
 * and increments the student's daily streak.
 */
export async function recordCardReviewInStore(
  deckId: string,
  cardId: string,
  rating: Sm2Rating,
  todayUtc: string = getUtcDateString()
): Promise<{
  updatedDeck: StoredStudyDeck | null;
  updatedCard: Flashcard | null;
  meta: StudyMetaState;
}> {
  const decks = await loadAllStudyDecks();
  const targetDeck = decks.find((d) => d.id === deckId);
  let updatedCard: Flashcard | null = null;
  let updatedDeck: StoredStudyDeck | null = null;

  if (targetDeck) {
    const nextCards = targetDeck.pack.flashcards.map((c) => {
      if (c.id === cardId) {
        updatedCard = scheduleFlashcardSm2(c, rating, todayUtc);
        return updatedCard;
      }
      return c;
    });

    updatedDeck = await saveStudyDeck(
      {
        ...targetDeck.pack,
        flashcards: nextCards,
      },
      targetDeck.sourceUrl
    );
  }

  const currentMeta = await loadStudyMeta();
  const streakUpdate = updateDailyStreak(
    currentMeta.streakDays,
    currentMeta.lastStudyUtcDate,
    todayUtc
  );

  const nextMeta = await saveStudyMeta({
    ...currentMeta,
    streakDays: streakUpdate.streakDays,
    lastStudyUtcDate: streakUpdate.lastStudyUtcDate,
    totalReviewsCount: (currentMeta.totalReviewsCount || 0) + 1,
  });

  return { updatedDeck, updatedCard, meta: nextMeta };
}

/**
 * Builds a dedicated deck from quiz questions the student missed.
 */
export async function createMissedQuestionsDeck(
  parentTitle: string,
  missedCards: Flashcard[],
  provider: string = 'youtube',
  videoId: string = 'missed'
): Promise<StoredStudyDeck> {
  const pack: RevisionPack = {
    id: `missed-pack-${Date.now()}`,
    title: `${parentTitle} — Missed Quiz Review`,
    provider,
    videoId,
    durationSeconds: 0,
    notes: [],
    flashcards: missedCards,
    quiz: [],
    metadata: {
      totalChunks: 1,
      verifiedItemsCount: missedCards.length,
      droppedQuotesCount: 0,
      generatedAt: Date.now(),
      modelUsed: 'missed_quiz_builder',
    },
  };
  return saveStudyDeck(pack);
}

/**
 * Computes summary statistics for the `/study` "Today" screen.
 */
export function getDeckDueStats(
  deck: StoredStudyDeck,
  todayUtc: string = getUtcDateString()
): {
  totalCards: number;
  dueTodayCount: number;
  masteredCount: number;
  progressPercent: number;
} {
  const totalCards = deck.pack.flashcards.length;
  if (totalCards === 0) {
    return { totalCards: 0, dueTodayCount: 0, masteredCount: 0, progressPercent: 100 };
  }
  const dueTodayCount = deck.pack.flashcards.filter((c) =>
    isCardDueToday(c, todayUtc)
  ).length;
  const masteredCount = totalCards - dueTodayCount;
  const progressPercent = Math.round((masteredCount / totalCards) * 100);
  return { totalCards, dueTodayCount, masteredCount, progressPercent };
}
