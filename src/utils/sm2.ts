import { Flashcard } from '../types';

export type Sm2Rating = 'again' | 'hard' | 'good' | 'easy';

export function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(utcDateStr: string, days: number): string {
  const base = new Date(`${utcDateStr}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + days);
    return getUtcDateString(fallback);
  }
  base.setUTCDate(base.getUTCDate() + Math.max(0, Math.round(days)));
  return getUtcDateString(base);
}

/**
 * Standard SM-2 Spaced Repetition algorithm adapted for 4 buttons:
 * - 'again': resets reps to 0, interval = 0 (due today), ease -= 0.2 (min 1.3)
 * - 'hard':  interval = max(1, round(interval * 1.2)), ease -= 0.15 (min 1.3), reps += 1
 * - 'good':  if reps == 0 -> 1d; if reps == 1 -> 3d; else round(interval * ease); reps += 1
 * - 'easy':  if reps == 0 -> 4d; if reps == 1 -> 7d; else round(interval * ease * 1.3); ease += 0.15; reps += 1
 */
export function scheduleFlashcardSm2(
  card: Flashcard,
  rating: Sm2Rating,
  todayUtc: string = getUtcDateString()
): Flashcard {
  const prevReps = Math.max(0, Number(card.reps) || 0);
  const prevInterval = Math.max(0, Number(card.interval) || 0);
  const prevEase = Math.max(1.3, Number(card.ease) || 2.5);

  let reps = prevReps;
  let interval = prevInterval;
  let ease = prevEase;

  if (rating === 'again') {
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, Number((prevEase - 0.2).toFixed(2)));
  } else if (rating === 'hard') {
    reps = prevReps + 1;
    interval = prevInterval === 0 ? 1 : Math.max(1, Math.round(prevInterval * 1.2));
    ease = Math.max(1.3, Number((prevEase - 0.15).toFixed(2)));
  } else if (rating === 'good') {
    reps = prevReps + 1;
    if (prevReps === 0) {
      interval = 1;
    } else if (prevReps === 1) {
      interval = 3;
    } else {
      interval = Math.max(1, Math.round(prevInterval * prevEase));
    }
  } else if (rating === 'easy') {
    reps = prevReps + 1;
    if (prevReps === 0) {
      interval = 4;
    } else if (prevReps === 1) {
      interval = 7;
    } else {
      interval = Math.max(1, Math.round(prevInterval * prevEase * 1.3));
    }
    ease = Number((prevEase + 0.15).toFixed(2));
  }

  const dueDate = addUtcDays(todayUtc, interval);

  return {
    ...card,
    due_date: dueDate,
    interval,
    ease,
    reps,
  };
}

/**
 * Checks whether a card is due on or before `todayUtc` ('YYYY-MM-DD').
 */
export function isCardDueToday(
  card: Flashcard,
  todayUtc: string = getUtcDateString()
): boolean {
  if (!card.due_date) return true;
  return card.due_date <= todayUtc;
}

/**
 * Updates a student's daily review streak across UTC calendar days.
 * - First study session ever -> streak = 1
 * - Studying again on the same UTC date -> streak unchanged
 * - Studying on the consecutive day (yesterday + 1 day == today) -> streak + 1
 * - Studying after missing 1 or more days -> resets to 1
 */
export function updateDailyStreak(
  currentStreak: number,
  lastStudyUtcDate: string | null | undefined,
  todayUtc: string = getUtcDateString()
): { streakDays: number; lastStudyUtcDate: string } {
  if (!lastStudyUtcDate) {
    return { streakDays: 1, lastStudyUtcDate: todayUtc };
  }

  if (lastStudyUtcDate === todayUtc) {
    return { streakDays: Math.max(1, currentStreak || 1), lastStudyUtcDate: todayUtc };
  }

  const nextDayAfterLast = addUtcDays(lastStudyUtcDate, 1);
  if (nextDayAfterLast === todayUtc) {
    return {
      streakDays: Math.max(1, currentStreak || 0) + 1,
      lastStudyUtcDate: todayUtc,
    };
  }

  return { streakDays: 1, lastStudyUtcDate: todayUtc };
}
