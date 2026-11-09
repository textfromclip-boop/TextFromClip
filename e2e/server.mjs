// Local end-to-end server: the REAL Hono API (bundled from src/server/index.ts) running against a
// REAL local D1 + R2 (wrangler getPlatformProxy, migrations applied), with ONLY the external
// services mocked: Workers AI (LLM + Whisper) and YouTube caption fetching (seeded cache).
// Usage: node e2e/server.mjs [port]
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';

const PORT = Number(process.argv[2] || 8799);
const ROOT = new URL('..', import.meta.url).pathname;

await build({
  entryPoints: [join(ROOT, 'src/server/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: join(ROOT, 'e2e/.build/app.mjs'),
  logLevel: 'error',
});
const { default: app } = await import(join(ROOT, 'e2e/.build/app.mjs') + `?t=${Date.now()}`);
const quotas = await import(join(ROOT, 'e2e/.build/app.mjs') + `?t=${Date.now()}`);
void quotas;

const proxy = await getPlatformProxy({
  configPath: join(ROOT, 'e2e/wrangler.e2e.toml'),
  persist: { path: join(ROOT, '.wrangler/e2e/v3') },
});

// ---- Seed: a cached YouTube lecture transcript (YouTube itself is not reachable from the sandbox)
export const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';
const LECTURE_LINES = [
  'Welcome back everyone, today we are talking about cellular respiration.',
  'Cellular respiration is the process cells use to turn glucose into usable energy.',
  'The first stage is glycolysis, which happens in the cytoplasm of the cell.',
  'Glycolysis splits one glucose molecule into two molecules of pyruvate.',
  'It produces a net gain of two ATP molecules and two NADH molecules.',
  'Next, pyruvate moves into the mitochondria for the Krebs cycle.',
  'The Krebs cycle takes place in the mitochondrial matrix.',
  'Each turn of the Krebs cycle releases carbon dioxide as a waste product.',
  'The electron transport chain sits in the inner mitochondrial membrane.',
  'Oxygen is the final electron acceptor and combines with hydrogen to form water.',
  'Oxidative phosphorylation produces about thirty four ATP molecules.',
  'Without oxygen, cells switch to fermentation, which yields far less ATP.',
  'In muscle cells, fermentation produces lactic acid during intense exercise.',
  'Yeast cells use alcoholic fermentation and release ethanol and carbon dioxide.',
  'Remember that ATP is the energy currency of the cell.',
  'For the exam, know where each stage happens and how much ATP it makes.',
];
const segments = [];
for (let i = 0; i < 48; i++) {
  segments.push({ id: i + 1, start: i * 37.5, duration: 7, text: LECTURE_LINES[i % LECTURE_LINES.length] });
}
const seeded = {
  id: 'e2e-seed', provider: 'youtube', videoId: DEMO_VIDEO_ID, videoTitle: 'Biology 101: Cellular Respiration',
  videoDurationSeconds: 1800, channelTitle: 'Demo University', sourceType: 'captions', language: 'en',
  segments, fullText: segments.map((s) => s.text).join(' '), srt: '', vtt: '', createdAt: Date.now(),
};
{
  const { generateSrt, generateVtt } = await import(join(ROOT, 'e2e/.build/formatters.mjs')).catch(async () => {
    await build({ entryPoints: [join(ROOT, 'src/server/utils/formatters.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(ROOT, 'e2e/.build/formatters.mjs'), logLevel: 'error' });
    return import(join(ROOT, 'e2e/.build/formatters.mjs'));
  });
  seeded.srt = generateSrt(segments);
  seeded.vtt = generateVtt(segments);
  const db = proxy.env.DB;
  const now = Math.floor(Date.now() / 1000);
  for (const lang of ['en']) {
    await db
      .prepare(`INSERT OR REPLACE INTO cached_transcripts (cache_key, provider, video_id, language, duration_seconds, transcript_hash, payload_json, hit_count, created_at, updated_at) VALUES (?1,'youtube',?2,?3,1800,'seed',?4,0,?5,?5)`)
      .bind(`youtube:${DEMO_VIDEO_ID}:${lang}`, DEMO_VIDEO_ID, lang, JSON.stringify(seeded), now)
      .run();
  }
}

// ---- Mock Workers AI: an LLM that behaves like a decent model (verbatim quotes from the prompt,
// one fabricated item per chunk that the verifier must drop, one AI explanation), plus Whisper.
const TRANSLATIONS = {
  Arabic: (t) => `ترجمة: ${t}`,
  Spanish: (t) => `Traducción: ${t}`,
};
const mockAi = {
  async run(model, input) {
    if (model.includes('whisper')) {
      const words = ['In', 'this', 'recorded', 'lecture', 'we', 'review', 'photosynthesis', 'and', 'the', 'light', 'reactions', 'in', 'detail'];
      const segs = [];
      for (let i = 0; i < 6; i++) segs.push({ start: i * 5, end: i * 5 + 4.5, text: ` Part ${i + 1}: ${words.join(' ')} for the exam number ${i + 1}.` });
      return { text: segs.map((s) => s.text).join(''), segments: segs, transcription_info: { language: 'en' } };
    }
    const msgs = input.messages || [];
    const sys = msgs[0]?.content || '';
    const user = msgs[msgs.length - 1]?.content || '';
    if (sys.startsWith('Translate each flashcard')) {
      const lang = (sys.match(/into natural, accurate (\w+)/) || [])[1] || 'Arabic';
      const arr = JSON.parse(user);
      return { response: JSON.stringify(arr.map((c) => ({ idx: c.idx, front_translation: (TRANSLATIONS[lang] || ((t) => `[${lang}] ${t}`))(c.front), back_translation: (TRANSLATIONS[lang] || ((t) => `[${lang}] ${t}`))(c.back) }))) };
    }
    if (sys.includes('strict JSON revision pack')) {
      const lines = [...user.matchAll(/\[(\d+)s \| [^\]]+\] (.+)/g)].map((m) => ({ s: Number(m[1]), t: m[2] }));
      const lang = (sys.match(/BILINGUAL FLASHCARDS REQUIRED \((\w+)\)/) || [])[1];
      const tr = lang ? TRANSLATIONS[lang] || ((t) => `[${lang}] ${t}`) : null;
      const quote = (l) => l.t.replace(/[.,]$/, '').split(' ').slice(0, 9).join(' ');
      const notes = [
        { heading: 'Stages of cellular respiration', bullets: lines.slice(0, 6).map((l, i) => ({ text: l.t, is_definition: i === 1, term: i === 1 ? 'Cellular respiration' : undefined, source: { start_seconds: l.s, end_seconds: l.s + 7, quote: quote(l) }, ...(i === 2 ? { ai_explanation: 'Glycolysis does not need oxygen, which is why it also runs during fermentation.' } : {}) })) },
        { heading: 'Made-up section', bullets: [{ text: 'The Krebs cycle was discovered on Mars.', source: { start_seconds: 10, end_seconds: 20, quote: 'the krebs cycle was discovered on mars by astronauts' } }] },
      ];
      const flashcards = lines.slice(0, 16).map((l, i) => ({
        front: `What does the lecturer say about point ${i + 1}: “${l.t.split(' ').slice(0, 4).join(' ')}…”?`,
        back: l.t,
        ...(tr ? { front_translation: tr(`Question ${i + 1}`), back_translation: tr(l.t) } : {}),
        source: { start_seconds: l.s, end_seconds: l.s + 7, quote: quote(l) },
      }));
      flashcards.push({ front: 'Fabricated?', back: 'Yes', source: { start_seconds: 5, end_seconds: 9, quote: 'mitochondria are made of chocolate and sugar' } });
      const quiz = lines.slice(0, 6).map((l, i) => ({
        question: `According to the lecture at ${Math.floor(l.s / 60)} minutes, which statement is correct (${i + 1})?`,
        options: [l.t, 'Glycolysis happens in the nucleus.', 'ATP is stored in the cell wall.', 'Fermentation needs oxygen.'].map((o, k, arr) => arr[(k + i) % 4]),
        correct_index: (4 - (i % 4)) % 4,
        explanation: 'This is what the lecturer states at this timestamp.',
        source: { start_seconds: l.s, end_seconds: l.s + 7, quote: quote(l) },
      }));
      return { response: JSON.stringify({ notes, flashcards, quiz }) };
    }
    // Generic transform / translate
    return { response: `Summary\n\n• ${user.slice(0, 300)}` };
  },
};

const env = {
  ...proxy.env,
  AI: mockAi,
  ENVIRONMENT: 'development',
  COOKIE_SECRET: 'e2e-cookie-secret-0123456789abcdefghijkl',
  ADMIN_TOKEN: 'e2e-admin-token-0123456789abcdef',
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serveStatic(pathname) {
  const dist = join(ROOT, 'dist');
  let file = join(dist, pathname);
  if (pathname === '/' ) file = join(dist, 'index.html');
  else if (!extname(pathname) && existsSync(file + '.html')) file = file + '.html';
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  return { body: readFileSync(file), type: MIME[extname(file)] || 'application/octet-stream' };
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/robots.txt' && url.pathname !== '/sitemap.xml') {
        const { body, type } = serveStatic(url.pathname);
        // Cloudflare compresses text assets in production; mirror that so Lighthouse is realistic.
        if (/gzip/.test(req.headers['accept-encoding'] || '') && /text|javascript|json|svg/.test(type)) {
          res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', 'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
          return res.end(gzipSync(body));
        }
        res.writeHead(200, { 'content-type': type });
        return res.end(body);
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      headers.set('cf-connecting-ip', req.headers['x-test-ip'] || '203.0.113.7');
      const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const response = await app.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
      const out = Buffer.from(await response.arrayBuffer());
      const h = {};
      response.headers.forEach((v, k) => {
        if (k !== 'set-cookie') h[k] = v;
      });
      const cookies = response.headers.getSetCookie?.() || [];
      if (cookies.length) h['set-cookie'] = cookies;
      res.writeHead(response.status, h);
      res.end(out);
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(String(err));
    }
  })
  .listen(PORT, () => console.log(`E2E server on http://localhost:${PORT}`));
