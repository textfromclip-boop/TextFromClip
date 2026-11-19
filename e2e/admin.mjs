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
    // First page: arriving (from Google or directly). Later pages: moving within the site.
    await page.goto(BASE + p, { waitUntil: 'networkidle', referer: i === 0 ? referer : BASE + pages[i - 1] });
    await pv;
  }
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 300));
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
  await page.getByText('live now').waitFor({ timeout: 8000 });
  await page.getByRole('heading', { name: /^Countries/ }).waitFor();
  const text = await page.locator('body').innerText();
  check(`[${label}] metric tiles with change vs previous period`, /Visits/.test(text) && /Page views/.test(text) && /Bounce rate/.test(text) && /vs yesterday \(same time\)/.test(text));
  check(`[${label}] hourly chart for today`, (await page.locator('.chart svg path').count()) >= 2 && /00:00/.test(text));
  const mapPaths = await page.locator('.map svg path').count();
  const shaded = await page.locator('.map svg path:not([fill="var(--map-empty)"])').count();
  check(`[${label}] world map with visiting countries shaded`, mapPaths > 150 && shaded >= 2, `${mapPaths} countries, ${shaded} shaded`);
  check(`[${label}] lists countries, sources, pages, devices, browsers`, /Germany/.test(text) && /United States/.test(text) && /google\.com/.test(text) && /\/guide/.test(text) && /Desktop/.test(text) && /Safari/.test(text));
  // Visits = arrivals: Germany arrived once (3 pages), the US once (2 pages)
  const rowValue = (name) => Number(((text.match(new RegExp(name + '\\s*\\n\\s*(\\d+)')) || [])[1]) || -1);
  check(`[${label}] counts visits, not page views`, rowValue('Germany') === 1 && rowValue('United States') === 1, `DE ${rowValue('Germany')}, US ${rowValue('United States')}`);
  await page.screenshot({ path: join(OUT, `${label}-2-traffic.png`), fullPage: true });

  // Page views metric switches the lists too
  await page.getByRole('button', { name: /^Page views/ }).click();
  await page.getByRole('heading', { name: /Countries · Page views/ }).waitFor();
  const pvText = await page.locator('body').innerText();
  check(`[${label}] page-views metric: Germany 3, US 2`, Number((pvText.match(/Germany\s*\n\s*(\d+)/) || [])[1]) === 3 && Number((pvText.match(/United States\s*\n\s*(\d+)/) || [])[1]) === 2);

  // Tap a country: everything filters to it
  await page.locator('.rows li', { hasText: 'Germany' }).first().click();
  await page.getByText(/Country: .*Germany/).waitFor();
  const filtered = await page.locator('main, #main').first().innerText();
  check(`[${label}] tapping a country filters the whole page`, !/United States/.test(filtered) && /\/guide/.test(filtered) && !/youtube-lecture-to-flashcards/.test(filtered));
  await page.screenshot({ path: join(OUT, `${label}-3-filtered.png`), fullPage: true });
  await page.getByRole('button', { name: 'Remove filter Country' }).click();
  await page.getByText('Tap any country').waitFor();

  // Speed tab
  await page.getByRole('tab', { name: /Speed/ }).click();
  await page.getByRole('heading', { name: /Largest Contentful Paint/ }).waitFor();
  const speed = await page.locator('body').innerText();
  const samples = Number((speed.match(/(\d+) page loads measured/) || [])[1] || 0);
  check(`[${label}] speed tab shows real-user LCP/INP/CLS with ratings`, samples >= 1 && /(Good|Needs improvement|Poor)/.test(speed) && /Interaction to Next Paint/.test(speed) && /Cumulative Layout Shift/.test(speed), `${samples} samples`);
  await page.screenshot({ path: join(OUT, `${label}-4-speed.png`), fullPage: true });

  // AI & usage tab
  await page.getByRole('tab', { name: 'AI & usage' }).click();
  await page.getByRole('heading', { name: 'Free AI today' }).waitFor();
  const usage = await page.locator('body').innerText();
  check(`[${label}] AI tab shows budget, packs and actions`, /daily budget/.test(usage) && /Running/.test(usage) && /AI per day/.test(usage));
  await page.screenshot({ path: join(OUT, `${label}-5-ai.png`), fullPage: true });

  // Range switch
  await page.getByRole('tab', { name: 'Traffic' }).click();
  await page.getByLabel('Time range').selectOption('30');
  await page.getByText(/vs previous 30 days/).first().waitFor();
  check(`[${label}] range switch to 30 days`, true);

  // This browser signed in, so its own visits are no longer counted
  const own = await page.request.post(`${BASE}/api/pv`, { data: { path: '/' }, headers: { 'user-agent': PHONE_UA } });
  check(`[${label}] the owner's own visits are not counted`, own.headers()['x-analytics'] === 'owner-ignored');

  // Session survives a reload; sign out returns to the sign-in form
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('live now').waitFor({ timeout: 8000 });
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
