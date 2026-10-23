import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Vite plugin to run the Hono API handler locally in development
function honoDevPlugin(): Plugin {
  return {
    name: 'hono-dev-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (
          req.url?.startsWith('/api') ||
          req.url === '/robots.txt' ||
          req.url === '/sitemap.xml'
        ) {
          try {
            // Dynamically import the Hono app
            const { default: app } = await server.ssrLoadModule('/src/server/index.ts');
            
            // Build web Fetch Request from Node HTTP request
            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const host = req.headers.host || 'localhost:5173';
            const fullUrl = `${protocol}://${host}${req.url}`;
            
            // Read body if method has body
            let bodyBuffer: Buffer | null = null;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              const chunks: Buffer[] = [];
              for await (const chunk of req) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
              }
              bodyBuffer = Buffer.concat(chunks);
            }

            const fetchHeaders = new Headers();
            for (const [key, val] of Object.entries(req.headers)) {
              if (val !== undefined) {
                if (Array.isArray(val)) {
                  val.forEach((v) => fetchHeaders.append(key, v));
                } else {
                  fetchHeaders.set(key, val);
                }
              }
            }

            const fetchReq = new Request(fullUrl, {
              method: req.method,
              headers: fetchHeaders,
              body: bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer : undefined,
            });

            // Pass Cloudflare bindings and optional env vars for local development
            const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
            const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
            const localAiBinding =
              cfAccountId && cfApiToken
                ? {
                    async run(model: string, input: { audio: number[] }) {
                      const r = await fetch(
                        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${model}`,
                        {
                          method: 'POST',
                          headers: {
                            Authorization: `Bearer ${cfApiToken}`,
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify(input),
                        }
                      );
                      const json: any = await r.json();
                      if (!r.ok || !json?.success) {
                        throw new Error(
                          json?.errors?.[0]?.message || `Cloudflare Workers AI HTTP ${r.status}`
                        );
                      }
                      return json.result;
                    },
                  }
                : undefined;

            const mockEnv = {
              ENVIRONMENT: 'development',
              MAX_REQUESTS_PER_MINUTE: '60',
              MAX_VIDEO_DURATION_SECONDS: '14400',
              CACHE_TTL_SECONDS: '86400',
              AI: localAiBinding,
              IG_SESSION_ID: process.env.IG_SESSION_ID,
              EXTERNAL_WHISPER_URL: process.env.EXTERNAL_WHISPER_URL,
            };

            const fetchRes = await app.fetch(fetchReq, mockEnv);

            // Send response back through Node HTTP response
            res.statusCode = fetchRes.status;
            fetchRes.headers.forEach((val, key) => {
              res.setHeader(key, val);
            });

            const arrayBuf = await fetchRes.arrayBuffer();
            res.end(Buffer.from(arrayBuf));
            return;
          } catch (err: any) {
            console.error('API Dev Server error:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message || 'Internal Dev Error' }));
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), honoDevPlugin()],
  server: {
    port: 5173,
    host: true,
  },
});

