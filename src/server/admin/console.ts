// Private admin dashboard, served by the Worker at a secret address.
//
// - Lives at https://<site>/<ADMIN_PATH> where ADMIN_PATH is a secret (16-64 chars). Any other path,
//   or no ADMIN_PATH configured, behaves exactly like an unknown page (the normal website), so the
//   console cannot be discovered by guessing and is not part of the website's JavaScript bundle.
// - Sign-in with ADMIN_TOKEN (>= 24 chars). 5 attempts per 15 minutes per IP.
// - Session: HttpOnly, SameSite=Strict cookie scoped to the secret path, signed with COOKIE_SECRET
//   and bound to the current ADMIN_TOKEN (changing the token signs everyone out). 12 hours.
// - Strict CSP (nonce scripts, no external resources), no-store, noindex, no referrer.
import { hmacSha256Hex, randomToken, sha256Hex, timingSafeEqual } from '../utils/crypto';
import { parseCookies } from '../utils/quotasAndCache';
import { checkRateLimit } from '../utils/rate-limiter';
import { getAdminDashboardData, parseFilters } from '../utils/visitAnalytics';
import { renderAdminHtml } from './dashboardPage';

export const ADMIN_PATH_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SESSION_SECONDS = 12 * 3600;
const COOKIE_NAME = 'lfc_admin';

/**
 * "Owner" cookie: set on every browser that signs in to the console, so the owner's own visits are
 * not counted in the analytics. It only switches off counting for that browser; it grants nothing.
 */
export const OWNER_COOKIE = 'lfc_owner';
export async function ownerCookieValue(secret: string): Promise<string> {
  return `1.${(await hmacSha256Hex(secret, 'lfc:owner')).slice(0, 32)}`;
}
export async function isOwnerBrowser(cookieHeader: string | undefined | null, secret: string): Promise<boolean> {
  const v = parseCookies(cookieHeader)[OWNER_COOKIE];
  return Boolean(v) && timingSafeEqual(v, await ownerCookieValue(secret));
}

export interface AdminDeps {
  getClientIp: (c: any) => string;
  getCookieSecret: (c: any) => string;
  isSecureRequest: (c: any) => boolean;
}

export function resolveAdminPath(env: any): string | null {
  const p = typeof env?.ADMIN_PATH === 'string' ? env.ADMIN_PATH.trim() : '';
  return ADMIN_PATH_RE.test(p) ? p : null;
}

function adminToken(env: any): string | null {
  const t = typeof env?.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';
  return t.length >= 24 ? t : null;
}

async function sessionSignature(secret: string, token: string, exp: number): Promise<string> {
  const fp = (await sha256Hex(`adm-token:${token}`)).slice(0, 24);
  return hmacSha256Hex(secret, `lfc:adm:${exp}:${fp}`);
}

export async function createAdminSession(secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = nowSec + SESSION_SECONDS;
  return `${exp}.${await sessionSignature(secret, token, exp)}`;
}

export async function verifyAdminSession(value: string | undefined, secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)) {
  if (!value || typeof value !== 'string') return false;
  const [expStr, sig] = value.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= nowSec || !sig) return false;
  return timingSafeEqual(sig, await sessionSignature(secret, token, exp));
}

function securityHeaders(c: any, nonce?: string) {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Referrer-Policy', 'no-referrer');
  c.header(
    'Content-Security-Policy',
    nonce
      ? `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
      : `default-src 'none'; frame-ancestors 'none'`
  );
}

function sameOrigin(c: any): boolean {
  const origin = c.req.header('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

/**
 * Handles a request if it is for the admin console; returns null otherwise so the caller falls
 * through to the normal website.
 */
export async function handleAdminRequest(c: any, deps: AdminDeps): Promise<Response | null> {
  const adminPath = resolveAdminPath(c.env);
  if (!adminPath) return null;
  const path: string = c.req.path;
  const base = `/${adminPath}`;
  if (path !== base && path !== `${base}/` && !path.startsWith(`${base}/`)) return null;

  const token = adminToken(c.env);
  const secret = deps.getCookieSecret(c);
  const sub = path.slice(base.length).replace(/\/+$/, '') || '/';
  const ip = deps.getClientIp(c);
  const method = c.req.method;
  if (!token) {
    securityHeaders(c);
    return c.text('Admin is not configured: set ADMIN_TOKEN (at least 24 characters).', 503);
  }
  const signedIn = await verifyAdminSession(parseCookies(c.req.header('cookie'))[COOKIE_NAME], secret, token);
  const cookieBase = `Path=${base}; HttpOnly; SameSite=Strict${deps.isSecureRequest(c) ? '; Secure' : ''}`;

  if (sub === '/' && method === 'GET') {
    const nonce = randomToken(16);
    securityHeaders(c, nonce);
    return c.html(renderAdminHtml(nonce, base, signedIn));
  }

  if (sub === '/login' && method === 'POST') {
    securityHeaders(c);
    if (!sameOrigin(c)) return c.json({ ok: false, error: 'Bad request.' }, 403);
    const limit = await checkRateLimit(`admin-login:${ip}`, 5, 900, c.env.DB, true);
    if (!limit.allowed) {
      return c.json({ ok: false, error: `Too many attempts. Try again in ${Math.ceil(limit.resetInSeconds / 60)} minutes.` }, 429);
    }
    const body = await c.req.json().catch(() => ({}));
    const presented = typeof body?.password === 'string' ? body.password : '';
    if (!presented || !timingSafeEqual(presented, token)) {
      return c.json({ ok: false, error: 'Wrong password.' }, 401);
    }
    c.header('Set-Cookie', `${COOKIE_NAME}=${await createAdminSession(secret, token)}; Max-Age=${SESSION_SECONDS}; ${cookieBase}`);
    c.header(
      'Set-Cookie',
      `${OWNER_COOKIE}=${await ownerCookieValue(secret)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${deps.isSecureRequest(c) ? '; Secure' : ''}`,
      { append: true }
    );
    return c.json({ ok: true });
  }

  if (sub === '/logout' && method === 'POST') {
    securityHeaders(c);
    if (!sameOrigin(c)) return c.json({ ok: false, error: 'Bad request.' }, 403);
    c.header('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; ${cookieBase}`);
    return c.json({ ok: true });
  }

  if (sub === '/data' && method === 'GET') {
    securityHeaders(c);
    if (!signedIn) return c.json({ ok: false, error: 'Signed out.' }, 401);
    const limit = await checkRateLimit(`admin-data:${ip}`, 60, 60, c.env.DB, false);
    if (!limit.allowed) return c.json({ ok: false, error: 'Slow down.' }, 429);
    const days = Number(c.req.query('days') || '1');
    const filters = parseFilters((k) => c.req.query(k));
    const data = await getAdminDashboardData(c.env, c.env.DB, days, filters);
    return c.json({ ok: true, data });
  }

  securityHeaders(c);
  return c.text('Not found', 404);
}
