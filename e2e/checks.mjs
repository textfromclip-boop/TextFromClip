// Extra E2E checks: upload + media seek, bilingual Arabic RTL, routes on direct load/refresh,
// SEO tags, sitemap/robots, analytics payloads (no personal data).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8799';
const OUT = new URL('./artifacts/checks/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function makeWav(seconds = 30, rate = 16000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

const browser = await chromium.launch();
async function newCtx() {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await c.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await c.route('https://www.youtube.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'stub' }));
  return c;
}
let ctx = await newCtx();

// ---- 1. Upload a recording -> transcript -> pack -> "From lecture" seeks the uploaded media
{
  await ctx.setExtraHTTPHeaders({ 'x-test-ip': '198.51.100.31' });
  const page = await ctx.newPage();
  const events = [];
  page.on('request', (req) => {
    if (req.url().endsWith('/api/events')) events.push(req.postData() || '');
  });
  await page.goto(BASE + '/upload', { waitUntil: 'networkidle' });
  const wav = join(OUT, 'lecture.wav');
  writeFileSync(wav, makeWav());
  await page.setInputFiles('input[type="file"]', wav);
  await page.getByRole('button', { name: /Make my revision pack/ }).waitFor({ timeout: 30000 });
  check('upload: WAV file produces a timestamped transcript', await page.getByText(/recorded lecture we review photosynthesis/).first().isVisible());
  const usage = await (await page.request.get(BASE + '/api/usage', { headers: { 'x-test-ip': '198.51.100.31' } })).json();
  check('upload: quota charged by audio duration (30 s), not MB', usage.data.uploadSecondsUsed === 30, `${usage.data.uploadSecondsUsed}s used`);
  await page.getByRole('button', { name: /Make my revision pack/ }).click();
  await page.getByText('Quote-Verified Revision Pack').waitFor({ timeout: 30000 });
  const badge = page.getByRole('button', { name: /From lecture · 00:1\d/ }).first();
  const lbl = await badge.innerText();
  await badge.click();
  const video = page.locator('video');
  await video.waitFor();
  await page.waitForTimeout(800);
  const t = await video.evaluate((v) => v.currentTime);
  const expected = Number(lbl.match(/00:(\d\d)/)[1]);
  check('upload: "From lecture" seeks the uploaded media to the right second', Math.abs(t - expected) < 1.5, `${lbl.trim()} -> currentTime=${t.toFixed(1)}`);
  await page.screenshot({ path: join(OUT, 'upload-seek.png') });

  // analytics: events sent, no personal data
  await page.waitForTimeout(300);
  const names = events.map((e) => { try { return JSON.parse(e).event; } catch { return '?'; } });
  const keys = new Set(events.flatMap((e) => { try { return Object.keys(JSON.parse(e)); } catch { return []; } }));
  check('analytics: events fire (transcript_done, pack_started, pack_done)', ['transcript_done', 'pack_started', 'pack_done'].every((n) => names.includes(n)), names.join(','));
  check('analytics: payload only {event, path}', [...keys].every((k) => k === 'event' || k === 'path'), [...keys].join(','));
  await page.close();
}

// ---- 2. Bilingual Arabic cards: translation under original, RTL (a different student)
{
  ctx = await newCtx();
  await ctx.setExtraHTTPHeaders({ 'x-test-ip': '198.51.100.32' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/flashcards-in-arabic', { waitUntil: 'networkidle' });
  await page.fill('#video-url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.locator('form button[type="submit"]').first().click();
  await page.getByRole('button', { name: /Make my revision pack/ }).waitFor({ timeout: 20000 });
  const sel = page.locator('#bilingual-select');
  const selected = await sel.inputValue().catch(() => '');
  check('SEO /flashcards-in-arabic preselects Arabic', /arabic/i.test(selected), `select=${selected}`);
  if (!/arabic/i.test(selected)) await sel.selectOption('Arabic').catch(() => {});
  const respP = page.waitForResponse((r) => r.url().includes('/api/revision-pack'));
  await page.getByRole('button', { name: /Make my revision pack/ }).click();
  const resp = await respP;
  if (resp.status() !== 200) console.log('   pack status', resp.status(), await resp.text());
  await page.getByText('Quote-Verified Revision Pack').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /Flashcards \(/ }).click();
  const ar = page.locator('[dir="rtl"]', { hasText: 'ترجمة' }).first();
  check('bilingual: Arabic translation rendered RTL under the original', await ar.isVisible());
  await page.getByRole('button', { name: /Reveal Answer/ }).click();
  await page.screenshot({ path: join(OUT, 'arabic-card.png') });
  await page.close();
}

// ---- 3. Routes on direct load + refresh, unique title/description/canonical
const ROUTES = ['/', '/app', '/study', '/pricing', '/privacy', '/terms', '/youtube', '/tiktok', '/instagram', '/upload', '/guide', '/about',
  '/youtube-lecture-to-flashcards', '/lecture-to-notes', '/video-to-quiz', '/youtube-to-text', '/youtube-transcript-to-pdf',
  '/flashcards-in-arabic', '/flashcards-in-spanish', '/flashcards-in-french', '/flashcards-in-german', '/flashcards-in-turkish', '/flashcards-in-portuguese', '/flashcards-in-hindi', '/refund'];
{
  const page = await ctx.newPage();
  const titles = new Map();
  const descs = new Map();
  let allOk = true;
  for (const r of ROUTES) {
    // raw HTML (what crawlers see before JS)
    const raw = await (await page.request.get(BASE + r)).text();
    const rawTitle = (raw.match(/<title>([^<]*)<\/title>/) || [])[1];
    const rawCanon = (raw.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    const rawDesc = (raw.match(/<meta name="description" content="([^"]+)"/) || [])[1];
    await page.goto(BASE + r, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    const h1 = await page.locator('h1').first().innerText().catch(() => '');
    const hasTool = r.startsWith('/flashcards') || ['/youtube-lecture-to-flashcards', '/lecture-to-notes', '/video-to-quiz', '/youtube-to-text', '/youtube-transcript-to-pdf'].includes(r)
      ? await page.locator('#video-url').count() > 0
      : true;
    const ok = page.url().endsWith(r === '/' ? '/' : r) && h1.length > 0 && rawTitle && rawCanon && rawDesc && hasTool;
    if (!ok) allOk = false;
    titles.set(r, rawTitle);
    descs.set(r, rawDesc);
    if (!ok) console.log('   route problem', r, { url: page.url(), h1, rawTitle, rawCanon, hasTool });
  }
  check(`all ${ROUTES.length} routes work on direct load + refresh (incl. 12 SEO pages with a working tool)`, allOk);
  check('every route has a unique <title>', new Set(titles.values()).size === ROUTES.length);
  check('every route has a unique meta description', new Set(descs.values()).size === ROUTES.length);

  const sitemap = await (await page.request.get(BASE + '/sitemap.xml')).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://learnfromclip.com', ''));
  check('sitemap.xml lists all routes on learnfromclip.com', ROUTES.every((r) => locs.includes(r)) && !/textfromclip/i.test(sitemap), `${locs.length} urls`);
  const robots = await (await page.request.get(BASE + '/robots.txt')).text();
  check('robots.txt allows site, disallows /api/, points to sitemap', /Allow: \//.test(robots) && /Disallow: \/api\//.test(robots) && /Sitemap: https:\/\/learnfromclip\.com\/sitemap\.xml/.test(robots));
  const unknown = await page.request.get(BASE + '/does-not-exist');
  check('unknown route falls back to the app (no hard 404 page)', unknown.status() === 200);
  await page.close();
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
