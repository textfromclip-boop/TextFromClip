// Regression checks for the original TextFromClip tools inside LearnFromClip:
// transcript edit, search, timestamp toggle, copy, TXT/SRT/VTT export, translation, AI formats.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8799';
const OUT = new URL('./artifacts/regression/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.setExtraHTTPHeaders({ 'x-test-ip': '198.51.100.41' });
await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.fill('#video-url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
await page.locator('form button[type="submit"]').first().click();
await page.getByRole('button', { name: /Make my revision pack/ }).waitFor({ timeout: 20000 });
await page.waitForTimeout(1000);

// Timestamps visible, then toggled off
check('timestamps shown by default', await page.getByText('00:37', { exact: true }).first().isVisible());
await page.getByRole('button', { name: /Timestamps/ }).first().click();
await page.waitForTimeout(300);
check('timestamp toggle hides timestamps', !(await page.getByText('00:37', { exact: true }).first().isVisible().catch(() => false)));
await page.getByRole('button', { name: /Timestamps/ }).first().click();

// Search
await page.fill('input[placeholder*="Search"]', 'fermentation');
await page.waitForTimeout(300);
const marks = await page.locator('mark').count();
check('search highlights matches', marks > 0, `${marks} highlights`);
await page.fill('input[placeholder*="Search"]', '');

// Copy
await page.getByRole('button', { name: /^Copy$/ }).first().click();
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('copy puts transcript on clipboard', /cellular respiration/i.test(clip), `${clip.length} chars`);

// Downloads TXT / SRT / VTT
for (const [label, ext, re] of [
  ['Plain Text (.TXT)', 'txt', /Welcome back everyone/],
  ['SubRip Subtitles (.SRT)', 'srt', /^1\r?\n00:00:00,000 --> 00:00:07,000/m],
  ['WebVTT Subtitles (.VTT)', 'vtt', /^WEBVTT/],
]) {
  await page.getByRole('button', { name: /^Download$/ }).first().click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: new RegExp(label.replace(/[().]/g, '\\$&')) }).click()]);
  const f = join(OUT, `transcript.${ext}`);
  await dl.saveAs(f);
  check(`export ${ext.toUpperCase()}`, re.test(readFileSync(f, 'utf8')));
}

// Edit: change a line, then the TXT export contains the edit
await page.getByRole('button', { name: /^Edit$/ }).first().click();
const firstLine = page.locator('input[value^="Welcome back everyone"]').first();
check('edit mode opens per-line editors', await firstLine.isVisible());
await firstLine.fill('Welcome back everyone, EDITED LINE about cellular respiration.');
await page.screenshot({ path: join(OUT, 'edit-mode.png') });
await page.getByRole('button', { name: /Done Editing/ }).click();
await page.getByRole('button', { name: /^Download$/ }).first().click();
{
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Plain Text \(\.TXT\)/ }).click()]);
  const f = join(OUT, 'transcript-edited.txt');
  await dl.saveAs(f);
  check('edited text is used in exports', /EDITED LINE/.test(readFileSync(f, 'utf8')));
}

// AI formats (mock model)
const transformResp = page.waitForResponse((r) => r.url().includes('/api/transform'));
await page.getByRole('button', { name: /Transform with AI/ }).click();
await page.getByText('Executive Summary').first().click();
const tr = await transformResp;
check('AI format (summary) returns a result', tr.status() === 200, `HTTP ${tr.status()}`);
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'ai-format.png') });

// Translation (7 required languages listed)
await page.getByRole('button', { name: /Translate to/ }).click();
const langs = ['Arabic', 'Spanish', 'French', 'German', 'Turkish', 'Portuguese', 'Hindi'];
const visible = [];
for (const l of langs) if (await page.getByRole('button', { name: new RegExp(`^${l}`) }).first().isVisible().catch(() => false)) visible.push(l);
check('translation offers Arabic, Spanish, French, German, Turkish, Portuguese, Hindi', visible.length === 7, visible.join(','));
const trResp = page.waitForResponse((r) => r.url().includes('/api/translate'));
await page.getByRole('button', { name: /^Arabic/ }).first().click();
const t = await trResp;
check('translation request succeeds (mock model)', t.status() === 200, `HTTP ${t.status()}`);
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'translation.png') });

const usage = await (await page.request.get(BASE + '/api/usage', { headers: { 'x-test-ip': '198.51.100.41' } })).json();
check('AI format + translation each cost 1 AI action (server-side)', usage.data.aiActionsUsed === 2, `${usage.data.aiActionsUsed} used`);

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
