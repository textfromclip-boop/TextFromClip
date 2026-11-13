import { CloudflareBindings, RevisionPack, TranscriptResult } from '../../types';
import { fnv1aHash } from '../../utils/transformCache';
import { hmacSha256Hex, randomId, sha256Hex, timingSafeEqual } from './crypto';

export type PlanTier = 'free' | 'exam_pass' | 'monthly' | 'semester_pass';

export interface DailyQuotaStatus {
  actorKey: string;
  utcDate: string;
  plan: PlanTier;
  linksUsed: number;
  linksLimit: number;
  uploadSecondsUsed: number;
  uploadSecondsLimit: number;
  /** 'day' for free (resets 00:00 UTC), 'week' (rolling 7 days) for Exam Pass, 'month' (rolling 30 days) otherwise. */
  uploadWindow: 'day' | 'week' | 'month';
  aiActionsUsed: number; // e.g. 1.5
  aiActionsLimit: number; // 3 for free, 100 for paid
  mockExamsUsed: number;
  mockExamsLimit: number; // 1 for free, 9999 for paid
  maxCardsPerPack: number; // 30 for free, 150 for paid
  maxLectureSeconds: number; // 7200 for free, 14400 for paid
  /** True when the shared per-IP daily ceiling (campus-friendly anti-abuse cap) is what is limiting this actor. */
  ipCeilingReached: boolean;
}

export const FREE_LIMITS = {
  linksPerDay: 5,
  uploadSecondsPerDay: 20 * 60, // 20 minutes of audio per day
  aiActionsPerDay: 3, // 6 half-units
  cardsPerPack: 30,
  mockExamsPerDay: 1,
  maxLectureSeconds: 2 * 3600, // 2 hours
};

export const PAID_LIMITS = {
  linksPerDay: 50,
  examPassUploadSeconds: 10 * 3600, // 10 hours per rolling 7 days
  monthlyUploadSeconds: 30 * 3600, // 30 hours per rolling 30 days
  aiActionsPerDay: 100, // 200 half-units
  cardsPerPack: 150,
  mockExamsPerDay: 9999, // Unlimited
  maxLectureSeconds: 4 * 3600, // 4 hours
};

/**
 * Per-IP daily ceiling for ANONYMOUS (free) usage. Clearing cookies creates a new anonymous
 * identity, but every identity on the same IP (IPv6: same /64) shares this ceiling, so a single
 * person cannot get unlimited free AI actions. The ceiling is ~10x the per-student limit so a
 * campus or dorm behind one NAT IP still works for many students. Paid users are exempt.
 * Overridable with env vars IP_DAILY_AI_ACTIONS / IP_DAILY_LINKS / IP_DAILY_UPLOAD_MINUTES / IP_DAILY_QUIZZES.
 */
export const DEFAULT_IP_CEILING = {
  aiActionsPerDay: 30,
  linksPerDay: 50,
  uploadSecondsPerDay: 200 * 60,
  mockExamsPerDay: 10,
};

export type IpCeiling = typeof DEFAULT_IP_CEILING;

export function resolveIpCeiling(env?: Record<string, any>): IpCeiling {
  const num = (v: any, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    aiActionsPerDay: num(env?.IP_DAILY_AI_ACTIONS, DEFAULT_IP_CEILING.aiActionsPerDay),
    linksPerDay: num(env?.IP_DAILY_LINKS, DEFAULT_IP_CEILING.linksPerDay),
    uploadSecondsPerDay: env?.IP_DAILY_UPLOAD_MINUTES
      ? num(env.IP_DAILY_UPLOAD_MINUTES, 200) * 60
      : DEFAULT_IP_CEILING.uploadSecondsPerDay,
    mockExamsPerDay: num(env?.IP_DAILY_QUIZZES, DEFAULT_IP_CEILING.mockExamsPerDay),
  };
}

interface QuotaBucket {
  linksUsed: number;
  uploadSecondsUsed: number;
  aiActionsHalfUnits: number;
  mockExamsUsed: number;
}

const EMPTY_BUCKET: QuotaBucket = {
  linksUsed: 0,
  uploadSecondsUsed: 0,
  aiActionsHalfUnits: 0,
  mockExamsUsed: 0,
};

// In-memory fallback stores for local dev & unit tests when D1 is not bound
const memQuotas = new Map<string, QuotaBucket>();
const memTranscriptCache = new Map<string, TranscriptResult>();
const memPackCache = new Map<string, RevisionPack>();
const memCostTelemetry = new Map<
  string,
  {
    whisperAudioSeconds: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    transcriptCacheHits: number;
    transcriptCacheMisses: number;
    packCacheHits: number;
    packCacheMisses: number;
  }
>();

// Concurrency queue limiter per Worker isolate
let activeHeavyJobs = 0;
export const MAX_CONCURRENT_HEAVY_JOBS = 6;

export class QueueBusyError extends Error {
  code = 'QUEUE_BUSY';
  constructor() {
    super('High lecture processing demand right now. Please retry in a few seconds.');
  }
}

export async function withJobConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (activeHeavyJobs >= MAX_CONCURRENT_HEAVY_JOBS) {
    throw new QueueBusyError();
  }
  activeHeavyJobs++;
  try {
    return await fn();
  } finally {
    activeHeavyJobs = Math.max(0, activeHeavyJobs - 1);
  }
}

export function getCurrentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcDateDaysAgo(utcDate: string, days: number): string {
  const d = new Date(`${utcDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export const DEV_ONLY_COOKIE_SECRET = 'lfc-dev-only-cookie-secret-do-not-use-in-production';

/**
 * Signs a cookie value with HMAC-SHA256. `purpose` binds the signature to one cookie
 * (e.g. 'aid' anonymous id vs 'uid' logged-in user) so one signed value cannot be
 * replayed as another cookie.
 */
export async function signCookieValue(
  rawId: string,
  secret: string,
  purpose: 'aid' | 'uid' | 'hv' = 'aid'
): Promise<string> {
  const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const sig = (await hmacSha256Hex(secret, `lfc:${purpose}:${cleanId}`)).slice(0, 43);
  return `${cleanId}.${sig}`;
}

export async function verifySignedCookieValue(
  signedValue: string | undefined | null,
  secret: string,
  purpose: 'aid' | 'uid' | 'hv' = 'aid'
): Promise<string | null> {
  if (!signedValue || typeof signedValue !== 'string' || !secret) return null;
  const idx = signedValue.lastIndexOf('.');
  if (idx <= 0) return null;
  const id = signedValue.slice(0, idx);
  const sig = signedValue.slice(idx + 1);
  if (!id || id.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const expected = (await hmacSha256Hex(secret, `lfc:${purpose}:${id}`)).slice(0, 43);
  return timingSafeEqual(sig, expected) ? id : null;
}

/** @deprecated kept for backwards compatibility in tests; use signCookieValue. */
export const signAnonymousCookieId = (rawId: string, secret: string) =>
  signCookieValue(rawId, secret, 'aid');
/** @deprecated kept for backwards compatibility in tests; use verifySignedCookieValue. */
export const verifySignedCookieId = (value: string | undefined | null, secret: string) =>
  verifySignedCookieValue(value, secret, 'aid');

/**
 * Parses cookies from the Cookie header.
 */
export function parseCookies(cookieHeader: string | undefined | null): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Normalises an IP for the per-IP ceiling. IPv6 addresses are reduced to their /64 prefix,
 * because a single IPv6 user typically controls a whole /64 and could otherwise rotate.
 */
export function normalizeIpForCeiling(rawIp: string): string {
  const ip = (rawIp || '').split(',')[0].trim().toLowerCase();
  if (!ip.includes(':')) return ip || 'unknown';
  // Expand '::' to get the first 4 hextets
  const [head, tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const full = [...headParts, ...Array(missing).fill('0'), ...tailParts];
  return `${full.slice(0, 4).map((h) => h || '0').join(':')}::/64`;
}

export function cookieAttributes(maxAgeSeconds: number, secure: boolean): string {
  return `Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; HttpOnly${secure ? '; Secure' : ''}`;
}

/**
 * Resolves the anonymous or authenticated actor identity from:
 * 1. Signed (HMAC-SHA256) cookie `lfc_aid` — one per browser, so students sharing a campus IP
 *    get separate per-student quotas.
 * 2. IP address — every anonymous identity on one IP (IPv6 /64) also counts against a shared,
 *    much higher per-IP daily ceiling (see DEFAULT_IP_CEILING), so clearing cookies cannot
 *    produce unlimited free AI actions.
 * 3. Turnstile (verified separately in the API layer when TURNSTILE_SECRET_KEY is set).
 */
export async function resolveActorIdentity(params: {
  cookieHeader?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  userId?: string | null;
  cookieSecret: string;
  secureCookies?: boolean;
}): Promise<{
  actorKey: string;
  networkFallbackKey: string;
  cookieId: string;
  isNewCookie: boolean;
  signedCookieHeader: string;
}> {
  const secret = params.cookieSecret;
  const cookies = parseCookies(params.cookieHeader);
  const existingCookieId = await verifySignedCookieValue(cookies['lfc_aid'], secret, 'aid');
  const isNewCookie = !existingCookieId;
  const cookieId = existingCookieId || randomId('u_', 12);
  const signedVal = await signCookieValue(cookieId, secret, 'aid');
  const signedCookieHeader = `lfc_aid=${encodeURIComponent(signedVal)}; ${cookieAttributes(
    31536000,
    Boolean(params.secureCookies)
  )}`;

  const ipKeyHash = (await sha256Hex(`ip:${normalizeIpForCeiling(params.ip || '127.0.0.1')}`)).slice(0, 32);

  const actorKey = params.userId ? `user:${params.userId}` : `anon:${cookieId}`;
  // Shared per-IP ceiling bucket (NOT combined with user agent: identical UAs are common on campus).
  const networkFallbackKey = `ip:${ipKeyHash}`;

  return {
    actorKey,
    networkFallbackKey,
    cookieId,
    isNewCookie,
    signedCookieHeader,
  };
}

/**
 * Verifies a Cloudflare Turnstile token when `TURNSTILE_SECRET_KEY` is configured.
 * If `TURNSTILE_SECRET_KEY` is not configured, returns `true` (development / not yet configured).
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  secretKey: string | undefined,
  remoteIp?: string
): Promise<boolean> {
  if (!secretKey || secretKey === 'disabled') {
    return true;
  }
  if (!token || typeof token !== 'string') {
    return false;
  }
  try {
    const form = new URLSearchParams();
    form.set('secret', secretKey);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data: any = await res.json();
    return Boolean(data?.success);
  } catch (err) {
    // Fail open only if Cloudflare's own verification endpoint is unreachable; the per-IP
    // ceiling still bounds abuse in that case.
    console.warn('[LearnFromClip] Turnstile siteverify unreachable, failing open:', err);
    return true;
  }
}

async function readSingleQuotaBucket(
  actorKey: string,
  utcDate: string,
  db?: D1Database
): Promise<QuotaBucket> {
  const memKey = `${actorKey}:${utcDate}`;
  const memVal = memQuotas.get(memKey);

  if (db) {
    try {
      const row = await db
        .prepare(
          `SELECT links_used, upload_seconds_used, ai_actions_half_units, mock_exams_used
           FROM daily_quotas WHERE actor_key = ?1 AND utc_date = ?2`
        )
        .bind(actorKey, utcDate)
        .first<any>();
      if (row) {
        return {
          linksUsed: Number(row.links_used) || 0,
          uploadSecondsUsed: Number(row.upload_seconds_used) || 0,
          aiActionsHalfUnits: Number(row.ai_actions_half_units) || 0,
          mockExamsUsed: Number(row.mock_exams_used) || 0,
        };
      }
      return { ...EMPTY_BUCKET };
    } catch {
      // fall back to memQuotas
    }
  }

  return memVal ? { ...memVal } : { ...EMPTY_BUCKET };
}

/** Sums upload seconds over the last `days` UTC days (inclusive of today) for an actor. */
async function readUploadSecondsInWindow(
  actorKey: string,
  utcDate: string,
  days: number,
  db?: D1Database
): Promise<number> {
  const fromDate = utcDateDaysAgo(utcDate, days - 1);
  if (db) {
    try {
      const row = await db
        .prepare(
          `SELECT COALESCE(SUM(upload_seconds_used), 0) AS total
           FROM daily_quotas WHERE actor_key = ?1 AND utc_date >= ?2 AND utc_date <= ?3`
        )
        .bind(actorKey, fromDate, utcDate)
        .first<any>();
      return Number(row?.total) || 0;
    } catch {
      // fall through to memory
    }
  }
  let total = 0;
  for (const [key, val] of memQuotas.entries()) {
    const sep = key.lastIndexOf(':');
    const k = key.slice(0, sep);
    const d = key.slice(sep + 1);
    if (k === actorKey && d >= fromDate && d <= utcDate) total += val.uploadSecondsUsed;
  }
  return total;
}

/**
 * Reads current usage for an actor. Free users: per-student daily limits, further capped by the
 * shared per-IP ceiling. Paid users: per-user limits only (uploads use a rolling 7/30-day window).
 * All daily counters reset at 00:00 UTC.
 */
export async function getDailyQuotaStatus(params: {
  actorKey: string;
  networkFallbackKey?: string;
  plan?: PlanTier;
  utcDate?: string;
  db?: D1Database;
  ipCeiling?: IpCeiling;
}): Promise<DailyQuotaStatus> {
  const utcDate = params.utcDate || getCurrentUtcDate();
  const plan: PlanTier = params.plan || 'free';
  const isPaid = plan !== 'free';
  const ceiling = params.ipCeiling || DEFAULT_IP_CEILING;

  const primary = await readSingleQuotaBucket(params.actorKey, utcDate, params.db);

  const linksLimit = isPaid ? PAID_LIMITS.linksPerDay : FREE_LIMITS.linksPerDay;
  const aiLimitHalf = (isPaid ? PAID_LIMITS.aiActionsPerDay : FREE_LIMITS.aiActionsPerDay) * 2;
  const mockLimit = isPaid ? PAID_LIMITS.mockExamsPerDay : FREE_LIMITS.mockExamsPerDay;

  let uploadWindow: 'day' | 'week' | 'month' = 'day';
  let uploadSecondsLimit = FREE_LIMITS.uploadSecondsPerDay;
  let uploadSecondsUsed = primary.uploadSecondsUsed;
  if (plan === 'exam_pass') {
    uploadWindow = 'week';
    uploadSecondsLimit = PAID_LIMITS.examPassUploadSeconds;
    uploadSecondsUsed = await readUploadSecondsInWindow(params.actorKey, utcDate, 7, params.db);
  } else if (isPaid) {
    uploadWindow = 'month';
    uploadSecondsLimit = PAID_LIMITS.monthlyUploadSeconds;
    uploadSecondsUsed = await readUploadSecondsInWindow(params.actorKey, utcDate, 30, params.db);
  }

  let linksUsed = primary.linksUsed;
  let aiHalfUsed = primary.aiActionsHalfUnits;
  let mockUsed = primary.mockExamsUsed;
  let ipCeilingReached = false;

  if (!isPaid && params.networkFallbackKey) {
    const ip = await readSingleQuotaBucket(params.networkFallbackKey, utcDate, params.db);
    // Effective "used" = limit - min(remaining for this student, remaining for this IP)
    const eff = (used: number, limit: number, ipUsed: number, ipLimit: number) => {
      if (ipLimit - ipUsed < limit - used && ipLimit - ipUsed <= 0) ipCeilingReached = true;
      return Math.max(used, limit - (ipLimit - ipUsed));
    };
    linksUsed = eff(linksUsed, linksLimit, ip.linksUsed, ceiling.linksPerDay);
    aiHalfUsed = eff(aiHalfUsed, aiLimitHalf, ip.aiActionsHalfUnits, ceiling.aiActionsPerDay * 2);
    mockUsed = eff(mockUsed, mockLimit, ip.mockExamsUsed, ceiling.mockExamsPerDay);
    uploadSecondsUsed = eff(
      uploadSecondsUsed,
      uploadSecondsLimit,
      ip.uploadSecondsUsed,
      ceiling.uploadSecondsPerDay
    );
  }

  return {
    actorKey: params.actorKey,
    utcDate,
    plan,
    linksUsed,
    linksLimit,
    uploadSecondsUsed,
    uploadSecondsLimit,
    uploadWindow,
    aiActionsUsed: aiHalfUsed / 2,
    aiActionsLimit: aiLimitHalf / 2,
    mockExamsUsed: mockUsed,
    mockExamsLimit: mockLimit,
    maxCardsPerPack: isPaid ? PAID_LIMITS.cardsPerPack : FREE_LIMITS.cardsPerPack,
    maxLectureSeconds: isPaid ? PAID_LIMITS.maxLectureSeconds : FREE_LIMITS.maxLectureSeconds,
    ipCeilingReached,
  };
}

async function incrementBucket(
  bucketKey: string,
  utcDate: string,
  delta: {
    links?: number;
    uploadSeconds?: number;
    aiHalfUnits?: number;
    mockExams?: number;
  },
  db?: D1Database
): Promise<void> {
  const memKey = `${bucketKey}:${utcDate}`;
  const prev = memQuotas.get(memKey) || { ...EMPTY_BUCKET };
  const next = {
    linksUsed: Math.max(0, prev.linksUsed + (delta.links || 0)),
    uploadSecondsUsed: Math.max(0, prev.uploadSecondsUsed + (delta.uploadSeconds || 0)),
    aiActionsHalfUnits: Math.max(0, prev.aiActionsHalfUnits + (delta.aiHalfUnits || 0)),
    mockExamsUsed: Math.max(0, prev.mockExamsUsed + (delta.mockExams || 0)),
  };
  memQuotas.set(memKey, next);

  if (db) {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `INSERT INTO daily_quotas (actor_key, utc_date, links_used, upload_seconds_used, ai_actions_half_units, mock_exams_used, updated_at)
           VALUES (?1, ?2, MAX(?3, 0), MAX(?4, 0), MAX(?5, 0), MAX(?6, 0), ?7)
           ON CONFLICT(actor_key, utc_date) DO UPDATE SET
             links_used = MAX(links_used + ?3, 0),
             upload_seconds_used = MAX(upload_seconds_used + ?4, 0),
             ai_actions_half_units = MAX(ai_actions_half_units + ?5, 0),
             mock_exams_used = MAX(mock_exams_used + ?6, 0),
             updated_at = ?7`
        )
        .bind(
          bucketKey,
          utcDate,
          delta.links || 0,
          delta.uploadSeconds || 0,
          delta.aiHalfUnits || 0,
          delta.mockExams || 0,
          nowSec
        )
        .run();
    } catch (err) {
      console.error('[LearnFromClip] daily_quotas write failed (is migration 0002 applied?):', err);
    }
  }
}

export interface QuotaDelta {
  links?: number;
  uploadSeconds?: number;
  aiHalfUnits?: number; // 2 = 1 full action, 1 = 0.5 cached pack action
  mockExams?: number;
}

export async function consumeQuota(params: {
  actorKey: string;
  networkFallbackKey?: string;
  utcDate?: string;
  db?: D1Database;
} & QuotaDelta): Promise<void> {
  const utcDate = params.utcDate || getCurrentUtcDate();
  const delta = {
    links: params.links || 0,
    uploadSeconds: params.uploadSeconds || 0,
    aiHalfUnits: params.aiHalfUnits || 0,
    mockExams: params.mockExams || 0,
  };
  await incrementBucket(params.actorKey, utcDate, delta, params.db);
  if (params.networkFallbackKey) {
    await incrementBucket(params.networkFallbackKey, utcDate, delta, params.db);
  }
}

type QuotaField = 'links' | 'uploadSeconds' | 'aiHalfUnits' | 'mockExams';
const FIELD_COLUMN: Record<QuotaField, string> = {
  links: 'links_used',
  uploadSeconds: 'upload_seconds_used',
  aiHalfUnits: 'ai_actions_half_units',
  mockExams: 'mock_exams_used',
};
const FIELD_MEM: Record<QuotaField, keyof QuotaBucket> = {
  links: 'linksUsed',
  uploadSeconds: 'uploadSecondsUsed',
  aiHalfUnits: 'aiActionsHalfUnits',
  mockExams: 'mockExamsUsed',
};

/**
 * Atomic "increment only if it stays within the limit" on one counter of one bucket.
 * D1: a single conditional UPDATE (race-free across isolates). Memory: synchronous check-and-set.
 * `windowFromDate` makes the limit apply to the SUM over [windowFromDate, utcDate] (rolling windows).
 */
let d1TablesBootstrapped = false;

export async function ensureLearnFromClipTables(db: D1Database): Promise<void> {
  if (d1TablesBootstrapped) return;
  try {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS cached_transcripts (
        cache_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        video_id TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'en',
        duration_seconds REAL NOT NULL DEFAULT 0,
        transcript_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS cached_packs (
        pack_cache_key TEXT PRIMARY KEY,
        transcript_hash TEXT NOT NULL,
        second_language TEXT NOT NULL DEFAULT '',
        max_cards INTEGER NOT NULL DEFAULT 30,
        pack_json TEXT NOT NULL,
        dropped_quotes_count INTEGER NOT NULL DEFAULT 0,
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS daily_quotas (
        actor_key TEXT NOT NULL,
        utc_date TEXT NOT NULL,
        links_used INTEGER NOT NULL DEFAULT 0,
        upload_seconds_used REAL NOT NULL DEFAULT 0,
        ai_actions_half_units INTEGER NOT NULL DEFAULT 0,
        mock_exams_used INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (actor_key, utc_date)
      )`,
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        picture TEXT,
        google_sub TEXT,
        referral_code TEXT UNIQUE NOT NULL,
        referred_by_user_id TEXT,
        referral_rewards_count INTEGER NOT NULL DEFAULT 0,
        referral_device_hash TEXT,
        streak_days INTEGER NOT NULL DEFAULT 0,
        last_study_utc_date TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS magic_links (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS entitlements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        plan_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        provider_order_id TEXT,
        provider_subscription_id TEXT,
        billing_country TEXT,
        is_regional_pricing INTEGER NOT NULL DEFAULT 0,
        starts_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS synced_decks (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        pack_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        referrer_user_id TEXT NOT NULL,
        invitee_actor_key TEXT NOT NULL,
        invitee_cookie_id TEXT,
        invitee_ip_hash TEXT NOT NULL,
        reward_granted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS webhook_events (
        event_hash TEXT PRIMARY KEY,
        event_name TEXT NOT NULL,
        received_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS cost_telemetry (
        utc_date TEXT PRIMARY KEY,
        whisper_audio_seconds REAL NOT NULL DEFAULT 0,
        llm_input_tokens INTEGER NOT NULL DEFAULT 0,
        llm_output_tokens INTEGER NOT NULL DEFAULT 0,
        transcript_cache_hits INTEGER NOT NULL DEFAULT 0,
        transcript_cache_misses INTEGER NOT NULL DEFAULT 0,
        pack_cache_hits INTEGER NOT NULL DEFAULT 0,
        pack_cache_misses INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_name TEXT NOT NULL,
        route_path TEXT,
        plan_type TEXT DEFAULT 'free',
        created_at INTEGER NOT NULL
      )`,
    ];
    for (const sql of stmts) {
      await db.prepare(sql).run();
    }
    d1TablesBootstrapped = true;
  } catch (e) {
    console.warn('[LearnFromClip] Auto-bootstrap D1 tables warning:', e);
  }
}

async function tryIncrement(
  bucketKey: string,
  utcDate: string,
  field: QuotaField,
  amount: number,
  limit: number,
  db?: D1Database,
  windowFromDate?: string
): Promise<boolean> {
  if (amount <= 0) return true;
  const col = FIELD_COLUMN[field];
  if (db) {
    const runD1Increment = async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `INSERT OR IGNORE INTO daily_quotas (actor_key, utc_date, links_used, upload_seconds_used, ai_actions_half_units, mock_exams_used, updated_at)
           VALUES (?1, ?2, 0, 0, 0, 0, ?3)`
        )
        .bind(bucketKey, utcDate, nowSec)
        .run();
      const usedExpr = windowFromDate
        ? `(SELECT COALESCE(SUM(${col}), 0) FROM daily_quotas WHERE actor_key = ?1 AND utc_date >= ?5 AND utc_date <= ?2)`
        : col;
      const stmt = db.prepare(
        `UPDATE daily_quotas SET ${col} = ${col} + ?3, updated_at = ?6
         WHERE actor_key = ?1 AND utc_date = ?2 AND ${usedExpr} + ?3 <= ?4`
      );
      const res = await stmt.bind(bucketKey, utcDate, amount, limit, windowFromDate || utcDate, nowSec).run();
      const ok = Number(res?.meta?.changes || 0) > 0;
      if (ok) {
        const memKey = `${bucketKey}:${utcDate}`;
        const prev = memQuotas.get(memKey) || { ...EMPTY_BUCKET };
        prev[FIELD_MEM[field]] += amount;
        memQuotas.set(memKey, prev);
      }
      return ok;
    };

    try {
      return await runD1Increment();
    } catch (err: any) {
      if (/no such table/i.test(String(err?.message || err))) {
        await ensureLearnFromClipTables(db);
        try {
          return await runD1Increment();
        } catch (retryErr) {
          console.error('[LearnFromClip] quota reservation retry failed:', retryErr);
          return false;
        }
      }
      console.error('[LearnFromClip] quota reservation failed (is migration 0002 applied?):', err);
      // Fail closed for anonymous cost-bearing work if D1 is broken.
      return false;
    }
  }
  // Memory: no awaits between read and write, so this is atomic within the isolate.
  let used = 0;
  if (windowFromDate) {
    for (const [key, val] of memQuotas.entries()) {
      const sep = key.lastIndexOf(':');
      if (key.slice(0, sep) === bucketKey && key.slice(sep + 1) >= windowFromDate && key.slice(sep + 1) <= utcDate) {
        used += val[FIELD_MEM[field]];
      }
    }
  } else {
    used = memQuotas.get(`${bucketKey}:${utcDate}`)?.[FIELD_MEM[field]] || 0;
  }
  if (used + amount > limit) return false;
  const memKey = `${bucketKey}:${utcDate}`;
  const prev = memQuotas.get(memKey) || { ...EMPTY_BUCKET };
  prev[FIELD_MEM[field]] += amount;
  memQuotas.set(memKey, prev);
  return true;
}

/**
 * Atomically reserves quota BEFORE doing expensive work. Each counter is incremented only if it
 * stays within the limit (conditional UPDATE), first for the student, then for the shared per-IP
 * ceiling; if any step fails, the earlier steps are rolled back. Parallel requests therefore can
 * never overshoot a limit, and a double-click never makes both requests fail.
 * Call `release()` if the work fails so the student is not charged.
 */
export async function reserveQuota(params: {
  actorKey: string;
  networkFallbackKey?: string;
  plan: PlanTier;
  delta: QuotaDelta;
  db?: D1Database;
  ipCeiling?: IpCeiling;
}): Promise<{
  ok: boolean;
  status: DailyQuotaStatus;
  exceeded?: 'links' | 'upload' | 'ai' | 'mockExams';
  release: () => Promise<void>;
}> {
  const utcDate = getCurrentUtcDate();
  const isPaid = params.plan !== 'free';
  const ipKey = isPaid ? undefined : params.networkFallbackKey;
  const ceiling = params.ipCeiling || DEFAULT_IP_CEILING;

  const userLimits: Record<QuotaField, { limit: number; windowFrom?: string }> = {
    links: { limit: isPaid ? PAID_LIMITS.linksPerDay : FREE_LIMITS.linksPerDay },
    aiHalfUnits: { limit: (isPaid ? PAID_LIMITS.aiActionsPerDay : FREE_LIMITS.aiActionsPerDay) * 2 },
    mockExams: { limit: isPaid ? PAID_LIMITS.mockExamsPerDay : FREE_LIMITS.mockExamsPerDay },
    uploadSeconds:
      params.plan === 'exam_pass'
        ? { limit: PAID_LIMITS.examPassUploadSeconds, windowFrom: utcDateDaysAgo(utcDate, 6) }
        : isPaid
        ? { limit: PAID_LIMITS.monthlyUploadSeconds, windowFrom: utcDateDaysAgo(utcDate, 29) }
        : { limit: FREE_LIMITS.uploadSecondsPerDay },
  };
  const ipLimits: Record<QuotaField, number> = {
    links: ceiling.linksPerDay,
    aiHalfUnits: ceiling.aiActionsPerDay * 2,
    mockExams: ceiling.mockExamsPerDay,
    uploadSeconds: ceiling.uploadSecondsPerDay,
  };
  const exceededName: Record<QuotaField, 'links' | 'upload' | 'ai' | 'mockExams'> = {
    links: 'links',
    uploadSeconds: 'upload',
    aiHalfUnits: 'ai',
    mockExams: 'mockExams',
  };

  const done: Array<{ key: string; field: QuotaField; amount: number }> = [];
  const rollback = async () => {
    for (const d of done.reverse()) {
      await incrementBucket(d.key, utcDate, { [d.field]: -d.amount } as any, params.db);
    }
    done.length = 0;
  };

  let exceeded: 'links' | 'upload' | 'ai' | 'mockExams' | undefined;
  for (const field of ['links', 'uploadSeconds', 'aiHalfUnits', 'mockExams'] as QuotaField[]) {
    const amount = Math.ceil(Number(params.delta[field] || 0));
    if (amount <= 0) continue;
    const u = userLimits[field];
    if (!(await tryIncrement(params.actorKey, utcDate, field, amount, u.limit, params.db, u.windowFrom))) {
      exceeded = exceededName[field];
      break;
    }
    done.push({ key: params.actorKey, field, amount });
    if (ipKey) {
      if (!(await tryIncrement(ipKey, utcDate, field, amount, ipLimits[field], params.db))) {
        exceeded = exceededName[field];
        break;
      }
      done.push({ key: ipKey, field, amount });
    }
  }

  const readStatus = () =>
    getDailyQuotaStatus({
      actorKey: params.actorKey,
      networkFallbackKey: ipKey,
      plan: params.plan,
      utcDate,
      db: params.db,
      ipCeiling: params.ipCeiling,
    });

  if (exceeded) {
    await rollback();
    return { ok: false, status: await readStatus(), exceeded, release: async () => {} };
  }

  const reserved = done.slice();
  let released = false;
  return {
    ok: true,
    status: await readStatus(),
    release: async () => {
      if (released) return;
      released = true;
      for (const d of reserved.reverse()) {
        await incrementBucket(d.key, utcDate, { [d.field]: -d.amount } as any, params.db);
      }
    },
  };
}

/**
 * Transcript Cache by platform + videoId + language.
 * A second student pasting the same lecture gets the cached result instantly and free (0 link quota cost).
 */
export async function getCachedTranscript(
  provider: string,
  videoId: string,
  language: string = 'en',
  db?: D1Database
): Promise<TranscriptResult | null> {
  if (!provider || !videoId) return null;
  const key = `${provider.toLowerCase()}:${videoId}:${language.toLowerCase()}`;

  const memHit = memTranscriptCache.get(key);
  if (memHit) {
    await recordCostTelemetry({ transcriptCacheHits: 1 }, db);
    return { ...memHit, cached: true };
  }

  if (db) {
    try {
      const row = await db
        .prepare(`SELECT payload_json FROM cached_transcripts WHERE cache_key = ?1`)
        .bind(key)
        .first<any>();
      if (row?.payload_json) {
        const parsed = JSON.parse(row.payload_json) as TranscriptResult;
        memTranscriptCache.set(key, parsed);
        await db
          .prepare(`UPDATE cached_transcripts SET hit_count = hit_count + 1 WHERE cache_key = ?1`)
          .bind(key)
          .run();
        await recordCostTelemetry({ transcriptCacheHits: 1 }, db);
        return { ...parsed, cached: true };
      }
    } catch {
      // ignore
    }
  }

  await recordCostTelemetry({ transcriptCacheMisses: 1 }, db);
  return null;
}

export async function setCachedTranscript(
  result: TranscriptResult,
  db?: D1Database
): Promise<void> {
  if (!result?.provider || !result?.videoId) return;
  const lang = (result.language || 'en').toLowerCase();
  const key = `${result.provider.toLowerCase()}:${result.videoId}:${lang}`;
  const defaultKey = `${result.provider.toLowerCase()}:${result.videoId}:en`;

  memTranscriptCache.set(key, result);
  memTranscriptCache.set(defaultKey, result);

  if (db) {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const txHash = fnv1aHash(result.fullText || '');
      const payload = JSON.stringify(result);
      await db
        .prepare(
          `INSERT INTO cached_transcripts (cache_key, provider, video_id, language, duration_seconds, transcript_hash, payload_json, hit_count, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)
           ON CONFLICT(cache_key) DO UPDATE SET payload_json = ?7, updated_at = ?8`
        )
        .bind(
          defaultKey,
          result.provider,
          result.videoId,
          lang,
          result.videoDurationSeconds || 0,
          txHash,
          payload,
          nowSec
        )
        .run();
    } catch {
      // ignore
    }
  }
}

/**
 * Revision Pack Cache by transcript hash + secondLanguage + maxCards.
 * A second student requesting a revision pack for the same lecture gets it instantly
 * and it counts as only half an AI action (0.5 = 1 half-unit).
 */
export function buildRevisionPackCacheKey(
  segments: Array<{ start: number; text: string }>,
  secondLanguage: string = '',
  maxCards: number = 30
): { packCacheKey: string; transcriptHash: string } {
  const joined = segments.map((s) => `${Math.floor(s.start)}:${s.text.trim()}`).join('|');
  const transcriptHash = fnv1aHash(joined);
  const packCacheKey = `pack:${transcriptHash}:${(secondLanguage || 'none').toLowerCase()}:${maxCards}`;
  return { packCacheKey, transcriptHash };
}

export async function getCachedRevisionPack(
  packCacheKey: string,
  db?: D1Database
): Promise<RevisionPack | null> {
  const memHit = memPackCache.get(packCacheKey);
  if (memHit) {
    await recordCostTelemetry({ packCacheHits: 1 }, db);
    return {
      ...memHit,
      metadata: { ...memHit.metadata, cached: true },
    };
  }

  if (db) {
    try {
      const row = await db
        .prepare(`SELECT pack_json FROM cached_packs WHERE pack_cache_key = ?1`)
        .bind(packCacheKey)
        .first<any>();
      if (row?.pack_json) {
        const parsed = JSON.parse(row.pack_json) as RevisionPack;
        memPackCache.set(packCacheKey, parsed);
        await db
          .prepare(`UPDATE cached_packs SET hit_count = hit_count + 1 WHERE pack_cache_key = ?1`)
          .bind(packCacheKey)
          .run();
        await recordCostTelemetry({ packCacheHits: 1 }, db);
        return {
          ...parsed,
          metadata: { ...parsed.metadata, cached: true },
        };
      }
    } catch {
      // ignore
    }
  }

  await recordCostTelemetry({ packCacheMisses: 1 }, db);
  return null;
}

export async function setCachedRevisionPack(
  packCacheKey: string,
  transcriptHash: string,
  pack: RevisionPack,
  db?: D1Database
): Promise<void> {
  memPackCache.set(packCacheKey, pack);

  if (db) {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `INSERT INTO cached_packs (pack_cache_key, transcript_hash, second_language, max_cards, pack_json, dropped_quotes_count, hit_count, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)
           ON CONFLICT(pack_cache_key) DO UPDATE SET pack_json = ?5`
        )
        .bind(
          packCacheKey,
          transcriptHash,
          pack.secondLanguage || '',
          pack.flashcards.length,
          JSON.stringify(pack),
          pack.metadata.droppedQuotesCount || 0,
          nowSec
        )
        .run();
    } catch {
      // ignore
    }
  }
}

/**
 * Records daily cost and cache hit telemetry for `/api/admin/costs`.
 */
export async function recordCostTelemetry(
  delta: {
    whisperAudioSeconds?: number;
    llmInputTokens?: number;
    llmOutputTokens?: number;
    transcriptCacheHits?: number;
    transcriptCacheMisses?: number;
    packCacheHits?: number;
    packCacheMisses?: number;
  },
  db?: D1Database
): Promise<void> {
  const utcDate = getCurrentUtcDate();
  const prev = memCostTelemetry.get(utcDate) || {
    whisperAudioSeconds: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    transcriptCacheHits: 0,
    transcriptCacheMisses: 0,
    packCacheHits: 0,
    packCacheMisses: 0,
  };
  const next = {
    whisperAudioSeconds: prev.whisperAudioSeconds + (delta.whisperAudioSeconds || 0),
    llmInputTokens: prev.llmInputTokens + (delta.llmInputTokens || 0),
    llmOutputTokens: prev.llmOutputTokens + (delta.llmOutputTokens || 0),
    transcriptCacheHits: prev.transcriptCacheHits + (delta.transcriptCacheHits || 0),
    transcriptCacheMisses: prev.transcriptCacheMisses + (delta.transcriptCacheMisses || 0),
    packCacheHits: prev.packCacheHits + (delta.packCacheHits || 0),
    packCacheMisses: prev.packCacheMisses + (delta.packCacheMisses || 0),
  };
  memCostTelemetry.set(utcDate, next);

  if (db) {
    try {
      await db
        .prepare(
          `INSERT INTO cost_telemetry (utc_date, whisper_audio_seconds, llm_input_tokens, llm_output_tokens, transcript_cache_hits, transcript_cache_misses, pack_cache_hits, pack_cache_misses)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(utc_date) DO UPDATE SET
             whisper_audio_seconds = whisper_audio_seconds + ?2,
             llm_input_tokens = llm_input_tokens + ?3,
             llm_output_tokens = llm_output_tokens + ?4,
             transcript_cache_hits = transcript_cache_hits + ?5,
             transcript_cache_misses = transcript_cache_misses + ?6,
             pack_cache_hits = pack_cache_hits + ?7,
             pack_cache_misses = pack_cache_misses + ?8`
        )
        .bind(
          utcDate,
          delta.whisperAudioSeconds || 0,
          delta.llmInputTokens || 0,
          delta.llmOutputTokens || 0,
          delta.transcriptCacheHits || 0,
          delta.transcriptCacheMisses || 0,
          delta.packCacheHits || 0,
          delta.packCacheMisses || 0
        )
        .run();
    } catch {
      // ignore
    }
  }
}

export async function getDailyCostReport(
  utcDate: string = getCurrentUtcDate(),
  db?: D1Database
) {
  let stats = memCostTelemetry.get(utcDate) || {
    whisperAudioSeconds: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    transcriptCacheHits: 0,
    transcriptCacheMisses: 0,
    packCacheHits: 0,
    packCacheMisses: 0,
  };

  if (db) {
    try {
      const row = await db
        .prepare(`SELECT * FROM cost_telemetry WHERE utc_date = ?1`)
        .bind(utcDate)
        .first<any>();
      if (row) {
        stats = {
          whisperAudioSeconds: Number(row.whisper_audio_seconds) || 0,
          llmInputTokens: Number(row.llm_input_tokens) || 0,
          llmOutputTokens: Number(row.llm_output_tokens) || 0,
          transcriptCacheHits: Number(row.transcript_cache_hits) || 0,
          transcriptCacheMisses: Number(row.transcript_cache_misses) || 0,
          packCacheHits: Number(row.pack_cache_hits) || 0,
          packCacheMisses: Number(row.pack_cache_misses) || 0,
        };
      }
    } catch {
      // fallback to memory
    }
  }

  const whisperMinutes = Number((stats.whisperAudioSeconds / 60).toFixed(2));
  const whisperEstimatedUsd = Number((whisperMinutes * 0.000453).toFixed(4));
  const llmEstimatedUsd = Number(
    (
      (stats.llmInputTokens / 1_000_000) * 0.1 +
      (stats.llmOutputTokens / 1_000_000) * 0.3
    ).toFixed(4)
  );
  const totalTxLookups = stats.transcriptCacheHits + stats.transcriptCacheMisses;
  const totalPackLookups = stats.packCacheHits + stats.packCacheMisses;

  return {
    utcDate,
    transcriptionMinutes: whisperMinutes,
    llmInputTokens: stats.llmInputTokens,
    llmOutputTokens: stats.llmOutputTokens,
    transcriptCacheHitRate:
      totalTxLookups > 0
        ? Number(((stats.transcriptCacheHits / totalTxLookups) * 100).toFixed(1))
        : 0,
    packCacheHitRate:
      totalPackLookups > 0
        ? Number(((stats.packCacheHits / totalPackLookups) * 100).toFixed(1))
        : 0,
    estimatedCostUsd: {
      whisperUsd: whisperEstimatedUsd,
      llmUsd: llmEstimatedUsd,
      totalUsd: Number((whisperEstimatedUsd + llmEstimatedUsd).toFixed(4)),
    },
  };
}

export function resetMemoryQuotasAndCacheForTests() {
  memQuotas.clear();
  memTranscriptCache.clear();
  memPackCache.clear();
  memCostTelemetry.clear();
}
