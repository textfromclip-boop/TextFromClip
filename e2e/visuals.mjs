// Visuals tab + flashcard UI: mind map, sketchnotes, card sheet, PNG export, keyboard shortcuts.
import { createRequire } from 'node:module';
import { mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8799';
const OUT = new URL('./artifacts/visuals/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
for (const [label, opts, ip] of [['desktop', { viewport: { width: 1280, height: 900 }, acceptDownloads: true }, '198.51.102.1'], ['mobile', { ...devices['iPhone 13'], acceptDownloads: true }, '198.51.102.2']]) {
  const ctx = await browser.newContext(opts);
  await ctx.setExtraHTTPHeaders({ 'x-test-ip': ip });
  await ctx.route('https://www.youtube.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<body></body>' }));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.fill('#video-url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await p.locator('form button[type="submit"]').first().click();
  await p.getByRole('button', { name: /Make my revision pack/ }).waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: /Make my revision pack/ }).click();
  await p.getByText(/note points ·/).first().waitFor({ timeout: 30000 });

  // Flashcard: flip animation class, number, shortcuts
  await p.getByRole('button', { name: /Flashcards \(/ }).click();
  check(`[${label}] flashcard shows its number and flips with Space`, await p.locator('.card-flip').first().isVisible());
  await p.keyboard.press('Space');
  await p.getByText('Answer', { exact: true }).first().waitFor();
  await p.keyboard.press('3');
  await p.getByText(/Card 2 of/).waitFor();
  check(`[${label}] keyboard: Space flips, 3 grades Good and moves on`, true);
  await p.locator('.card-flip').first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: join(OUT, `${label}-flashcard.png`) });

  // Visuals
  await p.getByRole('button', { name: /^Visuals$/ }).click();
  const svg = p.locator('svg[aria-label^="Mind map"]');
  await svg.waitFor();
  const branches = await svg.locator('g[role="button"]').count();
  check(`[${label}] mind map renders one branch per note section`, branches >= 2 && branches <= 8, `${branches} branches`);
  const overflow = await svg.evaluate((el) => { const vb = el.viewBox.baseVal; return [...el.querySelectorAll('rect')].some((r) => { const b = r.getBBox(); return b.x < 0 || b.x + b.width > vb.width + 0.5 || b.y + b.height > vb.height + 0.5; }); });
  check(`[${label}] mind map shapes stay inside the canvas`, !overflow);
  await svg.scrollIntoViewIfNeeded();
  await p.screenshot({ path: join(OUT, `${label}-mindmap.png`) });
  await svg.locator('g[role="button"]').first().click();
  await p.locator('iframe[title="Lecture video player"]').waitFor();
  check(`[${label}] tapping a branch opens the lecture at its timestamp`, /start=\d+/.test((await p.locator('iframe[title="Lecture video player"]').getAttribute('src')) || ''));
  let [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Download mind map/ }).click()]);
  let f = join(OUT, `${label}-mindmap-export.png`); await dl.saveAs(f);
  const png = readFileSync(f);
  check(`[${label}] mind map PNG downloads as a real image`, png.subarray(1, 4).toString() === 'PNG' && statSync(f).size > 8000, `${(statSync(f).size / 1024).toFixed(0)} KB`);

  await p.getByRole('tab', { name: 'Sketchnotes' }).click();
  await p.getByText('Key lessons:').waitFor();
  check(`[${label}] sketchnotes show numbered lessons from the notes`, (await p.getByText('LearnFromClip sketchnotes').count()) === 1);
  await p.getByText('Key lessons:').scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(OUT, `${label}-sketchnotes.png`) });

  await p.getByRole('tab', { name: 'Card sheet' }).click();
  const sheet = p.locator('svg[aria-label^="Flashcard sheet"]');
  await sheet.waitFor();
  await sheet.scrollIntoViewIfNeeded();
  await p.screenshot({ path: join(OUT, `${label}-cardsheet.png`) });
  [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Download card sheet/ }).click()]);
  f = join(OUT, `${label}-sheet-export.png`); await dl.saveAs(f);
  check(`[${label}] card sheet PNG downloads as a real image`, readFileSync(f).subarray(1, 4).toString() === 'PNG' && statSync(f).size > 8000);
  check(`[${label}] no uncaught page errors`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
