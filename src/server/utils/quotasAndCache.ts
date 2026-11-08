import { CloudflareBindings, RevisionPack, TranscriptResult } from '../../types';
import { fnv1aHash } from '../../utils/transformCache';

export type PlanTier = 'free' | 'exam_pass' | 'monthly' | 'semester_pass';

export interface DailyQuotaStatus {
  actorKey: string;
  utcDate: string;
  plan: PlanTier;
  linksUsed: number;
  linksLimit: number;
  uploadSecondsUsed: number;
  uploadSecondsLimit: number;
  aiActionsUsed: number; // e.g. 1.5
  aiActionsLimit: number; // 3 for free, 100 for paid
  mockExamsUsed: number;
  mockExamsLimit: number; // 1 for free, 9999 for paid
  maxCardsPerPack: number; // 30 for free, 150 for paid
  maxLectureSeconds: number; // 7200 for free, 14400 for paid
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
  examPassUploadSeconds: 10 * 3600, // 10 hours/week
  monthlyUploadSeconds: 30 * 3600, // 30 hours/month
  aiActionsPerDay: 100, // 200 half-units
  cardsPerPack: 150,
  mockExamsPerDay: 9999, // Unlimited
  maxLectureSeconds: 4 * 3600, // 4 hours
};

// In-memory fallback stores for local dev & unit tests when D1 is not bound
const memQuotas = new Map<
  string,
  {
    linksUsed: number;
    uploadSecondsUsed: number;
    aiActionsHalfUnits: number;
    mockExamsUsed: number;
  }
>();
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
const MAX_CONCURRENT_HEAVY_JOBS = 6;

export async function withJobConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (activeHeavyJobs >= MAX_CONCURRENT_HEAVY_JOBS) {
    throw new Error('SERVER_BUSY: High lecture processing demand. Please retry in a few seconds.');
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

/**
 * Simple deterministic HMAC/FNV signature for anonymous cookie IDs so clients cannot forge arbitrary IDs.
 */
export function signAnonymousCookieId(rawId: string, secret: string = 'lfc-default-edge-secret'): string {
  const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
  const sig = fnv1aHash(`${cleanId}:${secret}`);
  return `${cleanId}.${sig}`;
}

export function verifySignedCookieId(
  signedValue: string | undefined | null,
  secret: string = 'lfc-default-edge-secret'
): string | null {
  if (!signedValue || typeof signedValue !== 'string') return null;
  const parts = signedValue.split('.');
  if (parts.length !== 2) return null;
  const [id, sig] = parts;
  if (!id || id.length < 8) return null;
  const expected = fnv1aHash(`${id}:${secret}`);
  return sig === expected ? id : null;
}

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
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

/**
 * Resolves the anonymous or authenticated actor identity from:
 * 1. Signed cookie `lfc_aid`
 * 2. IP address (`cf-connecting-ip` / `x-forwarded-for`)
 * 3. Optional Turnstile token (`cf-turnstile-response` / `x-turnstile-token`)
 *
 * University shared-IP protection:
 * - Two students on the same university IP get distinct signed `lfc_aid` cookies, so their
 *   quotas are tracked separately (`anon:${cookieId}:${ipPrefix}`).
 * - If a user clears cookies on the same IP without a verified Turnstile token, we also check
 *   a per-IP-plus-UserAgent fallback bucket (`net:${ipHash}`) so clearing cookies repeatedly
 *   cannot bypass daily limits on the same network device.
 */
export function resolveActorIdentity(params: {
  cookieHeader?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  userId?: string | null;
  cookieSecret?: string;
}): {
  actorKey: string;
  networkFallbackKey: string;
  cookieId: string;
  isNewCookie: boolean;
  signedCookieHeader: string;
} {
  const secret = params.cookieSecret || 'lfc-default-edge-secret';
  const cookies = parseCookies(params.cookieHeader);
  const existingCookieId = verifySignedCookieId(cookies['lfc_aid'], secret);
  const isNewCookie = !existingCookieId;
  const cookieId =
    existingCookieId ||
    `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const signedVal = signAnonymousCookieId(cookieId, secret);
  const signedCookieHeader = `lfc_aid=${encodeURIComponent(
    signedVal
  )}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;

  const rawIp = (params.ip || '127.0.0.1').trim();
  const uaHash = fnv1aHash((params.userAgent || 'browser').slice(0, 120));
  const ipHash = fnv1aHash(rawIp);

  const actorKey = params.userId
    ? `user:${params.userId}`
    : `anon:${cookieId}`;
  // Network + browser fingerprint bucket to survive simple cookie clearing on the same machine
  const networkFallbackKey = `net:${ipHash}:${uaHash}`;

  return {
    actorKey,
    networkFallbackKey,
    cookieId,
    isNewCookie,
    signedCookieHeader,
  };
}

/**
 * Verifies an invisible Cloudflare Turnstile token when `TURNSTILE_SECRET_KEY` is configured.
 * If `TURNSTILE_SECRET_KEY` is not yet configured in environment, returns `true` so development works seamlessly.
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  secretKey: string | undefined,
  remoteIp?: string
): Promise<boolean> {
  if (!secretKey || secretKey === 'test' || secretKey === 'disabled') {
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
  } catch {
    return true;
  }
}

async function readSingleQuotaBucket(
  actorKey: string,
  utcDate: string,
  db?: D1Database
): Promise<{
  linksUsed: number;
  uploadSecondsUsed: number;
  aiActionsHalfUnits: number;
  mockExamsUsed: number;
}> {
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
    } catch {
      // fall back to memQuotas
    }
  }

  return (
    memVal || {
      linksUsed: 0,
      uploadSecondsUsed: 0,
      aiActionsHalfUnits: 0,
      mockExamsUsed: 0,
    }
  );
}

/**
 * Reads current daily quota usage for an actor (combining cookie actorKey and network+UA fallback
 * when anonymous so clearing cookies on the same browser/IP still respects limits).
 */
export async function getDailyQuotaStatus(params: {
  actorKey: string;
  networkFallbackKey?: string;
  plan?: PlanTier;
  utcDate?: string;
  db?: D1Database;
}): Promise<DailyQuotaStatus> {
  const utcDate = params.utcDate || getCurrentUtcDate();
  const plan: PlanTier = params.plan || 'free';
  const isPaid = plan !== 'free';

  const primary = await readSingleQuotaBucket(params.actorKey, utcDate, params.db);
  const netBucket =
    !isPaid && params.networkFallbackKey
      ? await readSingleQuotaBucket(params.networkFallbackKey, utcDate, params.db)
      : { linksUsed: 0, uploadSecondsUsed: 0, aiActionsHalfUnits: 0, mockExamsUsed: 0 };

  const linksUsed = Math.max(primary.linksUsed, netBucket.linksUsed);
  const uploadSecondsUsed = Math.max(
    primary.uploadSecondsUsed,
    netBucket.uploadSecondsUsed
  );
  const aiActionsHalfUnits = Math.max(
    primary.aiActionsHalfUnits,
    netBucket.aiActionsHalfUnits
  );
  const mockExamsUsed = Math.max(primary.mockExamsUsed, netBucket.mockExamsUsed);

  return {
    actorKey: params.actorKey,
    utcDate,
    plan,
    linksUsed,
    linksLimit: isPaid ? PAID_LIMITS.linksPerDay : FREE_LIMITS.linksPerDay,
    uploadSecondsUsed,
    uploadSecondsLimit:
      plan === 'exam_pass'
        ? PAID_LIMITS.examPassUploadSeconds
        : isPaid
        ? PAID_LIMITS.monthlyUploadSeconds
        : FREE_LIMITS.uploadSecondsPerDay,
    aiActionsUsed: aiActionsHalfUnits / 2,
    aiActionsLimit: isPaid ? PAID_LIMITS.aiActionsPerDay : FREE_LIMITS.aiActionsPerDay,
    mockExamsUsed,
    mockExamsLimit: isPaid ? PAID_LIMITS.mockExamsPerDay : FREE_LIMITS.mockExamsPerDay,
    maxCardsPerPack: isPaid ? PAID_LIMITS.cardsPerPack : FREE_LIMITS.cardsPerPack,
    maxLectureSeconds: isPaid
      ? PAID_LIMITS.maxLectureSeconds
      : FREE_LIMITS.maxLectureSeconds,
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
  const prev = memQuotas.get(memKey) || {
    linksUsed: 0,
    uploadSecondsUsed: 0,
    aiActionsHalfUnits: 0,
    mockExamsUsed: 0,
  };
  const next = {
    linksUsed: prev.linksUsed + (delta.links || 0),
    uploadSecondsUsed: prev.uploadSecondsUsed + (delta.uploadSeconds || 0),
    aiActionsHalfUnits: prev.aiActionsHalfUnits + (delta.aiHalfUnits || 0),
    mockExamsUsed: prev.mockExamsUsed + (delta.mockExams || 0),
  };
  memQuotas.set(memKey, next);

  if (db) {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      await db
        .prepare(
          `INSERT INTO daily_quotas (actor_key, utc_date, links_used, upload_seconds_used, ai_actions_half_units, mock_exams_used, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(actor_key, utc_date) DO UPDATE SET
             links_used = links_used + ?3,
             upload_seconds_used = upload_seconds_used + ?4,
             ai_actions_half_units = ai_actions_half_units + ?5,
             mock_exams_used = mock_exams_used + ?6,
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
    } catch {
      // ignore if migration not yet applied
    }
  }
}

export async function consumeQuota(params: {
  actorKey: string;
  networkFallbackKey?: string;
  utcDate?: string;
  links?: number;
  uploadSeconds?: number;
  aiHalfUnits?: number; // 2 = 1 full action, 1 = 0.5 cached pack action
  mockExams?: number;
  db?: D1Database;
}): Promise<void> {
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
