// Cookieless visit analytics for the private admin dashboard.
// Stores: time, page, country, city, referring site, device type, browser, OS and a daily-rotating
// visitor hash. Never stores IP addresses or anything that identifies a person across days.
import { sha256Hex } from './crypto';
import { ensureLearnFromClipTables, getDailyCostReport } from './quotasAndCache';
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

function cleanPath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function cleanCountry(country: unknown): string | null {
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1' ? country : null;
}

function errText(err: unknown): string {
  return String((err as any)?.message || err);
}

/**
 * Creates the analytics tables and adds columns newer than migration 0005 if they are missing
 * (migrations 0005/0006 not applied yet), so a deploy never depends on a manual migration.
 */
export async function ensureAnalyticsSchema(db: D1Database): Promise<void> {
  await ensureLearnFromClipTables(db, true);
  const cols = await db.prepare(`PRAGMA table_info(page_views)`).all<{ name: string }>();
  if (!(cols.results || []).some((c) => c.name === 'is_entry')) {
    await db.prepare(`ALTER TABLE page_views ADD COLUMN is_entry INTEGER NOT NULL DEFAULT 0`).run();
  }
}

/** Runs an insert; if a table or column is missing, fixes the schema and retries once. */
async function insertWithSelfHeal(db: D1Database, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (err) {
    const msg = errText(err);
    try {
      if (!/no such table|is_entry/i.test(msg)) {
        console.warn('[LearnFromClip] analytics not recorded:', msg);
        return false;
      }
      await ensureAnalyticsSchema(db);
      await run();
      return true;
    } catch (retryErr) {
      console.warn('[LearnFromClip] analytics not recorded:', errText(retryErr));
      return false;
    }
  }
}

export interface PageViewInput {
  path: unknown;
  referrer?: unknown;
  utmSource?: unknown;
  /** First page of a visit (a fresh page load), as opposed to in-app navigation. */
  entry?: unknown;
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
  const country = cleanCountry(input.country);
  const city = typeof input.city === 'string' && input.city ? input.city.slice(0, 60) : null;
  const visitorHash = (
    await sha256Hex(`visit:${utcDate}:${input.ip}:${input.userAgent.slice(0, 300)}:${input.salt}`)
  ).slice(0, 20);
  const isEntry = input.entry === true || input.entry === 1 ? 1 : 0;
  return insertWithSelfHeal(db, () =>
    db
      .prepare(
        `INSERT INTO page_views (created_at, utc_date, path, country, city, referrer, device, browser, os, visitor_hash, is_entry)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(Math.floor(now.getTime() / 1000), utcDate, cleanPath(input.path as string), country, city, referrer, device, browser, os, visitorHash, isEntry)
      .run()
  );
}

// ---- Web Vitals (real-user speed, like Cloudflare Web Analytics) -------------------------------

export const VITAL_THRESHOLDS = {
  // [good up to, needs improvement up to]; above = poor. Google's Core Web Vitals thresholds.
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
  ttfb: [800, 1800],
  load: [3000, 6000],
} as const;
export type VitalName = keyof typeof VITAL_THRESHOLDS;
const VITAL_LIMITS: Record<VitalName, number> = { lcp: 120000, inp: 60000, cls: 50, ttfb: 120000, load: 300000 };

function vitalValue(v: unknown, name: VitalName): number | null {
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < 0 || n > VITAL_LIMITS[name]) return null;
  return name === 'cls' ? Math.round(n * 1000) / 1000 : Math.round(n);
}

export interface VitalsInput {
  path: unknown;
  lcp?: unknown;
  inp?: unknown;
  cls?: unknown;
  ttfb?: unknown;
  load?: unknown;
  userAgent: string;
  country?: string | null;
  now?: Date;
}

export async function recordWebVitals(input: VitalsInput, db?: D1Database): Promise<boolean> {
  if (!db) return false;
  if (typeof input.path !== 'string' || !PATH_RE.test(input.path)) return false;
  if (isBotUserAgent(input.userAgent)) return false;
  const values = {
    lcp: vitalValue(input.lcp, 'lcp'),
    inp: vitalValue(input.inp, 'inp'),
    cls: vitalValue(input.cls, 'cls'),
    ttfb: vitalValue(input.ttfb, 'ttfb'),
    load: vitalValue(input.load, 'load'),
  };
  if (Object.values(values).every((v) => v === null)) return false;
  const now = input.now || new Date();
  const { device, browser, os } = parseUserAgent(input.userAgent);
  return insertWithSelfHeal(db, () =>
    db
      .prepare(
        `INSERT INTO web_vitals (created_at, utc_date, path, country, device, browser, os, lcp_ms, inp_ms, cls, ttfb_ms, load_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        Math.floor(now.getTime() / 1000),
        now.toISOString().slice(0, 10),
        cleanPath(input.path as string),
        cleanCountry(input.country),
        device,
        browser,
        os,
        values.lcp,
        values.inp,
        values.cls,
        values.ttfb,
        values.load
      )
      .run()
  );
}

// ---- Reports for the admin console --------------------------------------------------------------

export const VISIT_RETENTION_DAYS = 90;

export const FILTER_KEYS = ['country', 'city', 'path', 'referrer', 'device', 'browser', 'os'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type AnalyticsFilters = Partial<Record<FilterKey, string>>;

/** Reads filters from query parameters, keeping only known keys and short values. */
export function parseFilters(get: (key: string) => string | undefined): AnalyticsFilters {
  const out: AnalyticsFilters = {};
  for (const key of FILTER_KEYS) {
    const v = get(key);
    if (typeof v === 'string' && v.length > 0 && v.length <= 120) out[key] = v;
  }
  return out;
}

/** Parameterised WHERE clause for a time window plus filters. Column names come from a fixed list. */
function where(fromSec: number, toSec: number, filters: AnalyticsFilters, allowed: readonly FilterKey[] = FILTER_KEYS) {
  const parts = ['created_at >= ?', 'created_at < ?'];
  const binds: any[] = [fromSec, toSec];
  for (const key of allowed) {
    const v = filters[key];
    if (v === undefined) continue;
    if ((key === 'referrer' && v === 'Direct') || (key === 'country' && v === '??')) {
      parts.push(`${key} IS NULL`);
    } else {
      parts.push(`${key} = ?`);
      binds.push(v);
    }
  }
  return { sql: parts.join(' AND '), binds };
}

async function all<T = any>(db: D1Database, sql: string, binds: any[] = []): Promise<T[]> {
  try {
    const res = await db.prepare(sql).bind(...binds).all<T>();
    return (res.results || []) as T[];
  } catch (err) {
    console.warn('[LearnFromClip] admin query failed:', errText(err));
    return [];
  }
}

async function first<T = any>(db: D1Database, sql: string, binds: any[] = []): Promise<T | null> {
  return (await all<T>(db, sql, binds))[0] || null;
}

function startOfUtcDay(sec: number): number {
  return Math.floor(sec / 86400) * 86400;
}

export interface Range {
  days: number;
  fromSec: number;
  toSec: number;
  prevFromSec: number;
  prevToSec: number;
  bucket: 'hour' | 'day';
}

/** "Today" = since 00:00 UTC; "7 days" = the last 7 UTC days incl. today. Previous = same span before. */
export function resolveRange(days: number, nowSec: number): Range {
  const d = Math.min(90, Math.max(1, Math.floor(days) || 1));
  const fromSec = startOfUtcDay(nowSec) - (d - 1) * 86400;
  const toSec = nowSec + 1;
  const span = d * 86400;
  return { days: d, fromSec, toSec, prevFromSec: fromSec - span, prevToSec: toSec - span, bucket: d === 1 ? 'hour' : 'day' };
}

async function totals(db: D1Database, fromSec: number, toSec: number, filters: AnalyticsFilters) {
  const w = where(fromSec, toSec, filters);
  const row = await first<{ views: number; visits: number; visitors: number }>(
    db,
    `SELECT COUNT(*) AS views, COALESCE(SUM(is_entry), 0) AS visits, COUNT(DISTINCT utc_date || visitor_hash) AS visitors FROM page_views WHERE ${w.sql}`,
    w.binds
  );
  const bounce = await first<{ visitors: number; bounced: number }>(
    db,
    `SELECT COUNT(*) AS visitors, COALESCE(SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END), 0) AS bounced
     FROM (SELECT COUNT(*) AS n FROM page_views WHERE ${w.sql} GROUP BY utc_date, visitor_hash)`,
    w.binds
  );
  const visitors = Number(row?.visitors || 0);
  return {
    views: Number(row?.views || 0),
    visits: Number(row?.visits || 0),
    visitors,
    bounceRate: visitors ? Math.round((Number(bounce?.bounced || 0) / visitors) * 1000) / 10 : 0,
    pagesPerVisitor: visitors ? Math.round((Number(row?.views || 0) / visitors) * 10) / 10 : 0,
  };
}

const BREAKDOWNS: Array<{ key: string; select: string; group: string }> = [
  { key: 'country', select: `COALESCE(country, '??') AS k`, group: '1' },
  { key: 'city', select: `city AS k, COALESCE(country, '??') AS country`, group: '1, 2' },
  { key: 'path', select: `path AS k`, group: '1' },
  { key: 'referrer', select: `COALESCE(referrer, 'Direct') AS k`, group: '1' },
  { key: 'device', select: `device AS k`, group: '1' },
  { key: 'browser', select: `browser AS k`, group: '1' },
  { key: 'os', select: `os AS k`, group: '1' },
];

export async function getTrafficReport(db: D1Database, days: number, filters: AnalyticsFilters, now = new Date()) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const range = resolveRange(days, nowSec);
  const w = where(range.fromSec, range.toSec, filters);

  const current = await totals(db, range.fromSec, range.toSec, filters);
  const previous = await totals(db, range.prevFromSec, range.prevToSec, filters);

  // Time series, every bucket present (zeros included)
  const bucketExpr = range.bucket === 'hour' ? `CAST((created_at - ${range.fromSec}) / 3600 AS INTEGER)` : `utc_date`;
  const rows = await all<{ b: any; views: number; visits: number; visitors: number }>(
    db,
    `SELECT ${bucketExpr} AS b, COUNT(*) AS views, COALESCE(SUM(is_entry), 0) AS visits, COUNT(DISTINCT utc_date || visitor_hash) AS visitors
     FROM page_views WHERE ${w.sql} GROUP BY 1`,
    w.binds
  );
  const byBucket = new Map(rows.map((r) => [String(r.b), r]));
  const series: Array<{ label: string; start: number; views: number; visits: number; visitors: number }> = [];
  if (range.bucket === 'hour') {
    const hoursSoFar = Math.floor((nowSec - range.fromSec) / 3600) + 1;
    for (let h = 0; h < 24; h++) {
      const r = byBucket.get(String(h));
      const future = h >= hoursSoFar;
      series.push({
        label: `${String(h).padStart(2, '0')}:00`,
        start: range.fromSec + h * 3600,
        views: future ? (null as any) : Number(r?.views || 0),
        visits: future ? (null as any) : Number(r?.visits || 0),
        visitors: future ? (null as any) : Number(r?.visitors || 0),
      });
    }
  } else {
    for (let i = 0; i < range.days; i++) {
      const start = range.fromSec + i * 86400;
      const day = new Date(start * 1000).toISOString().slice(0, 10);
      const r = byBucket.get(day);
      series.push({ label: day, start, views: Number(r?.views || 0), visits: Number(r?.visits || 0), visitors: Number(r?.visitors || 0) });
    }
  }

  const breakdowns: Record<string, any[]> = {};
  for (const b of BREAKDOWNS) {
    const extra = b.key === 'city' ? ' AND city IS NOT NULL' : '';
    breakdowns[b.key] = await all(
      db,
      `SELECT ${b.select}, COUNT(*) AS views, COALESCE(SUM(is_entry), 0) AS visits, COUNT(DISTINCT utc_date || visitor_hash) AS visitors
       FROM page_views WHERE ${w.sql}${extra} GROUP BY ${b.group} ORDER BY visitors DESC, views DESC LIMIT 60`,
      w.binds
    );
  }

  const live = await first<{ visitors: number }>(
    db,
    `SELECT COUNT(DISTINCT visitor_hash) AS visitors FROM page_views WHERE created_at >= ?`,
    [nowSec - 5 * 60]
  );
  const recent = await all(
    db,
    `SELECT created_at AS at, path, country, city, referrer, device, browser, os, is_entry AS entry FROM page_views WHERE ${w.sql} ORDER BY created_at DESC LIMIT 50`,
    w.binds
  );

  return {
    range,
    current,
    previous,
    series,
    breakdowns,
    liveNow: Number(live?.visitors || 0),
    recent,
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export async function getVitalsReport(db: D1Database, days: number, filters: AnalyticsFilters, now = new Date()) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const range = resolveRange(days, nowSec);
  // Speed samples don't carry city or referrer, so those filters don't apply here.
  const applicable: FilterKey[] = ['country', 'path', 'device', 'browser', 'os'];
  const w = where(range.fromSec, range.toSec, filters, applicable);
  const rows = await all<{ path: string; device: string; lcp_ms: number | null; inp_ms: number | null; cls: number | null; ttfb_ms: number | null; load_ms: number | null }>(
    db,
    `SELECT path, device, lcp_ms, inp_ms, cls, ttfb_ms, load_ms FROM web_vitals WHERE ${w.sql} ORDER BY created_at DESC LIMIT 20000`,
    w.binds
  );
  const column: Record<VitalName, keyof (typeof rows)[number]> = { lcp: 'lcp_ms', inp: 'inp_ms', cls: 'cls', ttfb: 'ttfb_ms', load: 'load_ms' };
  const metrics: Record<string, { samples: number; p75: number | null; good: number; needsImprovement: number; poor: number }> = {};
  for (const name of Object.keys(VITAL_THRESHOLDS) as VitalName[]) {
    const [good, ni] = VITAL_THRESHOLDS[name];
    const values = rows.map((r) => r[column[name]] as number | null).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    metrics[name] = {
      samples: values.length,
      p75: percentile(values, 0.75),
      good: values.filter((v) => v <= good).length,
      needsImprovement: values.filter((v) => v > good && v <= ni).length,
      poor: values.filter((v) => v > ni).length,
    };
  }
  const byPath = new Map<string, number[]>();
  for (const r of rows) {
    if (typeof r.lcp_ms !== 'number') continue;
    const list = byPath.get(r.path) || [];
    list.push(r.lcp_ms);
    byPath.set(r.path, list);
  }
  const pages = [...byPath.entries()]
    .map(([path, list]) => ({ path, samples: list.length, lcpP75: percentile(list.sort((a, b) => a - b), 0.75) }))
    .sort((a, b) => (b.lcpP75 || 0) - (a.lcpP75 || 0))
    .slice(0, 15);
  const devices = ['Mobile', 'Desktop', 'Tablet'].map((device) => {
    const list = rows.filter((r) => r.device === device && typeof r.lcp_ms === 'number').map((r) => r.lcp_ms as number).sort((a, b) => a - b);
    return { device, samples: list.length, lcpP75: percentile(list, 0.75) };
  }).filter((d) => d.samples > 0);
  return { range, samples: rows.length, metrics, pages, devices, thresholds: VITAL_THRESHOLDS, ignoredFilters: (['city', 'referrer'] as FilterKey[]).filter((k) => filters[k] !== undefined) };
}

export async function getUsageReport(env: any, db: D1Database, days: number, now = new Date()) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const range = resolveRange(days, nowSec);
  const today = now.toISOString().slice(0, 10);
  const fromDate = new Date(range.fromSec * 1000).toISOString().slice(0, 10);
  const budget = await getAiBudgetStatus(env, db);
  const aiToday = await getDailyCostReport(today, db);
  const aiPerDay = await all(
    db,
    `SELECT utc_date AS day, whisper_audio_seconds AS whisperSeconds, llm_input_tokens AS inTokens, llm_output_tokens AS outTokens,
            transcript_cache_hits AS txHits, transcript_cache_misses AS txMisses, pack_cache_hits AS packHits, pack_cache_misses AS packMisses
     FROM cost_telemetry WHERE utc_date >= ? ORDER BY utc_date DESC LIMIT 90`,
    [new Date((range.fromSec - Math.max(0, 14 - range.days) * 86400) * 1000).toISOString().slice(0, 10)]
  );
  const events = await all(
    db,
    `SELECT event_name AS name, COUNT(*) AS count FROM analytics_events WHERE created_at >= ? GROUP BY event_name ORDER BY count DESC`,
    [range.fromSec]
  );
  const users = await first<{ total: number; recent: number }>(
    db,
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS recent FROM users`,
    [range.fromSec]
  );
  const library = await first<{ transcripts: number; packs: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM cached_transcripts) AS transcripts, (SELECT COUNT(*) FROM cached_packs) AS packs`
  );
  const atLimit = await first<{ actors: number }>(
    db,
    `SELECT COUNT(*) AS actors FROM daily_quotas WHERE utc_date = ? AND ai_actions_half_units >= 6 AND actor_key NOT LIKE 'ip:%'`,
    [today]
  );
  const todayRow = (aiPerDay as any[]).find((r) => r.day === today);
  return {
    fromDate,
    budget,
    aiToday,
    aiPerDay,
    events,
    users: { total: Number(users?.total || 0), newInRange: Number(users?.recent || 0) },
    library: { transcripts: Number(library?.transcripts || 0), packs: Number(library?.packs || 0) },
    packsToday: { made: Number(todayRow?.packMisses || 0), reused: Number(todayRow?.packHits || 0) },
    studentsAtDailyAiLimitToday: Number(atLimit?.actors || 0),
  };
}

/** Everything the admin console shows, for the last `days` days (1 = today, hourly). */
export async function getAdminDashboardData(env: any, db: D1Database | undefined, days: number, filters: AnalyticsFilters = {}) {
  const now = new Date();
  if (!db) {
    return {
      generatedAt: now.toISOString(),
      hasDatabase: false,
      range: resolveRange(days, Math.floor(now.getTime() / 1000)),
      filters,
      usage: { budget: await getAiBudgetStatus(env, undefined) },
    };
  }
  try {
    await ensureAnalyticsSchema(db);
  } catch (err) {
    console.warn('[LearnFromClip] analytics schema check failed:', errText(err));
  }
  // Retention: visits and speed samples older than 90 days are deleted.
  const cutoff = Math.floor(now.getTime() / 1000) - VISIT_RETENTION_DAYS * 86400;
  for (const table of ['page_views', 'web_vitals']) {
    try {
      await db.prepare(`DELETE FROM ${table} WHERE created_at < ?`).bind(cutoff).run();
    } catch {
      // table may not exist yet
    }
  }
  const traffic = await getTrafficReport(db, days, filters, now);
  return {
    generatedAt: now.toISOString(),
    hasDatabase: true,
    range: traffic.range,
    filters,
    traffic,
    vitals: await getVitalsReport(db, days, filters, now),
    usage: await getUsageReport(env, db, days, now),
  };
}
