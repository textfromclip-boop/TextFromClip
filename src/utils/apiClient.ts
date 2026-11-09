// Fetch wrapper for cost-bearing API routes.
// When the server answers 403 TURNSTILE_REQUIRED (only when TURNSTILE_SECRET_KEY is configured),
// we run an invisible Cloudflare Turnstile challenge and retry once with the token. A successful
// check sets a 24h httpOnly cookie, so this normally happens once per day per browser.

const TURNSTILE_SITE_KEY: string | undefined = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY;
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<any> | null = null;

function loadTurnstile(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const w = window as any;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TURNSTILE_SCRIPT;
      s.async = true;
      s.defer = true;
      s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('Turnstile failed to load')));
      s.onerror = () => reject(new Error('Turnstile failed to load'));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export async function getTurnstileToken(): Promise<string> {
  if (!TURNSTILE_SITE_KEY) throw new Error('Security check is not configured.');
  const turnstile = await loadTurnstile();
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.bottom = '16px';
  host.style.right = '16px';
  host.style.zIndex = '60';
  document.body.appendChild(host);
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Security check timed out. Please try again.')), 60000);
      turnstile.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only',
        callback: (token: string) => {
          window.clearTimeout(timer);
          resolve(token);
        },
        'error-callback': () => {
          window.clearTimeout(timer);
          reject(new Error('Security check failed. Please refresh and try again.'));
        },
      });
    });
  } finally {
    host.remove();
  }
}

/** fetch() that transparently completes a Turnstile challenge when the server asks for one. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 403 || !TURNSTILE_SITE_KEY) return res;
  let code: string | undefined;
  try {
    code = ((await res.clone().json()) as any)?.error?.code;
  } catch {
    return res;
  }
  if (code !== 'TURNSTILE_REQUIRED') return res;
  const token = await getTurnstileToken();
  const headers = new Headers(init.headers || {});
  headers.set('X-Turnstile-Token', token);
  return fetch(input, { ...init, headers });
}

// ---------------------------------------------------------------------------------------------
// Referral capture: ?ref=CODE is remembered until the visitor's first revision pack is created.
// ---------------------------------------------------------------------------------------------
const REF_KEY = 'learnfromclip_pending_referral';

export function captureReferralFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && /^LFC[A-Z0-9]{4,12}$/i.test(ref)) {
      localStorage.setItem(REF_KEY, ref.toUpperCase());
      params.delete('ref');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    }
  } catch {
    // ignore storage errors
  }
}

export function getPendingReferral(): string | undefined {
  try {
    return localStorage.getItem(REF_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function clearPendingReferral(): void {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    // ignore
  }
}
