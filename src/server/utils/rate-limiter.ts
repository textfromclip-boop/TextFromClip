import { sha256Hex } from './crypto';

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
  d1?: D1Database,
  /** When true and D1 is bound, the D1 counter (shared by all Worker isolates) is authoritative. */
  persist: boolean = true
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

  // 2. Shared counter in D1 so the limit holds across Worker isolates (raw IPs are never stored).
  if (d1 && persist) {
    try {
      const windowStart = Math.floor(now / 1000);
      const keyHash = (await sha256Hex(`rl:${ip}`)).slice(0, 40);
      const row = await d1.prepare(`
        INSERT INTO rate_limits (ip_hash, request_count, window_start)
        VALUES (?1, 1, ?2)
        ON CONFLICT(ip_hash) DO UPDATE SET
          request_count = CASE
            WHEN window_start <= ?2 - ?3 THEN 1
            ELSE request_count + 1
          END,
          window_start = CASE
            WHEN window_start <= ?2 - ?3 THEN ?2
            ELSE window_start
          END
        RETURNING request_count, window_start
      `).bind(keyHash, windowStart, windowSeconds).first<any>();
      const sharedCount = Number(row?.request_count || 0);
      if (sharedCount > maxRequests) {
        const reset = Math.max(1, Number(row.window_start) + windowSeconds - windowStart);
        return { allowed: false, remaining: 0, resetInSeconds: reset };
      }
      return {
        allowed: true,
        remaining: Math.max(0, Math.min(remaining, maxRequests - sharedCount)),
        resetInSeconds,
      };
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

