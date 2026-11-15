// Single source of truth for plans, prices and limits.
// Imported by the server (enforcement, checkout), the pricing page, and SEO/FAQ copy, so a price
// or limit can only ever be changed in one place. No payment-provider specifics live here.
//
// Why these numbers (measured 2026-11, Cloudflare Workers AI list prices via the account API):
//   gpt-oss-120b: $0.35 / M input tokens, $0.75 / M output tokens; Whisper turbo: $0.000513 / audio min.
//   One revision pack costs about $0.01-0.03 on the free plan (30 cards) and $0.02-0.05 on a paid
//   plan (150 cards, up to 4 h). AI cost is therefore a few percent of the price for a normal
//   student; what hurts margin is (a) the payment fee's fixed part on very small prices and
//   (b) unbounded "100 actions a day" allowances that one shared or abused account could burn.
//   So: fewer, higher price points, and paid AI limits sized to heavy real use, not to "unlimited".

export type PaidPlan = 'exam_pass' | 'prep_pass' | 'monthly';
export type PlanTier = 'free' | PaidPlan;

export interface PlanDefinition {
  id: PaidPlan;
  name: string;
  priceUsd: number;
  /** Price for billing addresses in REGIONAL_PRICING_COUNTRIES (about half). */
  regionalPriceUsd: number;
  /** Access length for one-time passes; billing period for the subscription. */
  durationDays: number;
  /** Short unit shown after the price, e.g. "7 days". */
  per: string;
  autoRenew: boolean;
  billingNote: string;
  blurb: string;
  cta: string;
  featured?: boolean;
}

export const PLANS: Record<PaidPlan, PlanDefinition> = {
  exam_pass: {
    id: 'exam_pass',
    name: 'Exam Week Pass',
    priceUsd: 4.99,
    regionalPriceUsd: 2.49,
    durationDays: 7,
    per: '7 days',
    autoRenew: false,
    billingNote: 'One-time payment. Never renews.',
    blurb: 'For the week before an exam.',
    cta: 'Get the Exam Week Pass',
  },
  prep_pass: {
    id: 'prep_pass',
    name: 'Exam Prep Pass',
    priceUsd: 29,
    regionalPriceUsd: 14.5,
    durationDays: 90,
    per: '3 months',
    autoRenew: false,
    billingNote: 'One-time payment. Never renews.',
    blurb: 'A full term or a professional exam, paid once.',
    cta: 'Get the Exam Prep Pass',
    featured: true,
  },
  monthly: {
    id: 'monthly',
    name: 'Monthly',
    priceUsd: 11.99,
    regionalPriceUsd: 5.99,
    durationDays: 31,
    per: 'month',
    autoRenew: true,
    billingNote: 'Subscription. Cancel anytime.',
    blurb: 'Month to month, for ongoing classes.',
    cta: 'Start Monthly',
  },
};

/** Display order on the pricing page. */
export const PLAN_ORDER: PaidPlan[] = ['exam_pass', 'prep_pass', 'monthly'];

export const PAID_PLAN_IDS: PaidPlan[] = ['exam_pass', 'prep_pass', 'monthly'];

export function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === 'string' && (PAID_PLAN_IDS as string[]).includes(value);
}

/** Maps stored plan names from before the 2026-11 pricing change to the current ids. */
export function normalizePlanTier(value: unknown): PlanTier {
  if (value === 'semester_pass') return 'prep_pass';
  return isPaidPlan(value) ? value : 'free';
}

export function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export const FREE_LIMITS = {
  linksPerDay: 5,
  uploadSecondsPerDay: 20 * 60, // 20 minutes of audio per day
  aiActionsPerDay: 3, // 6 half-units
  cardsPerPack: 30,
  mockExamsPerDay: 1,
  maxLectureSeconds: 2 * 3600, // 2 hours
};

export const PAID_LIMITS = {
  linksPerDay: 50,
  examPassUploadSeconds: 10 * 3600, // 10 hours per rolling 7 days
  monthlyUploadSeconds: 30 * 3600, // 30 hours per rolling 30 days
  /**
   * 20 AI actions a day covers an exam-week burst (one pack = one action). The rolling period
   * caps bound what a shared or abused account can cost. 120 a month is twice a heavy legitimate
   * load (5 courses x 3 lectures a week = 60 packs). AI spend per plan at these caps:
   *   typical pack ($0.022): about 30% of what the plan earns after fees;
   *   absolute worst case (every action a 4-hour, 150-card pack at $0.05): 55-70%, never a loss.
   */
  aiActionsPerDay: 20,
  examPassAiActionsPerWeek: 60, // rolling 7 days
  aiActionsPerMonth: 120, // rolling 30 days (Exam Prep Pass and Monthly)
  cardsPerPack: 150,
  mockExamsPerDay: 9999, // Unlimited
  maxLectureSeconds: 4 * 3600, // 4 hours
};

/** The rolling AI-action cap for a paid plan. */
export function paidAiPeriod(plan: PlanTier): { days: number; limit: number } | null {
  if (plan === 'free') return null;
  if (plan === 'exam_pass') return { days: 7, limit: PAID_LIMITS.examPassAiActionsPerWeek };
  return { days: 30, limit: PAID_LIMITS.aiActionsPerMonth };
}

/** Rows for the Free vs paid comparison table (pricing page), generated from the limits above. */
export function comparisonRows(): [string, string, string][] {
  const hours = (s: number) => `${s / 3600} hours`;
  return [
    ['Lecture links', `${FREE_LIMITS.linksPerDay} per day`, `${PAID_LIMITS.linksPerDay} per day`],
    [
      'Audio and video uploads',
      `${FREE_LIMITS.uploadSecondsPerDay / 60} minutes per day`,
      `${PAID_LIMITS.examPassUploadSeconds / 3600} h per week (Exam Week) · ${PAID_LIMITS.monthlyUploadSeconds / 3600} h per month`,
    ],
    [
      'AI actions (packs, translations, formats)',
      `${FREE_LIMITS.aiActionsPerDay} per day`,
      `${PAID_LIMITS.aiActionsPerDay} per day, up to ${PAID_LIMITS.examPassAiActionsPerWeek} per week (Exam Week) · ${PAID_LIMITS.aiActionsPerMonth} per month`,
    ],
    ['Flashcards per pack', String(FREE_LIMITS.cardsPerPack), String(PAID_LIMITS.cardsPerPack)],
    ['Quizzes', `${FREE_LIMITS.mockExamsPerDay} per day`, 'With every pack'],
    ['Longest lecture', hours(FREE_LIMITS.maxLectureSeconds), hours(PAID_LIMITS.maxLectureSeconds)],
    ['Where your decks live', 'On this device', 'Synced across devices'],
    ['PDF, Anki and Markdown export', 'Included', 'Included'],
  ];
}
