// Launch switches shared by the server and the website.
//
// PAYMENTS_ENABLED = false is "free launch" mode: no payment provider is connected yet, so the
// pricing page, Buy buttons and "upgrade" prompts are hidden and checkout is refused. Every plan,
// price and limit stays defined in src/shared/plans.ts; turning paid plans on later is this one line.
export const PAYMENTS_ENABLED = false;

export const FREE_LAUNCH_BANNER = 'Free during launch. No account, no card.';
