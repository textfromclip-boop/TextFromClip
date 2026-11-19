// Cookieless visit analytics for the private admin dashboard.
// Stores: time, page, country, city, referring site, device type, browser, OS and a daily-rotating
// visitor hash. Never stores IP addresses or anything that identifies a person across days.
import { sha256Hex } from './crypto';
import { getDailyCostReport } from './quotasAndCache';
import { getAiBudgetStatus } from './aiBudget';

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|monitor|curl|wget|python-requests|httpclient|axios|node-fetch|go-http|java\//i;

export function isBotUserAgent(ua: string): boolean {
  return !ua || BOT_UA.test(ua);
}

export function parseUserAgent(ua: string): { device: string; browser: string; os: string } {
  const s = ua || '';
  const device = /ipad|tablet|(android(?!.*mobile))/i.test(s)
    ? 'Tablet'
    : /mobi|iphone|ipod|android/i.test(s)
    ? 'Mobile'
    : 'Desktop';
  const browser = /edg\//i.test(s)
    ? 'Edge'
    : /opr\/|opera/i.test(s)
    ? 'Opera'
    : /samsungbrowser/i.test(s)
    ? 'Samsung Internet'
    : /firefox|fxios/i.test(s)
    ? 'Firefox'
    : /chrome|crios/i.test(s)
    ? 'Chrome'
    : /safari/i.test(s)
    ? 'Safari'
    : 'Other';
  const os = /windows/i.test(s)
    ? 'Windows'
    : /iphone|ipad|ipod/i.test(s)
    ? 'iOS'
    : /android/i.test(s)
    ? 'Android'
    : /mac os x|macintosh/i.test(s)
    ? 'macOS'
    : /cros/i.test(s)
    ? 'ChromeOS'
    : /linux/i.test(s)
    ? 'Linux'
    : 'Other';
  return { device, browser, os };
}

/** "google.com" from a referrer URL; null for same-site or invalid referrers. */
export function referrerSource(referrer: unknown, ownHost: string): string | null {
  if (typeof referrer !== 'string' || !referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (!host || host === ownHost.toLowerCase().replace(/^www\./, '')) return null;
    return host.slice(0, 80);
  } catch {
    return null;
  }
}

const PATH_RE = /^\/[a-z0-9\-\/]{0,80}$/i;

export interface PageViewInput {
  path: unknown;
  referrer?: unknown;
  utmSource?: unknown;
  userAgent: string;
  ip: string;
  country?: string | null;
  city?: string | null;
  ownHost: string;
  salt: string;
  now?: Date;
}

export async function recordPageView(input: PageViewInput, db?: D1Database): Promise<boolean> {
  if (!db) return false;
  if (typeof input.path !== 'string' || !PATH_RE.test(input.path)) return false;
  if (isBotUserAgent(input.userAgent)) return false;
  const now = input.now || new Date();
  const utcDate = now.toISOString().slice(0, 10);
  const { device, browser, os } = parseUserAgent(input.userAgent);
  const utm =
    typeof input.utmSource === 'string' && /^[a-z0-9._\-]{1,40}$/i.test(input.utmSource)
      ? input.utmSource.toLowerCase()
      : null;
  const referrer = utm || referrerSource(input.referrer, input.ownHost);
  const country = typeof input.country === 'string' && /^[A-Z]{2}$/.test(input.country) && input.country !== 'XX' ? input.country : null;
  const city = typeof input.city === 'string' ? input.city.slice(0, 60) : null;
  const visitorHash = (
    await sha256Hex(`visit:${utcDate}:${input.ip}:${input.userAgent.slice(0, 300)}:${input.salt}`)
  ).slice(0, 20);
  const path = input.path.length > 1 ? input.path.replace(/\/+$/, '') : input.path;
  try {
    await db
      .prepare(
        `INSERT INTO page_views (created_at, utc_date, path, country, city, referrer, device, browser, os, visitor_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      )
      .bind(Math.floor(now.getTime() / 1000), utcDate, path, country, city, referrer, device, browser, os, visitorHash)
      .run();
    return true;
  } catch (err) {
    console.warn('[LearnFromClip] page view not recorded:', err);
    return false;
  }
}

export const VISIT_RETENTION_DAYS = 90;

function utcDateDaysAgo(days: number, now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function all<T = any>(db: D1Database, sql: string, ...binds: any[]): Promise<T[]> {
  try {
    const res = await db.prepare(sql).bind(...binds).all<T>();
    return (res.results || []) as T[];
  } catch (err) {
    console.warn('[LearnFromClip] admin query failed:', String((err as any)?.message || err));
    return [];
  }
}

async function first<T = any>(db: D1Database, sql: string, ...binds: any[]): Promise<T | null> {
  const rows = await all<T>(db, sql, ...binds);
  return rows[0] || null;
}

/** Everything the admin dashboard shows, for the last `days` days (1 = today only). */
export async function getAdminDashboardData(env: any, db: D1Database | undefined, days: number) {
  const range = Math.min(90, Math.max(1, Math.floor(days) || 1));
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fromDate = utcDateDaysAgo(range - 1, now);
  const nowSec = Math.floor(now.getTime() / 1000);
  const budget = await getAiBudgetStatus(env, db);
  const aiToday = await getDailyCostReport(today, db);

  if (!db) {
    return { generatedAt: now.toISOString(), range: { days: range, from: fromDate, to: today }, hasDatabase: false, budget, aiToday };
  }

  // Retention: drop visits older than 90 days (cheap; indexed).
  try {
    await db.prepare(`DELETE FROM page_views WHERE created_at < ?1`).bind(nowSec - VISIT_RETENTION_DAYS * 86400).run();
  } catch {
    // table may not exist yet
  }

  const totals = await first<{ views: number; visitors: number }>(
    db,
    `SELECT COUNT(*) AS views, COUNT(DISTINCT utc_date || visitor_hash) AS visitors FROM page_views WHERE utc_date >= ?1`,
    fromDate
  );
  const todayTotals = await first<{ views: number; visitors: number }>(
    db,
    `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors FROM page_views WHERE utc_date = ?1`,
    today
  );
  const liveNow = await first<{ visitors: number }>(
    db,
    `SELECT COUNT(DISTINCT visitor_hash) AS visitors FROM page_views WHERE created_at >= ?1`,
    nowSec - 5 * 60
  );
  const perDay = await all(
    db,
    `SELECT utc_date AS day, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
     FROM page_views WHERE utc_date >= ?1 GROUP BY utc_date ORDER BY utc_date`,
    utcDateDaysAgo(Math.max(range, 14) - 1, now)
  );
  const countries = await all(
    db,
    `SELECT COALESCE(country, '??') AS country, COUNT(DISTINCT utc_date || visitor_hash) AS visitors, COUNT(*) AS views
     FROM page_views WHERE utc_date >= ?1 GROUP BY 1 ORDER BY visitors DESC, views DESC LIMIT 60`,
    fromDate
  );
  const cities = await all(
    db,
    `SELECT city, COALESCE(country, '??') AS country, COUNT(DISTINCT utc_date || visitor_hash) AS visitors
     FROM page_views WHERE utc_date >= ?1 AND city IS NOT NULL AND city != '' GROUP BY 1, 2 ORDER BY visitors DESC LIMIT 25`,
    fromDate
  );
  const pages = await all(
    db,
    `SELECT path, COUNT(*) AS views, COUNT(DISTINCT utc_date || visitor_hash) AS visitors
     FROM page_views WHERE utc_date >= ?1 GROUP BY path ORDER BY views DESC LIMIT 30`,
    fromDate
  );
  const sources = await all(
    db,
    `SELECT COALESCE(referrer, 'Direct / unknown') AS source, COUNT(DISTINCT utc_date || visitor_hash) AS visitors
     FROM page_views WHERE utc_date >= ?1 GROUP BY 1 ORDER BY visitors DESC LIMIT 25`,
    fromDate
  );
  const devices = await all(
    db,
    `SELECT device AS name, COUNT(DISTINCT utc_date || visitor_hash) AS visitors FROM page_views WHERE utc_date >= ?1 GROUP BY 1 ORDER BY visitors DESC`,
    fromDate
  );
  const browsers = await all(
    db,
    `SELECT browser AS name, COUNT(DISTINCT utc_date || visitor_hash) AS visitors FROM page_views WHERE utc_date >= ?1 GROUP BY 1 ORDER BY visitors DESC LIMIT 10`,
    fromDate
  );
  const systems = await all(
    db,
    `SELECT os AS name, COUNT(DISTINCT utc_date || visitor_hash) AS visitors FROM page_views WHERE utc_date >= ?1 GROUP BY 1 ORDER BY visitors DESC LIMIT 10`,
    fromDate
  );
  const recent = await all(
    db,
    `SELECT created_at AS at, path, country, city, referrer, device, browser, os FROM page_views ORDER BY id DESC LIMIT 60`
  );

  const fromSec = Math.floor(Date.parse(`${fromDate}T00:00:00Z`) / 1000);
  const events = await all(
    db,
    `SELECT event_name AS name, COUNT(*) AS count FROM analytics_events WHERE created_at >= ?1 GROUP BY event_name ORDER BY count DESC`,
    fromSec
  );
  const aiPerDay = await all(
    db,
    `SELECT utc_date AS day, whisper_audio_seconds AS whisperSeconds, llm_input_tokens AS inTokens, llm_output_tokens AS outTokens,
            transcript_cache_hits AS txHits, transcript_cache_misses AS txMisses, pack_cache_hits AS packHits, pack_cache_misses AS packMisses
     FROM cost_telemetry WHERE utc_date >= ?1 ORDER BY utc_date`,
    utcDateDaysAgo(Math.max(range, 14) - 1, now)
  );
  const users = await first<{ total: number; recent: number }>(
    db,
    `SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ?1 THEN 1 ELSE 0 END) AS recent FROM users`,
    fromSec
  );
  const library = await first<{ transcripts: number; packs: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM cached_transcripts) AS transcripts, (SELECT COUNT(*) FROM cached_packs) AS packs`
  );
  const limitHitsToday = await first<{ actors: number }>(
    db,
    `SELECT COUNT(*) AS actors FROM daily_quotas WHERE utc_date = ?1 AND ai_actions_half_units >= 6 AND actor_key NOT LIKE 'ip:%'`,
    today
  );

  return {
    generatedAt: now.toISOString(),
    hasDatabase: true,
    range: { days: range, from: fromDate, to: today },
    visitors: {
      today: { visitors: Number(todayTotals?.visitors || 0), views: Number(todayTotals?.views || 0) },
      range: { visitors: Number(totals?.visitors || 0), views: Number(totals?.views || 0) },
      liveNow: Number(liveNow?.visitors || 0),
      perDay,
    },
    countries,
    cities,
    pages,
    sources,
    devices,
    browsers,
    systems,
    recent,
    events,
    budget,
    aiToday,
    aiPerDay,
    users: { total: Number(users?.total || 0), newInRange: Number(users?.recent || 0) },
    library: { transcripts: Number(library?.transcripts || 0), packs: Number(library?.packs || 0) },
    studentsAtDailyAiLimitToday: Number(limitHitsToday?.actors || 0),
  };
}
