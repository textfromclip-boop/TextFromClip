import { cookieAttributes, PlanTier, signCookieValue } from './quotasAndCache';
import { randomId, randomToken, sha256Hex } from './crypto';

export const REGIONAL_PRICING_COUNTRIES = new Set([
  'EG', // Egypt
  'TR', // Turkey
  'IN', // India
  'PK', // Pakistan
  'MA', // Morocco
  'ID', // Indonesia
  'BD', // Bangladesh
  'NG', // Nigeria
  'VN', // Vietnam
  'PH', // Philippines
  'KE', // Kenya
  'DZ', // Algeria
  'TN', // Tunisia
]);

export const MAX_REFERRAL_REWARDS = 5;
export const REFERRAL_PASS_DURATION_SECONDS = 3 * 86400; // 3-day Exam Pass
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
/** Max referral rewards claimable by invitees from one IP per 30 days (stops cookie-clearing farms). */
export const MAX_REFERRAL_CLAIMS_PER_IP_30D = 3;

export type PaidPlan = 'exam_pass' | 'monthly' | 'semester_pass';

export type EntitlementStatus =
  | 'active'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'region_mismatch';

export interface EntitlementRecord {
  id: string;
  userId: string;
  email: string;
  planType: PlanTier;
  status: EntitlementStatus;
  providerOrderId?: string;
  providerSubscriptionId?: string;
  billingCountry?: string;
  isRegionalPricing: boolean;
  startsAt: number;
  expiresAt: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  googleSub?: string;
  referralCode: string;
  referredByUserId?: string;
  referralRewardsCount: number;
  referralDeviceHash?: string;
  createdAt: number;
}

// In-memory stores — used ONLY when no D1 binding exists (unit tests / local dev without D1).
const memUsersByEmail = new Map<string, UserRecord>();
const memEntitlements = new Map<string, EntitlementRecord>();
const memMagicLinks = new Map<string, { email: string; expiresAt: number; usedAt?: number }>();
const memReferrals: Array<{
  referrerUserId: string;
  inviteeActorKey: string;
  inviteeIpHash: string;
  createdAt: number;
}> = [];
const memSyncedDecks = new Map<string, Map<string, { id: string; title: string; packJson: string; updatedAt: number }>>();
const memWebhookEvents = new Set<string>();

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function isEligibleForRegionalPricing(billingCountryCode?: string | null): boolean {
  if (!billingCountryCode) return false;
  return REGIONAL_PRICING_COUNTRIES.has(billingCountryCode.trim().toUpperCase());
}

export function getPlanDurationSeconds(planType: PlanTier): number {
  if (planType === 'exam_pass') return 7 * 86400; // 7 days, one-time
  if (planType === 'monthly') return 31 * 86400; // 1 month subscription (actual expiry follows renews_at)
  if (planType === 'semester_pass') return 120 * 86400; // 4 months, one-time
  return 0;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email) && email.length <= 254;
}

export function guestEmailForCookie(cookieId: string): string {
  return `${cookieId}@guest.learnfromclip.com`;
}

function rowToUser(row: any): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name || undefined,
    picture: row.picture || undefined,
    googleSub: row.google_sub || undefined,
    referralCode: row.referral_code,
    referredByUserId: row.referred_by_user_id || undefined,
    referralRewardsCount: Number(row.referral_rewards_count) || 0,
    referralDeviceHash: row.referral_device_hash || undefined,
    createdAt: Number(row.created_at) || nowSeconds(),
  };
}

function newReferralCode(): string {
  // 8 chars from an unambiguous alphabet, crypto-random
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `LFC${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`;
}

export async function getUserById(id: string, db?: D1Database): Promise<UserRecord | null> {
  if (!id) return null;
  if (db) {
    const row = await db.prepare(`SELECT * FROM users WHERE id = ?1`).bind(id).first<any>();
    return row ? rowToUser(row) : null;
  }
  for (const u of memUsersByEmail.values()) if (u.id === id) return u;
  return null;
}

export async function getUserByReferralCode(code: string, db?: D1Database): Promise<UserRecord | null> {
  const clean = (code || '').trim().toUpperCase();
  if (!/^LFC[A-Z0-9]{4,12}$/.test(clean)) return null;
  if (db) {
    const row = await db.prepare(`SELECT * FROM users WHERE referral_code = ?1`).bind(clean).first<any>();
    return row ? rowToUser(row) : null;
  }
  for (const u of memUsersByEmail.values()) if (u.referralCode === clean) return u;
  return null;
}

export async function getOrCreateUserByEmail(
  rawEmail: string,
  db?: D1Database,
  profile?: { name?: string; picture?: string; googleSub?: string }
): Promise<UserRecord> {
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required.');
  }

  if (db) {
    const existing = await db.prepare(`SELECT * FROM users WHERE email = ?1`).bind(email).first<any>();
    if (existing) {
      const user = rowToUser(existing);
      if (profile && (profile.name || profile.picture || profile.googleSub)) {
        user.name = profile.name || user.name;
        user.picture = profile.picture || user.picture;
        user.googleSub = profile.googleSub || user.googleSub;
        try {
          await db
            .prepare(
              `UPDATE users SET name = COALESCE(?1, name), picture = COALESCE(?2, picture), google_sub = COALESCE(?3, google_sub) WHERE id = ?4`
            )
            .bind(profile.name || null, profile.picture || null, profile.googleSub || null, user.id)
            .run();
        } catch {
          // ignore if optional columns not yet migrated
        }
      }
      return user;
    }
    await db
      .prepare(
        `INSERT INTO users (id, email, referral_code, referral_rewards_count, created_at)
         VALUES (?1, ?2, ?3, 0, ?4)
         ON CONFLICT(email) DO NOTHING`
      )
      .bind(randomId('usr_'), email, newReferralCode(), nowSeconds())
      .run();
    const row = await db.prepare(`SELECT * FROM users WHERE email = ?1`).bind(email).first<any>();
    if (!row) throw new Error('Could not create user record.');
    const created = rowToUser(row);
    if (profile && (profile.name || profile.picture || profile.googleSub)) {
      created.name = profile.name;
      created.picture = profile.picture;
      created.googleSub = profile.googleSub;
      try {
        await db
          .prepare(
            `UPDATE users SET name = COALESCE(?1, name), picture = COALESCE(?2, picture), google_sub = COALESCE(?3, google_sub) WHERE id = ?4`
          )
          .bind(profile.name || null, profile.picture || null, profile.googleSub || null, created.id)
          .run();
      } catch {
        // ignore
      }
    }
    return created;
  }

  const mem = memUsersByEmail.get(email);
  if (mem) {
    if (profile?.name) mem.name = profile.name;
    if (profile?.picture) mem.picture = profile.picture;
    if (profile?.googleSub) mem.googleSub = profile.googleSub;
    return mem;
  }
  const user: UserRecord = {
    id: randomId('usr_'),
    email,
    name: profile?.name,
    picture: profile?.picture,
    googleSub: profile?.googleSub,
    referralCode: newReferralCode(),
    referralRewardsCount: 0,
    createdAt: nowSeconds(),
  };
  memUsersByEmail.set(email, user);
  return user;
}

function rowToEntitlement(row: any): EntitlementRecord {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    planType: row.plan_type as PlanTier,
    status: row.status,
    providerOrderId: row.provider_order_id || undefined,
    providerSubscriptionId: row.provider_subscription_id || undefined,
    billingCountry: row.billing_country || undefined,
    isRegionalPricing: Boolean(row.is_regional_pricing),
    startsAt: Number(row.starts_at),
    expiresAt: Number(row.expires_at),
  };
}

/**
 * Inserts or updates an entitlement row.
 * mode 'create_once': INSERT only — an existing row with the same id is left untouched, so a
 *   duplicate purchase event can never extend or re-grant a pass.
 * mode 'upsert': INSERT, or update status/expiry of the existing row.
 */
export async function upsertEntitlement(
  params: {
    id: string;
    email: string;
    planType: PlanTier;
    status: EntitlementStatus;
    providerOrderId?: string;
    providerSubscriptionId?: string;
    billingCountry?: string;
    isRegionalPricing?: boolean;
    durationSeconds?: number;
    expiresAt?: number;
    mode?: 'create_once' | 'upsert';
  },
  db?: D1Database
): Promise<{ record: EntitlementRecord; created: boolean }> {
  const user = await getOrCreateUserByEmail(params.email, db);
  const nowSec = nowSeconds();
  const duration = params.durationSeconds ?? getPlanDurationSeconds(params.planType);
  const expiresAt = params.expiresAt ?? nowSec + duration;
  const mode = params.mode || 'upsert';
  const record: EntitlementRecord = {
    id: params.id,
    userId: user.id,
    email: user.email,
    planType: params.planType,
    status: params.status,
    providerOrderId: params.providerOrderId,
    providerSubscriptionId: params.providerSubscriptionId,
    billingCountry: params.billingCountry,
    isRegionalPricing: Boolean(params.isRegionalPricing),
    startsAt: nowSec,
    expiresAt,
  };

  if (db) {
    const sql =
      mode === 'create_once'
        ? `INSERT INTO entitlements (id, user_id, email, plan_type, status, provider_order_id, provider_subscription_id, billing_country, is_regional_pricing, starts_at, expires_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10)
           ON CONFLICT(id) DO NOTHING`
        : `INSERT INTO entitlements (id, user_id, email, plan_type, status, provider_order_id, provider_subscription_id, billing_country, is_regional_pricing, starts_at, expires_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10)
           ON CONFLICT(id) DO UPDATE SET
             status = CASE WHEN entitlements.status IN ('region_mismatch', 'refunded') THEN entitlements.status ELSE ?5 END,
             expires_at = CASE WHEN entitlements.status IN ('region_mismatch', 'refunded') THEN entitlements.expires_at ELSE ?11 END`;
    const res = await db
      .prepare(sql)
      .bind(
        record.id,
        record.userId,
        record.email,
        record.planType,
        record.status,
        record.providerOrderId || null,
        record.providerSubscriptionId || null,
        record.billingCountry || null,
        record.isRegionalPricing ? 1 : 0,
        record.startsAt,
        record.expiresAt
      )
      .run();
    const created = Number(res?.meta?.changes || 0) > 0;
    const row = await db.prepare(`SELECT * FROM entitlements WHERE id = ?1`).bind(record.id).first<any>();
    return { record: row ? rowToEntitlement(row) : record, created };
  }

  const existing = memEntitlements.get(record.id);
  if (existing && mode === 'create_once') return { record: existing, created: false };
  if (existing) {
    if (existing.status === 'region_mismatch' || existing.status === 'refunded') {
      return { record: existing, created: false };
    }
    existing.status = record.status;
    existing.expiresAt = record.expiresAt;
    return { record: existing, created: false };
  }
  memEntitlements.set(record.id, record);
  return { record, created: true };
}

/** Updates every entitlement row tied to a provider order / subscription id. */
async function updateEntitlementsByProviderId(
  field: 'provider_order_id' | 'provider_subscription_id',
  value: string,
  status: EntitlementStatus,
  expiresAt: number | null,
  db?: D1Database
): Promise<number> {
  if (!value) return 0;
  if (db) {
    const res = expiresAt === null
      ? await db.prepare(`UPDATE entitlements SET status = ?1 WHERE ${field} = ?2`).bind(status, value).run()
      : await db
          .prepare(`UPDATE entitlements SET status = ?1, expires_at = ?2 WHERE ${field} = ?3`)
          .bind(status, expiresAt, value)
          .run();
    return Number(res?.meta?.changes || 0);
  }
  let n = 0;
  for (const ent of memEntitlements.values()) {
    const v = field === 'provider_order_id' ? ent.providerOrderId : ent.providerSubscriptionId;
    if (v === value) {
      ent.status = status;
      if (expiresAt !== null) ent.expiresAt = expiresAt;
      n++;
    }
  }
  return n;
}

/**
 * Returns the active (or cancelled-but-not-yet-expired) entitlement for a user id or email.
 */
export async function getActiveEntitlementForUser(
  userIdOrEmail: string | undefined | null,
  db?: D1Database,
  nowSec: number = nowSeconds()
): Promise<EntitlementRecord | null> {
  if (!userIdOrEmail) return null;
  const key = userIdOrEmail.trim().toLowerCase();

  if (db) {
    try {
      const row = await db
        .prepare(
          `SELECT * FROM entitlements
           WHERE (user_id = ?1 OR email = ?2)
             AND status IN ('active', 'cancelled')
             AND expires_at > ?3
           ORDER BY expires_at DESC LIMIT 1`
        )
        .bind(userIdOrEmail.trim(), key, nowSec)
        .first<any>();
      return row ? rowToEntitlement(row) : null;
    } catch (err) {
      console.error('[LearnFromClip] entitlement lookup failed:', err);
      return null;
    }
  }

  let best: EntitlementRecord | null = null;
  for (const ent of memEntitlements.values()) {
    if (
      (ent.userId.toLowerCase() === key || ent.email.toLowerCase() === key) &&
      (ent.status === 'active' || ent.status === 'cancelled') &&
      ent.expiresAt > nowSec &&
      (!best || ent.expiresAt > best.expiresAt)
    ) {
      best = ent;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Lemon Squeezy
// ---------------------------------------------------------------------------------------------

export interface LemonSqueezyConfig {
  apiKey?: string;
  storeId?: string;
  /** variant id -> { plan, regional } */
  variants: Record<string, { plan: PaidPlan; regional: boolean }>;
  /** plan -> { standard?: variantId, regional?: variantId } */
  variantsByPlan: Record<PaidPlan, { standard?: string; regional?: string }>;
}

export function readLemonSqueezyConfig(env: Record<string, any> | undefined): LemonSqueezyConfig {
  const e = env || {};
  const pairs: Array<[PaidPlan, boolean, string | undefined]> = [
    ['exam_pass', false, e.LEMONSQUEEZY_VARIANT_EXAM_PASS],
    ['exam_pass', true, e.LEMONSQUEEZY_VARIANT_EXAM_PASS_REGIONAL],
    ['monthly', false, e.LEMONSQUEEZY_VARIANT_MONTHLY],
    ['monthly', true, e.LEMONSQUEEZY_VARIANT_MONTHLY_REGIONAL],
    ['semester_pass', false, e.LEMONSQUEEZY_VARIANT_SEMESTER_PASS],
    ['semester_pass', true, e.LEMONSQUEEZY_VARIANT_SEMESTER_PASS_REGIONAL],
  ];
  const variants: LemonSqueezyConfig['variants'] = {};
  const variantsByPlan: LemonSqueezyConfig['variantsByPlan'] = {
    exam_pass: {},
    monthly: {},
    semester_pass: {},
  };
  for (const [plan, regional, id] of pairs) {
    const clean = typeof id === 'string' ? id.trim() : '';
    if (!clean) continue;
    variants[clean] = { plan, regional };
    variantsByPlan[plan][regional ? 'regional' : 'standard'] = clean;
  }
  return {
    apiKey: typeof e.LEMONSQUEEZY_API_KEY === 'string' ? e.LEMONSQUEEZY_API_KEY.trim() : undefined,
    storeId: typeof e.LEMONSQUEEZY_STORE_ID === 'string' ? e.LEMONSQUEEZY_STORE_ID.trim() : undefined,
    variants,
    variantsByPlan,
  };
}

/** Creates a hosted Lemon Squeezy checkout via the API and returns its URL. */
export async function createLemonSqueezyCheckout(params: {
  config: LemonSqueezyConfig;
  plan: PaidPlan;
  regional: boolean;
  email?: string;
  countryHint?: string;
  customData: Record<string, string>;
  redirectUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<{ url: string; variantId: string }> {
  const { config, plan } = params;
  const ids = config.variantsByPlan[plan];
  const variantId = (params.regional && ids.regional) || ids.standard;
  if (!config.apiKey || !config.storeId || !variantId) {
    const err: any = new Error('Payments are not configured yet.');
    err.code = 'CHECKOUT_NOT_CONFIGURED';
    throw err;
  }
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          ...(params.email ? { email: params.email } : {}),
          ...(params.countryHint ? { billing_address: { country: params.countryHint } } : {}),
          custom: params.customData,
        },
        product_options: {
          redirect_url: params.redirectUrl,
          enabled_variants: [Number(variantId)],
        },
      },
      relationships: {
        store: { data: { type: 'stores', id: String(config.storeId) } },
        variant: { data: { type: 'variants', id: String(variantId) } },
      },
    },
  };
  const doFetch = params.fetchImpl || fetch;
  const res = await doFetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => null);
  const url = json?.data?.attributes?.url;
  if (!res.ok || typeof url !== 'string') {
    console.error('[LearnFromClip] Lemon Squeezy checkout creation failed:', res.status, JSON.stringify(json)?.slice(0, 500));
    const err: any = new Error('Could not start checkout right now. Please try again.');
    err.code = 'CHECKOUT_FAILED';
    throw err;
  }
  return { url, variantId: String(variantId) };
}

/** Looks up the customer's billing country via the Lemon Squeezy API. */
export async function fetchLemonSqueezyCustomerCountry(
  customerId: string | number | undefined,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  if (!customerId || !apiKey) return null;
  const res = await fetchImpl(`https://api.lemonsqueezy.com/v1/customers/${encodeURIComponent(String(customerId))}`, {
    headers: { Accept: 'application/vnd.api+json', Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Lemon Squeezy customer lookup failed (${res.status})`);
  const json: any = await res.json();
  const country = json?.data?.attributes?.country;
  return typeof country === 'string' && country ? country.toUpperCase() : null;
}

export interface WebhookResult {
  handled: boolean;
  duplicate?: boolean;
  eventName: string;
  reason?: string;
  entitlements?: EntitlementRecord[];
}

/**
 * Processes a VERIFIED Lemon Squeezy webhook (signature must be checked by the caller).
 *
 * - order_created (one-time Exam/Semester Pass): grants the pass ONCE (duplicate deliveries are
 *   ignored via webhook_events + INSERT-only entitlement rows). Passes never renew.
 * - subscription_created / subscription_updated / subscription_resumed: Monthly plan; access
 *   follows the subscription status and renews_at/ends_at.
 * - subscription_cancelled: access kept until ends_at. subscription_expired: access removed.
 * - order_refunded / subscription_payment_refunded: access removed immediately.
 * - The plan is derived ONLY from the variant id (configured env vars), never from custom data,
 *   because custom data can be set by anyone through checkout URL parameters.
 * - Regional variants are validated against the customer's BILLING country (Lemon Squeezy API),
 *   not the IP country. A mismatch is stored as status 'region_mismatch' (no access) and logged.
 */
export async function processPaymentWebhook(
  payload: any,
  opts: {
    db?: D1Database;
    eventHash: string;
    config: LemonSqueezyConfig;
    fetchImpl?: typeof fetch;
  }
): Promise<WebhookResult> {
  const { db, eventHash, config } = opts;
  const eventName = String(payload?.meta?.event_name || '').trim();
  const data = payload?.data || {};
  const attrs = data?.attributes || {};
  const custom = payload?.meta?.custom_data || {};
  const nowSec = nowSeconds();

  if (!eventName) return { handled: false, eventName: 'unknown', reason: 'MISSING_EVENT_NAME' };

  // Idempotency: has this exact delivery already been processed?
  if (db) {
    const seen = await db.prepare(`SELECT 1 AS x FROM webhook_events WHERE event_hash = ?1`).bind(eventHash).first<any>();
    if (seen) return { handled: true, duplicate: true, eventName };
  } else if (memWebhookEvents.has(eventHash)) {
    return { handled: true, duplicate: true, eventName };
  }

  const markProcessed = async () => {
    if (db) {
      await db
        .prepare(`INSERT OR IGNORE INTO webhook_events (event_hash, event_name, received_at) VALUES (?1, ?2, ?3)`)
        .bind(eventHash, eventName, nowSec)
        .run();
    } else {
      memWebhookEvents.add(eventHash);
    }
  };

  const email = String(attrs.user_email || '').trim().toLowerCase();
  const variantId = String(attrs.variant_id ?? attrs.first_order_item?.variant_id ?? '').trim();
  const variantInfo = variantId ? config.variants[variantId] : undefined;
  const cookieId = typeof custom.aid === 'string' && /^u_[a-f0-9]{8,64}$/.test(custom.aid) ? custom.aid : undefined;
  const entitled: EntitlementRecord[] = [];

  // Every identity that should receive access: the purchase email, plus the anonymous browser
  // that started checkout (so access works immediately, before any magic-link login).
  const identities = (): string[] => {
    const list: string[] = [];
    if (email && isValidEmail(email)) list.push(email);
    if (cookieId) list.push(guestEmailForCookie(cookieId));
    return list;
  };

  const verifyRegion = async (): Promise<{ ok: boolean; country?: string }> => {
    if (!variantInfo?.regional) return { ok: true };
    const country = await fetchLemonSqueezyCustomerCountry(attrs.customer_id, config.apiKey, opts.fetchImpl);
    if (!country) return { ok: false };
    return { ok: isEligibleForRegionalPricing(country), country };
  };

  if (eventName === 'order_created') {
    if (attrs.status && attrs.status !== 'paid') {
      return { handled: false, eventName, reason: `ORDER_STATUS_${String(attrs.status).toUpperCase()}` };
    }
    if (!variantInfo) {
      console.error(`[LearnFromClip] order_created for unknown variant ${variantId}; not granting access.`);
      await markProcessed();
      return { handled: false, eventName, reason: 'UNKNOWN_VARIANT' };
    }
    if (variantInfo.plan === 'monthly') {
      // Subscriptions are granted by subscription_created (carries renews_at).
      await markProcessed();
      return { handled: true, eventName, reason: 'SUBSCRIPTION_ORDER_HANDLED_BY_SUBSCRIPTION_EVENT' };
    }
    const orderId = String(data.id || attrs.identifier || '');
    const region = await verifyRegion();
    if (!region.ok) {
      console.error(`[LearnFromClip] REGION MISMATCH: order ${orderId} bought a regional variant but billing country is ${region.country || 'unknown'}. Access withheld; review/refund in Lemon Squeezy.`);
    }
    for (const ident of identities()) {
      const { record } = await upsertEntitlement(
        {
          id: `ord_${orderId}:${ident}`,
          email: ident,
          planType: variantInfo.plan,
          status: region.ok ? 'active' : 'region_mismatch',
          providerOrderId: orderId,
          billingCountry: region.country,
          isRegionalPricing: variantInfo.regional,
          mode: 'create_once',
        },
        db
      );
      entitled.push(record);
    }
    await markProcessed();
    return { handled: true, eventName, entitlements: entitled };
  }

  if (
    eventName === 'subscription_created' ||
    eventName === 'subscription_updated' ||
    eventName === 'subscription_resumed' ||
    eventName === 'subscription_unpaused' ||
    eventName === 'subscription_cancelled' ||
    eventName === 'subscription_expired' ||
    eventName === 'subscription_paused'
  ) {
    const subId = String(data.id || '');
    if (!variantInfo) {
      console.error(`[LearnFromClip] ${eventName} for unknown variant ${variantId}; ignoring.`);
      await markProcessed();
      return { handled: false, eventName, reason: 'UNKNOWN_VARIANT' };
    }
    const status = String(attrs.status || '');
    const renewsAt = attrs.renews_at ? Math.floor(new Date(attrs.renews_at).getTime() / 1000) : 0;
    const endsAt = attrs.ends_at ? Math.floor(new Date(attrs.ends_at).getTime() / 1000) : 0;
    let entStatus: EntitlementStatus;
    let expiresAt: number;
    if (status === 'expired' || status === 'unpaid' || eventName === 'subscription_expired') {
      entStatus = 'expired';
      expiresAt = nowSec - 1;
    } else if (status === 'paused' || eventName === 'subscription_paused') {
      entStatus = 'expired';
      expiresAt = nowSec - 1;
    } else if (status === 'cancelled' || attrs.cancelled === true) {
      entStatus = 'cancelled';
      expiresAt = endsAt || renewsAt || nowSec;
    } else {
      entStatus = 'active';
      // 1-day grace so a renewal webhook arriving a little late does not lock the student out
      expiresAt = (renewsAt || nowSec + getPlanDurationSeconds('monthly')) + 86400;
    }

    let regionCountry: string | undefined;
    if (eventName === 'subscription_created') {
      const region = await verifyRegion();
      regionCountry = region.country;
      if (!region.ok) {
        console.error(`[LearnFromClip] REGION MISMATCH: subscription ${subId} uses a regional variant but billing country is ${region.country || 'unknown'}.`);
        entStatus = 'region_mismatch';
      }
    }

    for (const ident of identities()) {
      const { record } = await upsertEntitlement(
        {
          id: `sub_${subId}:${ident}`,
          email: ident,
          planType: 'monthly',
          status: entStatus,
          providerOrderId: attrs.order_id ? String(attrs.order_id) : undefined,
          providerSubscriptionId: subId,
          billingCountry: regionCountry,
          isRegionalPricing: variantInfo.regional,
          expiresAt,
          mode: 'upsert',
        },
        db
      );
      entitled.push(record);
    }
    await markProcessed();
    return { handled: true, eventName, entitlements: entitled };
  }

  if (eventName === 'order_refunded') {
    const orderId = String(data.id || '');
    const n = await updateEntitlementsByProviderId('provider_order_id', orderId, 'refunded', nowSec - 1, db);
    await markProcessed();
    return { handled: true, eventName, reason: `REVOKED_${n}` };
  }

  if (eventName === 'subscription_payment_refunded') {
    const subId = String(attrs.subscription_id || '');
    const n = await updateEntitlementsByProviderId('provider_subscription_id', subId, 'refunded', nowSec - 1, db);
    await markProcessed();
    return { handled: true, eventName, reason: `REVOKED_${n}` };
  }

  // subscription_payment_success / _failed / _recovered: access is driven by the subscription_updated
  // event that Lemon Squeezy sends alongside (it carries the authoritative status and renews_at).
  await markProcessed();
  return { handled: false, eventName, reason: 'IGNORED_EVENT' };
}

// ---------------------------------------------------------------------------------------------
// Magic links
// ---------------------------------------------------------------------------------------------

/** Creates a single-use, 15-minute magic link token (256-bit random; only its SHA-256 is stored). */
export async function createMagicLinkToken(
  rawEmail: string,
  db?: D1Database
): Promise<{ token: string; email: string; expiresAt: number }> {
  const email = (rawEmail || '').trim().toLowerCase();
  if (!isValidEmail(email) || email.endsWith('@guest.learnfromclip.com')) {
    throw new Error('Please enter a valid email address.');
  }
  const expiresAt = nowSeconds() + MAGIC_LINK_TTL_SECONDS;
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);

  if (db) {
    await db
      .prepare(`INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)`)
      .bind(tokenHash, email, expiresAt)
      .run();
  } else {
    memMagicLinks.set(tokenHash, { email, expiresAt });
  }
  return { token, email, expiresAt };
}

/** Consumes a magic link token atomically. Returns null if unknown, expired or already used. */
export async function verifyMagicLinkToken(
  token: string,
  secret: string,
  db?: D1Database,
  secureCookies: boolean = true
): Promise<{ user: UserRecord; signedUserCookie: string } | null> {
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const tokenHash = await sha256Hex(token.trim());
  const nowSec = nowSeconds();
  let email: string | null = null;

  if (db) {
    const row = await db
      .prepare(
        `UPDATE magic_links SET used_at = ?1
         WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1
         RETURNING email`
      )
      .bind(nowSec, tokenHash)
      .first<any>();
    email = row?.email || null;
  } else {
    const rec = memMagicLinks.get(tokenHash);
    if (rec && !rec.usedAt && rec.expiresAt > nowSec) {
      rec.usedAt = nowSec;
      email = rec.email;
    }
  }
  if (!email) return null;

  const user = await getOrCreateUserByEmail(email, db);
  const signed = await signCookieValue(user.id, secret, 'uid');
  return {
    user,
    signedUserCookie: `lfc_uid=${encodeURIComponent(signed)}; ${cookieAttributes(2592000, secureCookies)}`,
  };
}

/** Sends the magic-link email with Resend. Returns false if no provider is configured. */
export async function sendMagicLinkEmail(params: {
  to: string;
  link: string;
  apiKey?: string;
  from?: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  if (!params.apiKey) return false;
  const from = params.from || 'LearnFromClip <login@learnfromclip.com>';
  const doFetch = params.fetchImpl || fetch;
  const res = await doFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: 'Your LearnFromClip sign-in link',
      text: `Sign in to LearnFromClip:\n\n${params.link}\n\nThis link works once and expires in 15 minutes. If you did not request it, ignore this email.`,
      html: `<p>Sign in to <strong>LearnFromClip</strong>:</p><p><a href="${params.link}">Sign in and sync my decks</a></p><p style="color:#64748b;font-size:13px">This link works once and expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Email provider error ${res.status}: ${text.slice(0, 200)}`);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Google OAuth 2.0 & Google Identity Services ("Continue with Google")
// ---------------------------------------------------------------------------------------------

function decodeJwtPayload(jwt: string): any | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Authenticates a user with Google (via Google Identity Services ID token credential,
 * Google OAuth 2.0 userinfo profile, or direct Google account sign-in when GOOGLE_CLIENT_ID is not enforced).
 */
export async function authenticateWithGoogle(
  params: {
    credential?: string;
    email?: string;
    name?: string;
    picture?: string;
    googleSub?: string;
    googleClientId?: string;
  },
  secret: string,
  db?: D1Database,
  secureCookies: boolean = true
): Promise<{ user: UserRecord; signedUserCookie: string }> {
  let email = (params.email || '').trim().toLowerCase();
  let name = params.name?.trim();
  let picture = params.picture?.trim();
  let googleSub = params.googleSub?.trim();

  if (params.credential) {
    const decoded = decodeJwtPayload(params.credential);
    if (decoded && decoded.email) {
      email = String(decoded.email).trim().toLowerCase();
      name = decoded.name ? String(decoded.name) : name;
      picture = decoded.picture ? String(decoded.picture) : picture;
      googleSub = decoded.sub ? String(decoded.sub) : googleSub;
    }

    if (params.googleClientId && params.googleClientId !== 'test') {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(params.credential)}`
      );
      if (!res.ok) {
        throw new Error('Invalid Google ID token.');
      }
      const tokenInfo: any = await res.json();
      if (tokenInfo.aud !== params.googleClientId) {
        throw new Error('Google ID token audience mismatch.');
      }
      if (tokenInfo.email_verified === 'false' || tokenInfo.email_verified === false) {
        throw new Error('Google email address is not verified.');
      }
      email = String(tokenInfo.email || email).trim().toLowerCase();
      name = tokenInfo.name ? String(tokenInfo.name) : name;
      picture = tokenInfo.picture ? String(tokenInfo.picture) : picture;
      googleSub = tokenInfo.sub ? String(tokenInfo.sub) : googleSub;
    }
  }

  if (!isValidEmail(email) || email.endsWith('@guest.learnfromclip.com')) {
    throw new Error('A valid Google account email is required to sign in.');
  }

  const user = await getOrCreateUserByEmail(email, db, { name, picture, googleSub });
  const signed = await signCookieValue(user.id, secret, 'uid');
  return {
    user,
    signedUserCookie: `lfc_uid=${encodeURIComponent(signed)}; ${cookieAttributes(2592000, secureCookies)}`,
  };
}

/**
 * Exchanges a Google OAuth 2.0 authorization code for user profile and signs the user in.
 */
export async function exchangeGoogleOAuthCode(
  params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  secret: string,
  db?: D1Database,
  secureCookies: boolean = true
): Promise<{ user: UserRecord; signedUserCookie: string }> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    throw new Error('Failed to exchange Google OAuth authorization code.');
  }

  const tokenData: any = await tokenRes.json();
  let email = '';
  let name: string | undefined;
  let picture: string | undefined;
  let googleSub: string | undefined;

  if (tokenData.id_token) {
    const decoded = decodeJwtPayload(tokenData.id_token);
    if (decoded?.email) {
      email = String(decoded.email).trim().toLowerCase();
      name = decoded.name ? String(decoded.name) : undefined;
      picture = decoded.picture ? String(decoded.picture) : undefined;
      googleSub = decoded.sub ? String(decoded.sub) : undefined;
    }
  }

  if (!email && tokenData.access_token) {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (userRes.ok) {
      const profile: any = await userRes.json();
      email = String(profile.email || '').trim().toLowerCase();
      name = profile.name ? String(profile.name) : name;
      picture = profile.picture ? String(profile.picture) : picture;
      googleSub = profile.sub ? String(profile.sub) : googleSub;
    }
  }

  return authenticateWithGoogle({ email, name, picture, googleSub }, secret, db, secureCookies);
}

// ---------------------------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------------------------

/** Returns (creating if needed) the referral code for a user, remembering the creating device. */
export async function getReferralCodeForIdentity(
  identityEmail: string,
  deviceHash: string,
  db?: D1Database
): Promise<UserRecord> {
  const user = await getOrCreateUserByEmail(identityEmail, db);
  if (!user.referralDeviceHash) {
    if (db) {
      await db
        .prepare(`UPDATE users SET referral_device_hash = ?1 WHERE id = ?2 AND referral_device_hash IS NULL`)
        .bind(deviceHash, user.id)
        .run();
    }
    user.referralDeviceHash = deviceHash;
  }
  return user;
}

/**
 * Grants both people a 3-day Exam Pass when an invited friend creates their first deck.
 * Called server-side from /api/revision-pack after a pack was actually generated.
 * Anti-fraud: max 5 rewards per referrer; self-referral blocked (same user, same browser cookie,
 * or same device fingerprint = IP + user agent); each invitee identity rewarded once; at most
 * MAX_REFERRAL_CLAIMS_PER_IP_30D invitee rewards per IP per 30 days.
 */
export async function completeReferralOnFirstDeck(params: {
  referralCode: string;
  inviteeIdentityEmail: string; // real email (logged in) or guest email for the cookie
  inviteeActorKey: string;
  inviteeIpHash: string;
  inviteeDeviceHash: string;
  db?: D1Database;
}): Promise<{
  rewarded: boolean;
  reason?: string;
  referrerEntitlement?: EntitlementRecord;
  inviteeEntitlement?: EntitlementRecord;
}> {
  const { db } = params;
  const referrer = await getUserByReferralCode(params.referralCode, db);
  if (!referrer) return { rewarded: false, reason: 'INVALID_REFERRAL_CODE' };

  if (referrer.email.toLowerCase() === params.inviteeIdentityEmail.toLowerCase()) {
    return { rewarded: false, reason: 'SELF_REFERRAL_BLOCKED' };
  }
  if (referrer.referralDeviceHash && referrer.referralDeviceHash === params.inviteeDeviceHash) {
    return { rewarded: false, reason: 'SAME_DEVICE_SELF_REFERRAL_BLOCKED' };
  }
  if (referrer.referralRewardsCount >= MAX_REFERRAL_REWARDS) {
    return { rewarded: false, reason: 'MAX_REWARDS_REACHED' };
  }

  const nowSec = nowSeconds();
  const since = nowSec - 30 * 86400;

  if (db) {
    const already = await db
      .prepare(`SELECT 1 AS x FROM referrals WHERE invitee_actor_key = ?1`)
      .bind(params.inviteeActorKey)
      .first<any>();
    if (already) return { rewarded: false, reason: 'ALREADY_REWARDED' };
    const ipCount = await db
      .prepare(`SELECT COUNT(*) AS n FROM referrals WHERE invitee_ip_hash = ?1 AND created_at > ?2`)
      .bind(params.inviteeIpHash, since)
      .first<any>();
    if (Number(ipCount?.n || 0) >= MAX_REFERRAL_CLAIMS_PER_IP_30D) {
      return { rewarded: false, reason: 'TOO_MANY_REFERRALS_FROM_NETWORK' };
    }
    // Atomically take one of the referrer's 5 reward slots.
    const slot = await db
      .prepare(
        `UPDATE users SET referral_rewards_count = referral_rewards_count + 1
         WHERE id = ?1 AND referral_rewards_count < ?2`
      )
      .bind(referrer.id, MAX_REFERRAL_REWARDS)
      .run();
    if (Number(slot?.meta?.changes || 0) === 0) return { rewarded: false, reason: 'MAX_REWARDS_REACHED' };
    try {
      await db
        .prepare(
          `INSERT INTO referrals (id, referrer_user_id, invitee_actor_key, invitee_ip_hash, invitee_cookie_id, first_deck_created, reward_granted, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 1, 1, ?6)`
        )
        .bind(randomId('ref_'), referrer.id, params.inviteeActorKey, params.inviteeIpHash, params.inviteeActorKey, nowSec)
        .run();
    } catch {
      // Unique index on invitee_actor_key: a concurrent request already claimed. Give the slot back.
      await db
        .prepare(`UPDATE users SET referral_rewards_count = referral_rewards_count - 1 WHERE id = ?1`)
        .bind(referrer.id)
        .run();
      return { rewarded: false, reason: 'ALREADY_REWARDED' };
    }
  } else {
    if (memReferrals.some((r) => r.inviteeActorKey === params.inviteeActorKey)) {
      return { rewarded: false, reason: 'ALREADY_REWARDED' };
    }
    if (
      memReferrals.filter((r) => r.inviteeIpHash === params.inviteeIpHash && r.createdAt > since).length >=
      MAX_REFERRAL_CLAIMS_PER_IP_30D
    ) {
      return { rewarded: false, reason: 'TOO_MANY_REFERRALS_FROM_NETWORK' };
    }
    memReferrals.push({
      referrerUserId: referrer.id,
      inviteeActorKey: params.inviteeActorKey,
      inviteeIpHash: params.inviteeIpHash,
      createdAt: nowSec,
    });
    referrer.referralRewardsCount += 1;
  }

  const { record: referrerEntitlement } = await upsertEntitlement(
    {
      id: `refpass_${referrer.id}_${params.inviteeActorKey}`,
      email: referrer.email,
      planType: 'exam_pass',
      status: 'active',
      durationSeconds: REFERRAL_PASS_DURATION_SECONDS,
      mode: 'create_once',
    },
    db
  );
  const { record: inviteeEntitlement } = await upsertEntitlement(
    {
      id: `refpass_inv_${params.inviteeActorKey}`,
      email: params.inviteeIdentityEmail,
      planType: 'exam_pass',
      status: 'active',
      durationSeconds: REFERRAL_PASS_DURATION_SECONDS,
      mode: 'create_once',
    },
    db
  );
  return { rewarded: true, referrerEntitlement, inviteeEntitlement };
}

// ---------------------------------------------------------------------------------------------
// Cloud deck sync (paid users only — enforced by the API layer)
// ---------------------------------------------------------------------------------------------

export const MAX_SYNCED_DECKS_PER_USER = 200;
export const MAX_SYNCED_DECK_BYTES = 1_000_000;

export async function syncUserDecksToCloud(
  userId: string,
  decks: Array<{ id: string; title: string; packJson: string; updatedAt: number }>,
  db?: D1Database
): Promise<number> {
  const accepted = decks
    .filter((d) => d.id && d.packJson && d.packJson.length <= MAX_SYNCED_DECK_BYTES)
    .slice(0, 50);
  if (db) {
    for (const d of accepted) {
      // Key is (user_id, id): a user can only ever write rows that carry their own user_id.
      await db
        .prepare(
          `INSERT INTO synced_decks (id, user_id, title, pack_json, updated_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT(user_id, id) DO UPDATE SET title = ?3, pack_json = ?4, updated_at = ?5
           WHERE excluded.updated_at >= synced_decks.updated_at`
        )
        .bind(d.id.slice(0, 120), userId, d.title.slice(0, 300), d.packJson, d.updatedAt || Date.now())
        .run();
    }
    return accepted.length;
  }
  const mine = memSyncedDecks.get(userId) || new Map();
  for (const d of accepted) {
    const prev = mine.get(d.id);
    if (!prev || d.updatedAt >= prev.updatedAt) mine.set(d.id, d);
  }
  memSyncedDecks.set(userId, mine);
  return accepted.length;
}

export async function countSyncedDecks(userId: string, db?: D1Database): Promise<number> {
  if (db) {
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM synced_decks WHERE user_id = ?1`).bind(userId).first<any>();
    return Number(row?.n || 0);
  }
  return memSyncedDecks.get(userId)?.size || 0;
}

export async function loadSyncedDecksFromCloud(
  userId: string,
  db?: D1Database
): Promise<Array<{ id: string; title: string; packJson: string; updatedAt: number }>> {
  if (db) {
    const res = await db
      .prepare(`SELECT id, title, pack_json, updated_at FROM synced_decks WHERE user_id = ?1 ORDER BY updated_at DESC`)
      .bind(userId)
      .all<any>();
    return (res?.results || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      packJson: r.pack_json,
      updatedAt: Number(r.updated_at),
    }));
  }
  return Array.from(memSyncedDecks.get(userId)?.values() || []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function resetMemoryAuthAndPaymentsForTests() {
  memUsersByEmail.clear();
  memEntitlements.clear();
  memMagicLinks.clear();
  memReferrals.length = 0;
  memSyncedDecks.clear();
  memWebhookEvents.clear();
}
