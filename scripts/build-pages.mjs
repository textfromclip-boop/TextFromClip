// Builds a Cloudflare Pages bundle in ./dist-pages:
//   - the Vite frontend (copied from ./dist)
//   - _worker.js : the Hono API (src/server/index.ts) in Pages "advanced mode"
//   - _routes.json : excludes /assets/* so static assets are served directly from cache;
//     everything else invokes _worker.js.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

// 1. Per-route HTML with a unique <title>, description, canonical and og tags, so direct loads,
//    crawlers and link previews of every SEO page see the right metadata (the SPA then hydrates).
//    Cloudflare Pages / Workers assets serve /lecture-to-notes from lecture-to-notes.html.
{
  const metaBundle = await build({
    entryPoints: ['src/seo/routeMeta.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
  });
  const mod = await import(
    'data:text/javascript;base64,' + Buffer.from(metaBundle.outputFiles[0].text).toString('base64')
  );
  const { ROUTE_META, canonicalUrlFor } = mod;
  const baseHtml = readFileSync('dist/index.html', 'utf8');
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  let written = 0;
  for (const [path, meta] of Object.entries(ROUTE_META)) {
    const canonical = canonicalUrlFor(path);
    const html = baseHtml
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`)
      .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(meta.description)}" />`)
      .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonical}" />`)
      .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonical}" />`)
      .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(meta.title)}" />`)
      .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(meta.description)}" />`)
      .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(meta.title)}" />`)
      .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(meta.description)}" />`);
    if (!html.includes(`<title>${esc(meta.title)}</title>`) || !html.includes(`href="${canonical}"`)) {
      throw new Error(`SEO prerender failed for ${path}: index.html tags not found`);
    }
    writeFileSync(path === '/' ? 'dist/index.html' : `dist${path}.html`, html);
    written++;
  }
  console.log(`SEO: wrote ${written} route HTML files with unique title/description/canonical`);
}

rmSync('dist-pages', { recursive: true, force: true });
mkdirSync('dist-pages', { recursive: true });
cpSync('dist', 'dist-pages', { recursive: true });

const entryCode = `
import app from './src/server/index.ts';

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  }
};
`;

await build({
  stdin: {
    contents: entryCode,
    resolveDir: process.cwd(),
    sourcefile: 'pages-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  target: 'es2022',
  outfile: 'dist-pages/_worker.js',
  external: ['node:*'],
  logLevel: 'info',
});

writeFileSync(
  'dist-pages/_routes.json',
  JSON.stringify(
    {
      version: 1,
      include: ['/api/*', '/robots.txt', '/sitemap.xml'],
      exclude: [],
    },
    null,
    2
  )
);
console.log('Pages bundle ready in dist-pages/');
