// Site-wide daily AI spending cap.
//
// Per-student and per-IP limits bound what ONE visitor can cost, but not the total: 10,000 students
// x 3 actions is still 30,000 AI calls. This cap bounds the total. When today's estimated AI spend
// reaches the budget, new AI work (packs, formats, translations, audio transcription) pauses until
// 00:00 UTC. Cached transcripts and packs, YouTube captions, study mode and exports keep working.
//
// Default budget = Cloudflare's free Workers AI allocation (10,000 neurons/day = $0.11 at
// $0.011 per 1,000 neurons), minus a margin for estimation error and requests already running.
// So on the Workers Paid plan the AI bill stays at $0 unless AI_DAILY_BUDGET_USD is raised.
import { getDailyCostReport } from './quotasAndCache';

export const CLOUDFLARE_FREE_AI_USD_PER_DAY = 0.11;
export const DEFAULT_AI_DAILY_BUDGET_USD = 0.09;

export function resolveAiDailyBudgetUsd(env: { AI_DAILY_BUDGET_USD?: string } | undefined): number {
  const raw = env?.AI_DAILY_BUDGET_USD;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_AI_DAILY_BUDGET_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_AI_DAILY_BUDGET_USD;
  return n;
}

export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, Math.ceil((next - now.getTime()) / 1000));
}

export interface AiBudgetStatus {
  ok: boolean;
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  resetsInSeconds: number;
}

export async function getAiBudgetStatus(env: any, db?: D1Database): Promise<AiBudgetStatus> {
  const budgetUsd = resolveAiDailyBudgetUsd(env);
  const report = await getDailyCostReport(undefined, db);
  const spentUsd = report.estimatedCostUsd.totalUsd;
  return {
    ok: spentUsd < budgetUsd,
    spentUsd,
    budgetUsd,
    remainingUsd: Math.max(0, Number((budgetUsd - spentUsd).toFixed(4))),
    resetsInSeconds: secondsUntilUtcMidnight(),
  };
}

export function aiBusyMessage(resetsInSeconds: number): string {
  const hours = Math.floor(resetsInSeconds / 3600);
  const minutes = Math.max(1, Math.ceil((resetsInSeconds % 3600) / 60));
  const when = hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
  return `So many students used LearnFromClip today that the free AI is used up. It comes back in ${when} (00:00 UTC). Transcripts, packs you already made, study mode and exports still work.`;
}
