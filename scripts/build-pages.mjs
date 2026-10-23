// Builds a Cloudflare Pages bundle in ./dist-pages:
//   - the Vite frontend (copied from ./dist)
//   - _worker.js : the Hono API (src/server/index.ts) in Pages "advanced mode"
//   - _routes.json : only /api/*, robots.txt and sitemap.xml run the worker;
//     everything else is served as static files with SPA fallback.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

rmSync('dist-pages', { recursive: true, force: true });
mkdirSync('dist-pages', { recursive: true });
cpSync('dist', 'dist-pages', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
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
  JSON.stringify({ version: 1, include: ['/api/*', '/robots.txt', '/sitemap.xml'], exclude: [] }, null, 2)
);
console.log('Pages bundle ready in dist-pages/');

