// Free launch mode, the site-wide daily AI budget, cookieless visit analytics and the private
// admin console.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../server/index';
import {
  recordCostTelemetry,
  resetMemoryQuotasAndCacheForTests,
} from '../server/utils/quotasAndCache';
import { resetMemoryAuthAndPaymentsForTests } from '../server/utils/paymentsAndAuth';
import {
  CLOUDFLARE_FREE_AI_USD_PER_DAY,
  DEFAULT_AI_DAILY_BUDGET_USD,
  aiBusyMessage,
  resolveAiDailyBudgetUsd,
  secondsUntilUtcMidnight,
} from '../server/utils/aiBudget';
import { isBotUserAgent, parseFilters, parseUserAgent, recordPageView, recordWebVitals, referrerSource, resolveRange } from '../server/utils/visitAnalytics';
import { createAdminSession, ownerCookieValue, verifyAdminSession } from '../server/admin/console';
import { DEV_ONLY_COOKIE_SECRET } from '../server/utils/quotasAndCache';
import { PAYMENTS_ENABLED } from '../shared/launch';

beforeEach(() => {
  resetMemoryQuotasAndCacheForTests();
  resetMemoryAuthAndPaymentsForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const lecture = (extra = '') =>
  Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    start: i * 10,
    duration: 10,
    text: `Enzymes are biological catalysts that speed up chemical reactions, point ${i + 1}${extra}.`,
  }));

/** Pushes today's estimated AI spend to about $0.75 (1M output tokens), far above the default budget. */
const spendTodaysBudget = () => recordCostTelemetry({ llmOutputTokens: 1_000_000 });

describe('free launch mode', () => {
  it('is on: payments are switched off in the shared launch config', () => {
    expect(PAYMENTS_ENABLED).toBe(false);
  });

  it('the daily-limit message says "come back tomorrow" and never asks to upgrade', async () => {
    const headers = { 'Content-Type': 'application/json', 'x-enforce-quota': '1', 'x-forwarded-for': '10.60.0.1' };
    const env = { ENVIRONMENT: 'test' } as any;
    const first = await app.request('/api/revision-pack', { method: 'POST', headers, body: JSON.stringify({ segments: lecture(), videoTitle: 'A' }) }, env);
    expect(first.status).toBe(200);
    const cookie = (first.headers.get('set-cookie') || '').match(/lfc_aid=[^;]+/)![0];
    const second = await app.request('/api/revision-pack', { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ segments: lecture(' again'), videoTitle: 'B' }) }, env);
    expect(second.status).toBe(429);
    const message = ((await second.json()) as any).error.message as string;
    expect(message).toMatch(/Come back tomorrow/);
    expect(message).not.toMatch(/upgrade|pass/i);
  });
});

describe('site-wide daily AI budget', () => {
  const env = { ENVIRONMENT: 'test' } as any;

  it('defaults to just under Cloudflare\'s free daily AI, and can be configured', () => {
    expect(DEFAULT_AI_DAILY_BUDGET_USD).toBeLessThan(CLOUDFLARE_FREE_AI_USD_PER_DAY);
    expect(resolveAiDailyBudgetUsd({})).toBe(DEFAULT_AI_DAILY_BUDGET_USD);
    expect(resolveAiDailyBudgetUsd({ AI_DAILY_BUDGET_USD: '2.5' })).toBe(2.5);
    expect(resolveAiDailyBudgetUsd({ AI_DAILY_BUDGET_USD: '0' })).toBe(0);
    expect(resolveAiDailyBudgetUsd({ AI_DAILY_BUDGET_USD: 'lots' })).toBe(DEFAULT_AI_DAILY_BUDGET_USD);
    expect(resolveAiDailyBudgetUsd({ AI_DAILY_BUDGET_USD: '-3' })).toBe(DEFAULT_AI_DAILY_BUDGET_USD);
  });

  it('the pause message says when AI comes back and what still works', () => {
    expect(aiBusyMessage(2 * 3600 + 5 * 60)).toMatch(/2 h 5 min/);
    expect(aiBusyMessage(2 * 3600 + 5 * 60)).toMatch(/Transcripts, packs you already made, study mode and exports still work/);
    const s = secondsUntilUtcMidnight(new Date('2026-11-19T23:00:00Z'));
    expect(s).toBe(3600);
  });

  it('under budget, AI work runs normally', async () => {
    const res = await app.request('/api/revision-pack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.61.0.1' }, body: JSON.stringify({ segments: lecture(), videoTitle: 'A' }) }, env);
    expect(res.status).toBe(200);
  });

  it('when the budget is used up, new packs, formats, translations and uploads pause with a 503', async () => {
    await spendTodaysBudget();
    const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': '10.62.0.1' };
    const pack = await app.request('/api/revision-pack', { method: 'POST', headers, body: JSON.stringify({ segments: lecture(), videoTitle: 'A' }) }, env);
    expect(pack.status).toBe(503);
    const body: any = await pack.json();
    expect(body.error.code).toBe('AI_DAILY_BUDGET_REACHED');
    expect(Number(pack.headers.get('retry-after'))).toBeGreaterThan(0);

    const transform = await app.request('/api/transform', { method: 'POST', headers, body: JSON.stringify({ text: 'Enzymes are biological catalysts.', mode: 'summary' }) }, env);
    expect(transform.status).toBe(503);
    const translate = await app.request('/api/translate', { method: 'POST', headers, body: JSON.stringify({ text: 'Enzymes are biological catalysts.', targetLanguage: 'Spanish' }) }, env);
    expect(translate.status).toBe(503);

    const r2 = { put: async () => {}, get: async () => null, delete: async () => {}, head: async () => null };
    const chunk = await app.request('/api/upload/chunk?fileName=a.wav', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-forwarded-for': '10.62.0.1' }, body: new Uint8Array(64) }, { ...env, UPLOADS_BUCKET: r2 });
    expect(chunk.status).toBe(503);
    expect(((await chunk.json()) as any).error.code).toBe('AI_DAILY_BUDGET_REACHED');
  });

  it('a pack someone already made still loads when the budget is used up (no new AI needed)', async () => {
    const make = await app.request('/api/revision-pack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.63.0.1' }, body: JSON.stringify({ segments: lecture(), videoTitle: 'A' }) }, env);
    expect(make.status).toBe(200);
    await spendTodaysBudget();
    const again = await app.request('/api/revision-pack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.63.0.2' }, body: JSON.stringify({ segments: lecture(), videoTitle: 'A' }) }, env);
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).cached).toBe(true);
  });

  it('a raised budget lets AI work continue', async () => {
    await spendTodaysBudget();
    const res = await app.request('/api/revision-pack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.64.0.1' }, body: JSON.stringify({ segments: lecture(), videoTitle: 'A' }) }, { ...env, AI_DAILY_BUDGET_USD: '5' });
    expect(res.status).toBe(200);
  });
});

describe('cookieless visit analytics', () => {
  it('reads device, browser and OS from the user agent', () => {
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ device: 'Mobile', browser: 'Safari', os: 'iOS' });
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36')).toEqual({ device: 'Desktop', browser: 'Chrome', os: 'Windows' });
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36')).toEqual({ device: 'Tablet', browser: 'Chrome', os: 'Android' });
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0').browser).toBe('Edge');
  });

  it('skips bots and crawlers', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 HeadlessChrome/131.0')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe(false);
  });

  it('keeps only the referring site, and ignores links within the site', () => {
    expect(referrerSource('https://www.google.com/search?q=lecture+notes', 'learnfromclip.com')).toBe('google.com');
    expect(referrerSource('https://m.facebook.com/story', 'learnfromclip.com')).toBe('facebook.com');
    expect(referrerSource('https://learnfromclip.com/guide', 'learnfromclip.com')).toBeNull();
    expect(referrerSource('not a url', 'learnfromclip.com')).toBeNull();
  });

  function fakeDb() {
    const inserts: any[][] = [];
    const db = {
      prepare: (_sql: string) => ({ bind: (...args: any[]) => ({ run: async () => { inserts.push(args); return {}; } }) }),
    } as any;
    return { db, inserts };
  }
  const base = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
    ip: '203.0.113.77',
    country: 'US',
    city: 'Austin',
    ownHost: 'learnfromclip.com',
    salt: 'salt-0123456789abcdef0123456789abcdef',
  };

  it('stores page, country, city, source and device, but never the IP address', async () => {
    const { db, inserts } = fakeDb();
    expect(await recordPageView({ ...base, path: '/study', referrer: 'https://www.reddit.com/r/college' }, db)).toBe(true);
    const row = inserts[0];
    expect(row).toContain('/study');
    expect(row).toContain('US');
    expect(row).toContain('Austin');
    expect(row).toContain('reddit.com');
    expect(row).toContain('Mobile');
    expect(JSON.stringify(row)).not.toContain('203.0.113.77');
  });

  it('the visitor hash is stable within a day and changes the next day', async () => {
    const { db, inserts } = fakeDb();
    await recordPageView({ ...base, path: '/', now: new Date('2026-11-19T08:00:00Z') }, db);
    await recordPageView({ ...base, path: '/guide', now: new Date('2026-11-19T20:00:00Z') }, db);
    await recordPageView({ ...base, path: '/', now: new Date('2026-11-20T08:00:00Z') }, db);
    const hashes = inserts.map((r) => r[9]); // visitor_hash column
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it('creates the visits table itself if migration 0005 was never applied', async () => {
    const created: string[] = [];
    let inserts = 0;
    let tableExists = false;
    const db = {
      prepare: (sql: string) => ({
        run: async () => {
          if (/CREATE TABLE IF NOT EXISTS page_views/.test(sql)) tableExists = true;
          created.push(sql);
          return {};
        },
        all: async () => ({ results: [{ name: 'is_entry' }] }),
        bind: () => ({
          run: async () => {
            if (!tableExists) throw new Error('D1_ERROR: no such table: page_views: SQLITE_ERROR');
            inserts++;
            return {};
          },
        }),
      }),
    } as any;
    expect(await recordPageView({ ...base, path: '/' }, db)).toBe(true);
    expect(inserts).toBe(1);
    expect(created.some((s) => /CREATE TABLE IF NOT EXISTS page_views/.test(s))).toBe(true);
  });

  it('rejects bots, odd paths and fake country codes', async () => {
    const { db, inserts } = fakeDb();
    expect(await recordPageView({ ...base, path: '/<script>' }, db)).toBe(false);
    expect(await recordPageView({ ...base, path: 'https://evil.example/' }, db)).toBe(false);
    expect(await recordPageView({ ...base, path: '/', userAgent: 'Googlebot/2.1' }, db)).toBe(false);
    await recordPageView({ ...base, path: '/', country: 'XX' }, db);
    expect(inserts.length).toBe(1);
    expect(inserts[0][3]).toBeNull();
  });

  it('marks the first page of a visit, so visits and page views are counted separately', async () => {
    const { db, inserts } = fakeDb();
    await recordPageView({ ...base, path: '/', entry: true }, db);
    await recordPageView({ ...base, path: '/study', entry: false }, db);
    expect(inserts[0][10]).toBe(1);
    expect(inserts[1][10]).toBe(0);
  });

  it('speed samples: keeps valid numbers only, drops bots and empty reports', async () => {
    const { db, inserts } = fakeDb();
    expect(await recordWebVitals({ path: '/', lcp: 1834.6, inp: 96, cls: 0.0512, ttfb: 210, load: 2400, userAgent: base.userAgent, country: 'DE' }, db)).toBe(true);
    const row = inserts[0];
    expect(row).toContain(1835); // LCP rounded to ms
    expect(row).toContain(0.051); // CLS to 3 decimals
    expect(row).toContain('DE');
    expect(await recordWebVitals({ path: '/', lcp: -5, inp: 'fast', cls: 999, userAgent: base.userAgent }, db)).toBe(false);
    expect(await recordWebVitals({ path: '/', lcp: 900, userAgent: 'Googlebot/2.1' }, db)).toBe(false);
    expect(await recordWebVitals({ path: '/<x>', lcp: 900, userAgent: base.userAgent }, db)).toBe(false);
    expect(inserts.length).toBe(1);
  });

  it('filters: only known keys, short values; ranges compare with the same span before', () => {
    const q: Record<string, string> = { country: 'SO', path: '/study', evil: 'x; DROP TABLE users', referrer: 'a'.repeat(500) };
    expect(parseFilters((k) => q[k])).toEqual({ country: 'SO', path: '/study' });
    const now = Date.parse('2026-11-19T15:30:00Z') / 1000;
    const today = resolveRange(1, now);
    expect(today.bucket).toBe('hour');
    expect(today.fromSec).toBe(Date.parse('2026-11-19T00:00:00Z') / 1000);
    expect(today.prevFromSec).toBe(Date.parse('2026-11-18T00:00:00Z') / 1000);
    expect(today.prevToSec).toBe(today.toSec - 86400); // yesterday up to the same time
    const week = resolveRange(7, now);
    expect(week.bucket).toBe('day');
    expect(week.fromSec).toBe(Date.parse('2026-11-13T00:00:00Z') / 1000);
    expect(resolveRange(5000, now).days).toBe(90);
  });

  it("the site owner's own browser is not counted", async () => {
    const env = { ENVIRONMENT: 'test' } as any;
    const owner = `lfc_owner=${await ownerCookieValue(DEV_ONLY_COOKIE_SECRET)}`;
    const ua = { 'user-agent': base.userAgent, 'Content-Type': 'application/json' };
    const ownVisit = await app.request('/api/pv', { method: 'POST', headers: { ...ua, cookie: owner }, body: JSON.stringify({ path: '/' }) }, env);
    expect(ownVisit.headers.get('x-analytics')).toBe('owner-ignored');
    const forged = await app.request('/api/pv', { method: 'POST', headers: { ...ua, cookie: 'lfc_owner=1.00000000000000000000000000000000' }, body: JSON.stringify({ path: '/' }) }, env);
    expect(forged.headers.get('x-analytics')).toBeNull(); // a fake owner cookie is not trusted
    const ownSpeed = await app.request('/api/vitals', { method: 'POST', headers: { ...ua, cookie: owner }, body: JSON.stringify({ path: '/', lcp: 900 }) }, env);
    expect(ownSpeed.headers.get('x-analytics')).toBe('owner-ignored');
  });

  it('/api/pv answers without a body even when nothing is stored', async () => {
    const res = await app.request('/api/pv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/' }) }, { ENVIRONMENT: 'test' } as any);
    expect([202, 204]).toContain(res.status);
  });
});

describe('private admin console', () => {
  const ADMIN_PATH = 'ops-7f3k2m9q4x8w1z5v';
  const ADMIN_TOKEN = 'admin-password-0123456789abcdefghij';
  const env = { ENVIRONMENT: 'test', ADMIN_PATH, ADMIN_TOKEN } as any;
  const origin = 'http://localhost';
  let ipCounter = 0;
  const ip = () => `10.70.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const login = (password: string, headers: Record<string, string> = {}) =>
    app.request(`/${ADMIN_PATH}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify({ password }) }, env);

  it('does not exist when ADMIN_PATH is not set, or is too short to be secret', async () => {
    const off = await app.request(`/${ADMIN_PATH}`, {}, { ENVIRONMENT: 'test', ADMIN_TOKEN } as any);
    const unknown = await app.request('/some-page-that-does-not-exist', {}, { ENVIRONMENT: 'test' } as any);
    expect(off.status).toBe(unknown.status);
    expect(await off.text()).toBe(await unknown.text());
    const short = await app.request('/admin', {}, { ENVIRONMENT: 'test', ADMIN_PATH: 'admin', ADMIN_TOKEN } as any);
    expect(short.status).toBe(unknown.status);
  });

  it('a wrong secret address looks exactly like any unknown page', async () => {
    const wrong = await app.request(`/${ADMIN_PATH}x`, {}, env);
    const unknown = await app.request('/another-unknown-page-123', {}, env);
    expect(wrong.status).toBe(unknown.status);
    expect(await wrong.text()).toBe(await unknown.text());
  });

  it('serves the sign-in page with strict security headers and no secrets in it', async () => {
    const res = await app.request(`/${ADMIN_PATH}`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'; script-src 'nonce-[A-Za-z0-9_-]+'/);
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    const html = await res.text();
    expect(html).toContain('data-signed-in="0"');
    expect(html).not.toContain(ADMIN_TOKEN);
  });

  it('data needs a signed-in session', async () => {
    const res = await app.request(`/${ADMIN_PATH}/data?days=7`, {}, env);
    expect(res.status).toBe(401);
  });

  it('sign-in: wrong password is refused, cross-site requests are refused, and guessing locks out', async () => {
    const attacker = ip();
    expect((await login('nope', { 'x-forwarded-for': attacker })).status).toBe(401);
    const noOrigin = await app.request(`/${ADMIN_PATH}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ password: ADMIN_TOKEN }) }, env);
    expect(noOrigin.status).toBe(403);
    const foreign = await login(ADMIN_TOKEN, { Origin: 'https://evil.example', 'x-forwarded-for': ip() });
    expect(foreign.status).toBe(403);
    for (let i = 0; i < 4; i++) await login('guess' + i, { 'x-forwarded-for': attacker });
    // 6th attempt from the same IP within 15 minutes is blocked, even with the right password
    const locked = await login(ADMIN_TOKEN, { 'x-forwarded-for': attacker });
    expect(locked.status).toBe(429);
  });

  it('the right password gives a 12-hour session cookie scoped to the secret address, which unlocks the data', async () => {
    const res = await login(ADMIN_TOKEN, { 'x-forwarded-for': ip() });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/^lfc_admin=/);
    expect(setCookie).toContain(`Path=/${ADMIN_PATH}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Max-Age=43200');
    const cookie = setCookie.split(';')[0];
    const data = await app.request(`/${ADMIN_PATH}/data?days=7`, { headers: { cookie, 'x-forwarded-for': ip() } }, env);
    expect(data.status).toBe(200);
    const json: any = await data.json();
    expect(json.ok).toBe(true);
    expect(json.data.range.days).toBe(7);
    expect(json.data.usage.budget.budgetUsd).toBe(DEFAULT_AI_DAILY_BUDGET_USD);
    // the owner's browser is marked so their own visits are not counted
    expect((res.headers as any).getSetCookie().some((c: string) => /^lfc_owner=1\.[0-9a-f]{32}; Path=\//.test(c))).toBe(true);
    const page = await app.request(`/${ADMIN_PATH}`, { headers: { cookie } }, env);
    expect(await page.text()).toContain('data-signed-in="1"');
  });

  it('changing ADMIN_TOKEN signs everyone out; expired or forged sessions are refused', async () => {
    const secret = 'cookie-secret-0123456789abcdefghijklmnop';
    const session = await createAdminSession(secret, ADMIN_TOKEN, 1_000_000);
    expect(await verifyAdminSession(session, secret, ADMIN_TOKEN, 1_000_100)).toBe(true);
    expect(await verifyAdminSession(session, secret, 'a-different-admin-token-0123456789', 1_000_100)).toBe(false);
    expect(await verifyAdminSession(session, secret, ADMIN_TOKEN, 1_000_000 + 12 * 3600 + 1)).toBe(false);
    expect(await verifyAdminSession(session.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), secret, ADMIN_TOKEN, 1_000_100)).toBe(false);
    expect(await verifyAdminSession(`${1_000_000 + 99999}.${session.split('.')[1]}`, secret, ADMIN_TOKEN, 1_000_100)).toBe(false);
  });

  it('a short ADMIN_PASSWORD (8+ chars) works for sign-in; anything shorter is refused', async () => {
    const pwEnv = { ENVIRONMENT: 'test', ADMIN_PATH, ADMIN_TOKEN, ADMIN_PASSWORD: 'simple1234' } as any;
    const signIn = (password: string, e: any) =>
      app.request(`/${ADMIN_PATH}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'x-forwarded-for': ip() }, body: JSON.stringify({ password }) }, e);
    expect((await signIn('simple1234', pwEnv)).status).toBe(200);
    expect((await signIn(ADMIN_TOKEN, pwEnv)).status).toBe(401); // the password replaces the token for sign-in
    const tooShort = { ...pwEnv, ADMIN_PASSWORD: 'abc123' };
    expect((await signIn('abc123', tooShort)).status).toBe(401); // ignored, falls back to ADMIN_TOKEN
    expect((await signIn(ADMIN_TOKEN, tooShort)).status).toBe(200);
  });

  it('with ADMIN_PATH set but no ADMIN_TOKEN, the console refuses to run', async () => {
    const res = await app.request(`/${ADMIN_PATH}`, {}, { ENVIRONMENT: 'test', ADMIN_PATH } as any);
    expect(res.status).toBe(503);
  });
});
