/**
 * TextFromClip Concurrency & Load Testing Script
 * Simulates browsing, platform discovery, transcript submissions, and error cases
 * Designed to model workloads up to 20,000 concurrent active users (CAU)
 */

interface LoadTestOptions {
  baseUrl: string;
  concurrentUsers: number;
  durationSeconds: number;
  requestIntervalMs: number;
}

interface TestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  statusCodes: Record<number, number>;
  latencies: number[];
  startTime: number;
  endTime: number;
}

export async function runLoadTest(options: LoadTestOptions): Promise<TestMetrics> {
  const { baseUrl, concurrentUsers, durationSeconds, requestIntervalMs } = options;

  console.log(`[LoadTest] Starting simulation with ${concurrentUsers} virtual users for ${durationSeconds}s against ${baseUrl}...`);

  const metrics: TestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
    statusCodes: {},
    latencies: [],
    startTime: Date.now(),
    endTime: 0,
  };

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
      body: JSON.stringify({ url: 'https://invalid-destination.internal/video' }), // intentional rejection test
    },
  ];

  const stopTime = Date.now() + durationSeconds * 1000;

  async function virtualUser(id: number) {
    while (Date.now() < stopTime) {
      // Pick random action
      const target = sampleEndpoints[Math.floor(Math.random() * sampleEndpoints.length)];
      const reqStart = performance.now();

      try {
        metrics.totalRequests++;
        const res = await fetch(`${baseUrl}${target.path}`, {
          method: target.method,
          headers: {
            'Content-Type': 'application/json',
            'X-Virtual-User': `vu-${id}`,
          },
          body: target.body,
        });

        const reqDuration = performance.now() - reqStart;
        metrics.latencies.push(reqDuration);

        metrics.statusCodes[res.status] = (metrics.statusCodes[res.status] || 0) + 1;

        if (res.status === 429) {
          metrics.rateLimitedRequests++;
        } else if (res.ok || res.status === 400 || res.status === 422) {
          // Expected 2xx or handled 4xx business rejections count as normal handled traffic
          metrics.successfulRequests++;
        } else {
          metrics.failedRequests++;
        }
      } catch (err) {
        metrics.failedRequests++;
        metrics.statusCodes[0] = (metrics.statusCodes[0] || 0) + 1;
      }

      await new Promise((resolve) => setTimeout(resolve, requestIntervalMs));
    }
  }

  // Launch virtual user workers
  const workers = Array.from({ length: concurrentUsers }, (_, idx) => virtualUser(idx + 1));
  await Promise.all(workers);

  metrics.endTime = Date.now();
  return metrics;
}

// Format percentile latencies
export function calculatePercentiles(latencies: number[]) {
  if (latencies.length === 0) return { p50: 0, p90: 0, p95: 0, p99: 0, avg: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const getP = (p: number) => sorted[Math.floor((p / 100) * sorted.length)] || 0;
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    p50: getP(50).toFixed(2),
    p90: getP(90).toFixed(2),
    p95: getP(95).toFixed(2),
    p99: getP(99).toFixed(2),
    avg: (sum / sorted.length).toFixed(2),
  };
}
