// Builds a Cloudflare Pages bundle in ./dist-pages:
//   - the Vite frontend (copied from ./dist)
//   - _worker.js : the Hono API (src/server/index.ts) in Pages "advanced mode"
//   - _routes.json : excludes /assets/* so static assets are served directly from cache;
//     everything else invokes _worker.js.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

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
      include: ['/*'],
      exclude: ['/assets/*', '/manifest.json', '/favicon.ico'],
    },
    null,
    2
  )
);
console.log('Pages bundle ready in dist-pages/');
