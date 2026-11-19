// Pricing and paid-limit rules (src/shared/plans.ts). The numbers are business decisions; these
// tests guard the relationships between them so a later edit cannot quietly break the economics.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  comparisonRows,
  FREE_LIMITS,
  formatUsd,
  isPaidPlan,
  normalizePlanTier,
  PAID_LIMITS,
  paidAiPeriod,
  PLAN_ORDER,
  PLANS,
} from '../shared/plans';
import {
  consumeQuota,
  getDailyQuotaStatus,
  reserveQuota,
  resetMemoryQuotasAndCacheForTests,
} from '../server/utils/quotasAndCache';
import { getPlanDurationSeconds, readLemonSqueezyConfig } from '../server/utils/paymentsAndAuth';
import { ROUTE_META } from '../seo/routeMeta';

// Measured cost of one paid revision pack at Cloudflare list prices (see plans.ts header).
const WORST_PAID_PACK_USD = 0.05;
// Typical merchant-of-record fee; the gateway is not chosen yet, this is only for the margin guard.
const net = (price: number) => price * 0.95 - 0.5;

beforeEach(() => resetMemoryQuotasAndCacheForTests());

describe('plan catalogue', () => {
  it('has exactly three paid plans with the decided prices and lengths', () => {
    expect(PLAN_ORDER).toEqual(['exam_pass', 'prep_pass', 'monthly']);
    expect(PLANS.exam_pass).toMatchObject({ priceUsd: 4.99, durationDays: 7, autoRenew: false });
    expect(PLANS.prep_pass).toMatchObject({ priceUsd: 29, durationDays: 90, autoRenew: false, featured: true });
    expect(PLANS.monthly).toMatchObject({ priceUsd: 11.99, autoRenew: true });
    expect(getPlanDurationSeconds('prep_pass')).toBe(90 * 86400);
    expect(getPlanDurationSeconds('free')).toBe(0);
  });

  it('the 3-month pass is the best deal, so buyers are steered to it', () => {
    // cheaper than three months of Monthly, and cheaper per day than the weekly pass
    expect(PLANS.prep_pass.priceUsd).toBeLessThan(PLANS.monthly.priceUsd * 3);
    expect(PLANS.prep_pass.priceUsd / 90).toBeLessThan(PLANS.exam_pass.priceUsd / 7);
    // ...but not so cheap that one week costs more than a third of it
    expect(PLANS.exam_pass.priceUsd * 3).toBeLessThan(PLANS.prep_pass.priceUsd);
  });

  it('regional prices are about half and still leave money after fees', () => {
    for (const id of PLAN_ORDER) {
      const p = PLANS[id];
      expect(p.regionalPriceUsd / p.priceUsd).toBeGreaterThan(0.45);
      expect(p.regionalPriceUsd / p.priceUsd).toBeLessThan(0.55);
      expect(net(p.regionalPriceUsd)).toBeGreaterThan(1.5);
    }
  });

  it('old stored plan names still resolve; unknown names are free', () => {
    expect(normalizePlanTier('semester_pass')).toBe('prep_pass');
    expect(normalizePlanTier('exam_pass')).toBe('exam_pass');
    expect(normalizePlanTier('lifetime')).toBe('free');
    expect(isPaidPlan('semester_pass')).toBe(false);
  });

  it('checkout config maps the new plan ids', () => {
    const cfg = readLemonSqueezyConfig({ LEMONSQUEEZY_VARIANT_PREP_PASS: '301', LEMONSQUEEZY_VARIANT_PREP_PASS_REGIONAL: '302' });
    expect(cfg.variants['301']).toEqual({ plan: 'prep_pass', regional: false });
    expect(cfg.variantsByPlan.prep_pass).toEqual({ standard: '301', regional: '302' });
  });

  it('pricing page table and SEO text come from the same numbers', () => {
    const rows = comparisonRows();
    expect(rows.find((r) => r[0].startsWith('AI actions'))![2]).toContain(`${PAID_LIMITS.aiActionsPerDay} per day`);
    expect(rows.find((r) => r[0] === 'Lecture links')![1]).toBe(`${FREE_LIMITS.linksPerDay} per day`);
    // Free launch: the pricing page and its SEO text show no prices (paid-mode text: payments-enabled.test.ts)
    expect(ROUTE_META['/pricing'].description).toMatch(/free during launch/i);
    expect(ROUTE_META['/pricing'].description).not.toMatch(/\$\d/);
    expect(formatUsd(29)).toBe('$29');
    expect(formatUsd(4.99)).toBe('$4.99');
    expect(formatUsd(14.5)).toBe('$14.50');
  });
});

describe('paid AI limits protect the margin', () => {
  it('even the absolute worst-case AI spend per plan stays below what the plan earns (never a loss)', () => {
    const week = paidAiPeriod('exam_pass')!;
    const month = paidAiPeriod('prep_pass')!;
    expect(week.limit * WORST_PAID_PACK_USD).toBeLessThan(net(PLANS.exam_pass.priceUsd) * 0.75);
    // 90-day pass: three rolling 30-day periods
    expect(month.limit * 3 * WORST_PAID_PACK_USD).toBeLessThan(net(PLANS.prep_pass.priceUsd) * 0.75);
    expect(month.limit * WORST_PAID_PACK_USD).toBeLessThan(net(PLANS.monthly.priceUsd) * 0.75);
    // at a typical pack size the AI cost is around a third of revenue or less
    const TYPICAL = 0.022;
    expect(month.limit * 3 * TYPICAL).toBeLessThan(net(PLANS.prep_pass.priceUsd) * 0.35);
    expect(paidAiPeriod('free')).toBeNull();
  });

  it('daily cap: a paid user gets 20 AI actions a day, the 21st is refused', async () => {
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      const r = await reserveQuota({ actorKey: 'user:daily', plan: 'prep_pass', delta: { aiHalfUnits: 2 } });
      if (r.ok) ok++;
    }
    expect(ok).toBe(PAID_LIMITS.aiActionsPerDay);
  });

  it('period cap: Exam Week Pass stops at 60 in 7 days even when each day is under the daily cap', async () => {
    const day = (n: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    // 3 earlier days x 19 actions = 57 used this week
    for (const n of [1, 2, 3]) await consumeQuota({ actorKey: 'user:week', utcDate: day(n), aiHalfUnits: 38 });
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const r = await reserveQuota({ actorKey: 'user:week', plan: 'exam_pass', delta: { aiHalfUnits: 2 } });
      if (r.ok) ok++;
    }
    expect(ok).toBe(3); // 57 + 3 = 60
    const status = await getDailyQuotaStatus({ actorKey: 'user:week', plan: 'exam_pass' });
    expect(status.aiPeriodUsed).toBe(60);
    expect(status.aiPeriodLimit).toBe(60);
    expect(status.aiPeriodReached).toBe(true);
    expect(status.aiActionsLimit - status.aiActionsUsed).toBe(0); // UI shows 0 left
  });

  it('period cap rolls: usage older than the window no longer counts', async () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 40);
    await consumeQuota({ actorKey: 'user:roll', utcDate: d.toISOString().slice(0, 10), aiHalfUnits: 300 });
    const r = await reserveQuota({ actorKey: 'user:roll', plan: 'monthly', delta: { aiHalfUnits: 2 } });
    expect(r.ok).toBe(true);
    expect(r.status.aiPeriodUsed).toBe(1);
  });

  it('free users are unaffected by paid period caps', async () => {
    const s = await getDailyQuotaStatus({ actorKey: 'anon:free', plan: 'free' });
    expect(s.aiActionsLimit).toBe(3);
    expect(s.aiPeriodLimit).toBeUndefined();
  });
});
