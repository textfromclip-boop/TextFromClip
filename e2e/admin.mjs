// Private admin console against the real Worker app + real local D1 (e2e/server.mjs):
// visits from two "countries" are recorded cookielessly, then the console shows them after sign-in.
// Usage: node e2e/admin.mjs [baseUrl]   (screenshots -> e2e/artifacts/admin/)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8799';
const ADMIN_PATH = 'e2e-console-7f3k2m9q4x8w';
const ADMIN_TOKEN = 'e2e-admin-token-0123456789abcdef';
const OUT = new URL('./artifacts/admin/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
// A fresh address per run: the sign-in lockout (5 tries / 15 min per IP) is stored in D1.
const RUN = Math.floor(Math.random() * 200) + 1;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const browser = await chromium.launch();
async function visit({ ua, country, ip, pages, referer }) {
  const ctx = await browser.newContext({ userAgent: ua });
  await ctx.setExtraHTTPHeaders({ 'x-test-ip': ip, 'x-test-country': country });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  for (const [i, p] of pages.entries()) {
    const pv = page.waitForResponse((r) => r.url().endsWith('/api/pv'), { timeout: 8000 }).catch(() => null);
    await page.goto(BASE + p, { waitUntil: 'networkidle', referer: i === 0 ? referer : undefined });
    await pv;
  }
  await ctx.close();
}

// 1. Visits: a desktop student in Germany arriving from Google, and a phone in the US.
await visit({ ua: DESKTOP_UA, country: 'DE', ip: '198.51.100.40', pages: ['/', '/guide', '/study'], referer: 'https://www.google.com/' });
await visit({ ua: PHONE_UA, country: 'US', ip: '198.51.100.41', pages: ['/', '/youtube-lecture-to-flashcards'] });
// A crawler is not counted
{
  const r = await fetch(BASE + '/api/pv', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Googlebot/2.1', 'x-test-ip': '198.51.100.42' }, body: JSON.stringify({ path: '/' }) });
  check('crawler page view is not stored', r.status === 202, `status ${r.status}`);
}

async function consoleRun(label, contextOpts) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The wrong-password attempt and the post-sign-out check answer 401 on purpose; anything else counts.
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push(m.text()); });

  // (fetched without running the page, so it doesn't add a visit of its own)
  const wrong = await page.request.get(`${BASE}/${ADMIN_PATH}x`);
  const unknown = await page.request.get(`${BASE}/no-such-page-anywhere`);
  check(`[${label}] wrong secret address is identical to any unknown page`, wrong.status() === unknown.status() && (await wrong.text()) === (await unknown.text()));

  const res = await page.goto(`${BASE}/${ADMIN_PATH}`, { waitUntil: 'networkidle' });
  check(`[${label}] console is noindex, no-store, strict CSP`, /noindex/.test(res.headers()['x-robots-tag'] || '') && res.headers()['cache-control'] === 'no-store' && /default-src 'none'/.test(res.headers()['content-security-policy'] || ''));
  await page.getByLabel('Admin password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Wrong password.').waitFor({ timeout: 5000 });
  check(`[${label}] wrong password refused`, true);
  await page.screenshot({ path: join(OUT, `${label}-1-sign-in.png`) });

  await page.getByLabel('Admin password').fill(ADMIN_TOKEN);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Live now').waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Today' }).waitFor();
  const text = await page.locator('body').innerText();
  check(`[${label}] dashboard lists visitor countries`, /Germany/.test(text) && /United States/.test(text));
  check(`[${label}] dashboard shows where visitors came from`, /google\.com/.test(text));
  check(`[${label}] dashboard shows pages, devices and browsers`, /\/guide/.test(text) && /Desktop/.test(text) && /Mobile/.test(text) && /Safari/.test(text));
  check(`[${label}] dashboard shows the AI budget`, /daily budget/.test(text) && /Status: running/.test(text));
  check(`[${label}] latest visits feed`, /→ \/study/.test(text));
  // One visitor each from Germany and the US, however many pages they opened. (Other test browsers
  // that pretend to be iPhones are counted too, under "Unknown" country, so the total isn't checked.)
  const perCountry = (name) => Number(((text.match(new RegExp(name + '\\s*\\n\\s*(\\d+)')) || [])[1]) || -1);
  check(`[${label}] counts unique visitors per day, not page views`, perCountry('Germany') === 1 && perCountry('United States') === 1, `DE ${perCountry('Germany')}, US ${perCountry('United States')}`);
  await page.screenshot({ path: join(OUT, `${label}-2-dashboard.png`), fullPage: true });

  await page.getByRole('button', { name: '30 days' }).click();
  await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]')?.textContent === '30 days');
  check(`[${label}] range switch works`, /last 30 days/.test(await page.locator('body').innerText()));

  // Session survives a reload; sign out returns to the sign-in form
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Live now').waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Admin password').waitFor();
  const after = await page.request.get(`${BASE}/${ADMIN_PATH}/data?days=1`);
  check(`[${label}] signed out: data is locked again`, after.status() === 401);
  check(`[${label}] no script or CSP errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await consoleRun('mobile-375', { ...devices['iPhone SE'], viewport: { width: 375, height: 667 }, extraHTTPHeaders: { 'x-test-ip': `198.51.${RUN}.50` } });
await consoleRun('desktop-1920', { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, extraHTTPHeaders: { 'x-test-ip': `198.51.${RUN}.51` } });

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
