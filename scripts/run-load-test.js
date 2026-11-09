/**
 * Standalone load test runner
 * Run via: node scripts/run-load-test.js [targetUrl] [vus] [durationSeconds]
 */

const targetUrl = process.argv[2] || 'http://localhost:5173';
const concurrentUsers = parseInt(process.argv[3] || '50', 10);
const durationSeconds = parseInt(process.argv[4] || '5', 10);

console.log(`\n======================================================`);
console.log(`LearnFromClip Concurrency Load Test Runner`);
console.log(`Target: ${targetUrl}`);
console.log(`Simulated Concurrent Users: ${concurrentUsers}`);
console.log(`Duration: ${durationSeconds}s`);
console.log(`======================================================\n`);

async function main() {
  const sampleEndpoints = [
    { method: 'GET', path: '/api/health' },
    { method: 'GET', path: '/api/platforms' },
    {
      method: 'POST',
      path: '/api/transcript',
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }),
    },
    {
      method: 'POST',
      path: '/api/transcript',
      body: JSON.stringify({ url: 'http://127.0.0.1/block-me' }), // SSRF test
    },
  ];

  let totalRequests = 0;
  let successfulRequests = 0;
  let rateLimited = 0;
  let failures = 0;
  const statusCodes = {};
  const latencies = [];

  const stopTime = Date.now() + durationSeconds * 1000;

  async function virtualUser(id) {
    while (Date.now() < stopTime) {
      const target = sampleEndpoints[Math.floor(Math.random() * sampleEndpoints.length)];
      const start = performance.now();
      totalRequests++;

      try {
        const res = await fetch(`${targetUrl}${target.path}`, {
          method: target.method,
          headers: {
            'Content-Type': 'application/json',
            'X-Virtual-User': `vu-${id}`,
          },
          body: target.body,
        });

        const dur = performance.now() - start;
        latencies.push(dur);
        statusCodes[res.status] = (statusCodes[res.status] || 0) + 1;

        if (res.status === 429) {
          rateLimited++;
        } else if (res.ok || res.status === 400 || res.status === 422) {
          successfulRequests++;
        } else {
          failures++;
        }
      } catch (err) {
        failures++;
      }

      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const startTime = Date.now();
  const vus = Array.from({ length: concurrentUsers }, (_, i) => virtualUser(i + 1));
  await Promise.all(vus);
  const totalElapsed = (Date.now() - startTime) / 1000;

  latencies.sort((a, b) => a - b);
  const p = (pct) => (latencies[Math.floor((pct / 100) * latencies.length)] || 0).toFixed(2);
  const avg = (latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(2);
  const qps = (totalRequests / totalElapsed).toFixed(2);

  console.log(`\n--- Test Results Summary ---`);
  console.log(`Duration:           ${totalElapsed.toFixed(2)}s`);
  console.log(`Total Requests:     ${totalRequests}`);
  console.log(`Requests/sec (QPS): ${qps}`);
  console.log(`Successful:         ${successfulRequests}`);
  console.log(`Rate-limited (429): ${rateLimited}`);
  console.log(`Server Errors (5xx):${failures}`);
  console.log(`Status Codes:       ${JSON.stringify(statusCodes)}`);
  console.log(`Latency Avg:        ${avg} ms`);
  console.log(`Latency p50:        ${p(50)} ms`);
  console.log(`Latency p90:        ${p(90)} ms`);
  console.log(`Latency p99:        ${p(99)} ms`);
  console.log(`======================================================\n`);
}

main().catch(console.error);

