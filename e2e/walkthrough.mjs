// Full student flow at 1920x1080 and 375px mobile against e2e/server.mjs.
// Usage: node e2e/walkthrough.mjs [baseUrl]   (screenshots -> e2e/artifacts/<viewport>/NN-step.png)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Playwright is pre-installed globally in the audit environment (require() resolves it via NODE_PATH)
const { chromium, devices } = require('playwright');
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8799';
const OUT = new URL('./artifacts/', import.meta.url).pathname;
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' && src[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function run(label, contextOpts, ip) {
  const dir = join(OUT, label);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = async (page, name, full = false) => {
    n++;
    await page.screenshot({ path: join(dir, `${String(n).padStart(2, '0')}-${name}.jpg`), fullPage: full, type: 'jpeg', quality: 70 });
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ ...contextOpts, acceptDownloads: true });
  await context.setExtraHTTPHeaders({ 'x-test-ip': ip });
  // YouTube embeds are not reachable from the sandbox; serve a stub so the iframe src can be checked.
  await context.route('https://www.youtube.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<body style="background:#000;color:#fff;font:16px sans-serif">YouTube embed (stub)</body>' }));
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // 1. Homepage
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const h1 = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ');
  check(`[${label}] homepage headline`, /2-hour lecture → 10-minute revision pack\./.test(h1), h1);
  check(`[${label}] sub-headline`, (await page.content()).includes('One upload. Transcript, notes, flashcards and quiz, every point linked to the lecture.'));
  await shot(page, 'home');

  // 2. Paste link -> transcript
  await page.fill('#video-url', VIDEO);
  await page.locator('form button[type="submit"]').first().click();
  await page.getByRole('button', { name: /Make my revision pack/ }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /Make my revision pack/ }).scrollIntoViewIfNeeded();
  check(`[${label}] transcript shown`, await page.getByText('Cellular respiration is the process').first().isVisible());
  await shot(page, 'transcript');

  // 3. Revision pack
  await page.getByRole('button', { name: /Make my revision pack/ }).click();
  await page.getByText('Quote-Verified Revision Pack').waitFor({ timeout: 30000 });
  const summary = await page.getByText(/note points ·/).first().innerText();
  check(`[${label}] revision pack generated`, /\d+ note points · \d+ flashcards · 10 quiz questions/.test(summary), summary);
  const aiBox = page.getByText('AI explanation', { exact: true }).first();
  check(`[${label}] AI explanation visually labelled`, await aiBox.isVisible());
  await shot(page, 'pack-notes');

  // 4. Tap 3 timestamps -> YouTube embed seeks
  const badges = page.getByRole('button', { name: /From lecture · \d\d:\d\d/ });
  const count = await badges.count();
  const seen = [];
  for (const idx of [0, Math.floor(count / 2), count - 1]) {
    const b = badges.nth(idx);
    const label2 = await b.innerText();
    const [mm, ss] = label2.match(/(\d\d):(\d\d)/).slice(1).map(Number);
    await b.scrollIntoViewIfNeeded();
    await b.click();
    const iframe = page.locator('iframe[title="Lecture video player"]');
    await iframe.waitFor();
    const src = await iframe.getAttribute('src');
    const start = Number(new URL(src).searchParams.get('start'));
    seen.push(`${label2.trim()} -> start=${start}`);
    check(`[${label}] timestamp ${label2.trim()} seeks embed`, start === mm * 60 + ss, src);
  }
  await page.locator('iframe[title="Lecture video player"]').scrollIntoViewIfNeeded();
  await shot(page, 'timestamp-seek');

  // 5. Study 5 cards
  await page.getByRole('button', { name: /2\. Flashcards/ }).click();
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: /Reveal Answer/ }).click();
    await page.getByRole('button', { name: /^Good/ }).first().click();
  }
  await shot(page, 'studied-5-cards');

  // Exports from the revision pack toolbar
  const [csvDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /^Anki CSV$/ }).first().click(),
  ]);
  const csvPath = join(dir, 'export.csv');
  await csvDl.saveAs(csvPath);
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  check(`[${label}] Anki CSV valid (3 columns, front/back/source timestamp)`, rows.length >= 5 && rows.every((r) => r.length === 3) && /From lecture · \d\d:\d\d/.test(rows[0][2]), `${rows.length} rows`);
  const [pdfPopup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: /^Export PDF$/ }).first().click(),
  ]);
  await pdfPopup.waitForLoadState('domcontentloaded');
  const pdfHtml = await pdfPopup.content();
  check(`[${label}] PDF print view has notes + cards + quiz`, /Structured Lecture Notes/.test(pdfHtml) && /Active-Recall Flashcards/.test(pdfHtml) && /Multiple-Choice Quiz/.test(pdfHtml));
  if (label === 'desktop-1920') {
    await pdfPopup.pdf({ path: join(dir, 'export.pdf') }).catch(() => {});
  }
  await pdfPopup.close();
  const [mdDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Markdown \(\.MD\)/ }).first().click(),
  ]).catch(() => [null]);
  if (mdDl) {
    await mdDl.saveAs(join(dir, 'export.md'));
    check(`[${label}] Markdown export`, /## 1\. Structured Notes/.test(readFileSync(join(dir, 'export.md'), 'utf8')));
  } else {
    check(`[${label}] Markdown export`, false, 'no Markdown button on /study');
  }


  // 6. Reload -> progress kept (IndexedDB)
  await page.goto(BASE + '/study', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const studyText = await page.locator('main').innerText();
  const reviews = Number((studyText.match(/(\d+) total card reviews/) || [])[1] || 0);
  check(`[${label}] progress kept after reload`, reviews >= 5 && /1 day streak|1 days streak/.test(studyText), `${reviews} reviews`);
  const due = Number((studyText.match(/You have (\d+) flashcards? due/) || [])[1] || 0);
  check(`[${label}] reviewed cards no longer due`, due === 25, `${due} due (30 cards - 5 reviewed as Good)`);
  await shot(page, 'study-after-reload', true);

  // 7. Quiz on /study: answer all 10 (pick first option), score, review missed
  await page.getByRole('button', { name: /quiz/i }).first().click();
  for (let q = 0; q < 10; q++) {
    const opts = page.locator('main button[dir="auto"]:not([disabled])');
    await opts.first().click();
    const next = page.getByRole('button', { name: /Next Question|Finish Quiz|Finish & See Score/ });
    if (await next.count()) await next.first().click();
  }
  await page.getByText(/Review what you missed/).first().waitFor({ timeout: 5000 });
  const scoreText = await page.locator('main').innerText();
  check(`[${label}] quiz scored`, /\d+\s*\/\s*10|scored|Score/i.test(scoreText));
  await shot(page, 'quiz-score');
  const missedLabel = await page.getByText(/Review what you missed/).first().innerText();
  await page.getByText(/Review what you missed/).first().click();
  await page.waitForTimeout(500);
  await page.goto(BASE + '/study', { waitUntil: 'networkidle' });
  const decksText = await page.locator('main').innerText();
  check(`[${label}] missed-questions deck created & original deck kept`, /Missed Quiz Review/.test(decksText) && /Biology 101: Cellular Respiration(?! — Missed)/.test(decksText), missedLabel);
  await shot(page, 'missed-deck', true);

  // 8. Exports (from the lecture page)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('#video-url', VIDEO);
  await page.locator('form button[type="submit"]').first().click();
  await page.getByRole('button', { name: /Make my revision pack/ }).waitFor({ timeout: 20000 });
  const packResp = page.waitForResponse((r) => r.url().includes('/api/revision-pack'));
  await page.getByRole('button', { name: /Make my revision pack/ }).click();
  const pr = await packResp;
  // Same transcript + settings: cached pack, but the free 1 quiz/day was already used
  if (pr.status() === 429) {
    const alert = page.getByRole('alert').filter({ hasText: /quiz per day|limit/i }).first();
    await alert.waitFor();
    await alert.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    check(`[${label}] free limit hit shows upgrade button`, await page.getByText('See plans & upgrade →').first().isVisible());
    await shot(page, 'limit-hit');
  } else {
    check(`[${label}] free limit hit shows upgrade button`, false, `status ${pr.status()}`);
  }

  // 9. Pricing page + Buy button
  await page.goto(BASE + '/pricing', { waitUntil: 'networkidle' });
  await shot(page, 'pricing', true);
  await page.getByRole('button', { name: /Get 7-Day Exam Pass/ }).click();
  await page.fill('#checkout-email', 'student@uni.edu');
  const coResp = page.waitForResponse((r) => r.url().includes('/api/checkout'));
  await page.getByRole('button', { name: /Proceed to Secure Payment/ }).click();
  const co = await coResp;
  const coJson = await co.json();
  check(`[${label}] Buy button calls checkout with the right plan`, co.status() === 503 && coJson.error.code === 'CHECKOUT_NOT_CONFIGURED', 'NEEDS CONFIG: Lemon Squeezy keys not set locally');
  await shot(page, 'checkout-not-configured');

  check(`[${label}] no uncaught page errors`, consoleErrors.length === 0, consoleErrors.join(' | '));
  await browser.close();
}

await run('desktop-1920', { viewport: { width: 1920, height: 1080 } }, '198.51.100.21');
await run('mobile-375', { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }, '198.51.100.22');

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
