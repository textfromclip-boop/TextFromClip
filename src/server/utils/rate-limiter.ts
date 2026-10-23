/**
 * Rate Limiter for Cloudflare Workers
 * Uses in-memory sliding counters with D1 support for multi-instance rate tracking
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory cache for fast local checking within Worker isolates
const memoryCache = new Map<string, RateLimitRecord>();

// Clean old in-memory records periodically
function cleanupMemoryCache() {
  const now = Date.now();
  for (const [key, record] of memoryCache.entries()) {
    if (record.resetAt <= now) {
      memoryCache.delete(key);
    }
  }
}

export async function checkRateLimit(
  ip: string,
  maxRequests: number = 30,
  windowSeconds: number = 60,
  d1?: D1Database
): Promise<{ allowed: boolean; remaining: number; resetInSeconds: number }> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  
  // Clean expired keys if map is getting large
  if (memoryCache.size > 2000) {
    cleanupMemoryCache();
  }

  // 1. Check in-memory fast path
  let record = memoryCache.get(ip);
  if (!record || record.resetAt <= now) {
    record = { count: 1, resetAt: now + windowMs };
    memoryCache.set(ip, record);
  } else {
    record.count++;
  }

  const remaining = Math.max(0, maxRequests - record.count);
  const resetInSeconds = Math.ceil((record.resetAt - now) / 1000);

  if (record.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds,
    };
  }

  // 2. If D1 is available, asynchronously record rate limit state for multi-region consistency
  if (d1) {
    try {
      const windowStart = Math.floor(now / 1000);
      await d1.prepare(`
        INSERT INTO rate_limits (ip_hash, request_count, window_start)
        VALUES (?1, 1, ?2)
        ON CONFLICT(ip_hash) DO UPDATE SET 
          request_count = CASE 
            WHEN window_start < ?2 - ?3 THEN 1 
            ELSE request_count + 1 
          END,
          window_start = CASE 
            WHEN window_start < ?2 - ?3 THEN ?2 
            ELSE window_start 
          END
      `).bind(ip, windowStart, windowSeconds).run();
    } catch (e) {
      // Non-blocking fallback to in-memory rate limiting
      console.warn('D1 rate limiter fallback:', e);
    }
  }

  return {
    allowed: true,
    remaining,
    resetInSeconds,
  };
}

