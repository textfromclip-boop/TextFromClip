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

let firstPageViewSent = false;

function isSameSiteReferrer(): boolean {
  try {
    return Boolean(document.referrer) && new URL(document.referrer).host === window.location.host;
  } catch {
    return false;
  }
}

/**
 * Cookieless page-view beacon for the private admin dashboard. Sends only the page path, the
 * referring site on the first page of a visit, and a utm_source if present. The server adds the
 * country from Cloudflare and stores no IP address.
 */
export function trackPageView(path: string): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const payload = JSON.stringify({
      path,
      // A visit = arriving from outside the site (Cloudflare's definition): the first page of this
      // page load, unless the browser came from another page of this same site.
      entry: !firstPageViewSent && !isSameSiteReferrer(),
      referrer: firstPageViewSent ? undefined : document.referrer || undefined,
      utm: firstPageViewSent ? undefined : params.get('utm_source') || undefined,
    });
    firstPageViewSent = true;
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/pv', new Blob([payload], { type: 'application/json' }));
    } else if (typeof fetch === 'function') {
      fetch('/api/pv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch {
    // never block UI on analytics
  }
}

let vitalsStarted = false;

/**
 * Real-user speed of the page load (Core Web Vitals), sent once when the page is hidden or closed:
 * LCP (largest content shown), INP (slowest response to a tap or key), CLS (layout shift),
 * TTFB (server response) and full load time. Numbers only; no identifiers.
 */
export function startWebVitals(): void {
  if (vitalsStarted || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  vitalsStarted = true;
  const path = window.location.pathname;
  let lcp: number | undefined;
  let inp: number | undefined;
  let cls = 0;
  let sessionValue = 0;
  let sessionEntries: any[] = [];
  const observe = (type: string, cb: (entries: any[]) => void, opts: Record<string, unknown> = {}) => {
    try {
      const po = new PerformanceObserver((list) => cb(list.getEntries() as any[]));
      po.observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
    } catch {
      // metric not supported by this browser
    }
  };
  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1];
    if (last) lcp = last.startTime;
  });
  observe('layout-shift', (entries) => {
    for (const e of entries) {
      if (e.hadRecentInput) continue;
      const firstE = sessionEntries[0];
      const lastE = sessionEntries[sessionEntries.length - 1];
      if (sessionEntries.length && (e.startTime - lastE.startTime > 1000 || e.startTime - firstE.startTime > 5000)) {
        sessionValue = 0;
        sessionEntries = [];
      }
      sessionValue += e.value;
      sessionEntries.push(e);
      cls = Math.max(cls, sessionValue);
    }
  });
  observe('event', (entries) => {
    for (const e of entries) {
      if (e.interactionId && (inp === undefined || e.duration > inp)) inp = e.duration;
    }
  }, { durationThreshold: 40 });
  observe('first-input', (entries) => {
    const e = entries[0];
    if (e && inp === undefined) inp = e.processingEnd - e.startTime;
  });

  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const payload = JSON.stringify({
        path,
        lcp,
        inp,
        cls: Math.round(cls * 1000) / 1000,
        ttfb: nav ? Math.max(0, nav.responseStart) : undefined,
        load: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : undefined,
      });
      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/vitals', new Blob([payload], { type: 'application/json' }));
      }
    } catch {
      // never block UI on analytics
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
  });
  window.addEventListener('pagehide', send);
}
