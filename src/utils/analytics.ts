// Privacy-friendly analytics tracker (no PII, compatible with Plausible / PostHog / LearnFromClip Edge Telemetry)

export const VALID_ANALYTICS_EVENTS = [
  'link_submitted',
  'transcript_done',
  'pack_started',
  'pack_done',
  'card_reviewed',
  'quiz_finished',
  'export_clicked',
  'limit_hit',
  'pricing_viewed',
  'checkout_started',
  'purchase',
  'referral_sent',
  'day7_return',
] as const;

export type AnalyticsEventName = (typeof VALID_ANALYTICS_EVENTS)[number];

const FIRST_VISIT_KEY = 'learnfromclip_first_visit_utc';
const DAY7_LOGGED_KEY = 'learnfromclip_day7_logged';

export function isValidAnalyticsEvent(name: string): name is AnalyticsEventName {
  return (VALID_ANALYTICS_EVENTS as readonly string[]).includes(name);
}

export function trackEvent(
  eventName: AnalyticsEventName,
  routePath?: string
): void {
  if (typeof window === 'undefined') return;

  try {
    // Forward to Plausible if loaded on page
    const win = window as any;
    if (typeof win.plausible === 'function') {
      win.plausible(eventName);
    }

    // Send non-blocking beacon to /api/events (strictly no personal data)
    const payload = JSON.stringify({
      event: eventName,
      path: routePath || window.location.pathname,
    });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/events', blob);
    } else if (typeof fetch === 'function') {
      fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // never block UI on analytics
  }
}

export function checkAndTrackDay7Return(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const nowMs = Date.now();
    const firstVisitRaw = localStorage.getItem(FIRST_VISIT_KEY);
    if (!firstVisitRaw) {
      localStorage.setItem(FIRST_VISIT_KEY, String(nowMs));
      return;
    }
    const alreadyLogged = localStorage.getItem(DAY7_LOGGED_KEY);
    if (alreadyLogged) return;

    const firstMs = Number(firstVisitRaw);
    const daysElapsed = (nowMs - firstMs) / (1000 * 60 * 60 * 24);
    if (daysElapsed >= 7) {
      localStorage.setItem(DAY7_LOGGED_KEY, '1');
      trackEvent('day7_return');
    }
  } catch {
    // ignore
  }
}
