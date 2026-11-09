import { PlanTier, signAnonymousCookieId, verifySignedCookieId } from './quotasAndCache';
import { fnv1aHash } from '../../utils/transformCache';

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

export interface EntitlementRecord {
  id: string;
  userId: string;
  email: string;
  planType: PlanTier;
  status: 'active' | 'cancelled' | 'expired' | 'refunded';
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
  referralCode: string;
  referredByUserId?: string;
  referralRewardsCount: number;
  createdAt: number;
}

// In-memory stores for local dev & unit tests when D1 is not bound
const memUsersByEmail = new Map<string, UserRecord>();
const memUsersById = new Map<string, UserRecord>();
const memUsersByRefCode = new Map<string, UserRecord>();
const memEntitlements = new Map<string, EntitlementRecord>();
const memMagicLinks = new Map<
  string,
  { email: string; expiresAt: number; usedAt?: number }
>();
const memReferrals = new Map<
  string,
  {
    id: string;
    referrerUserId: string;
    inviteeActorKey: string;
    inviteeIpHash: string;
    inviteeCookieId: string;
    firstDeckCreated: boolean;
    rewardGranted: boolean;
  }
>();
const memSyncedDecks = new Map<string, Array<{ id: string; title: string; packJson: string; updatedAt: number }>>();
const memProcessedWebhooks = new Set<string>();

export function isEligibleForRegionalPricing(billingCountryCode?: string | null): boolean {
  if (!billingCountryCode) return false;
  return REGIONAL_PRICING_COUNTRIES.has(billingCountryCode.trim().toUpperCase());
}

export function getPlanDurationSeconds(planType: PlanTier): number {
  if (planType === 'exam_pass') return 7 * 86400; // 7 days, one-time
  if (planType === 'monthly') return 31 * 86400; // 1 month subscription
  if (planType === 'semester_pass') return 120 * 86400; // 4 months, one-time
  return 0;
}

export async function getOrCreateUserByEmail(
  rawEmail: string,
  db?: D1Database
): Promise<UserRecord> {
  const email = rawEmail.trim().toLowerCase();
  const existingMem = memUsersByEmail.get(email);
  if (existingMem) return existingMem;

  if (db) {
    try {
      const row = await db
        .prepare(`SELECT * FROM users WHERE email = ?1`)
        .bind(email)
        .first<any>();
      if (row) {
        const user: UserRecord = {
          id: row.id,
          email: row.email,
          referralCode: row.referral_code,
          referredByUserId: row.referred_by_user_id || undefined,
          referralRewardsCount: Number(row.referral_rewards_count) || 0,
          createdAt: Number(row.created_at) || Math.floor(Date.now() / 1000),
        };
        memUsersByEmail.set(email, user);
        memUsersById.set(user.id, user);
        memUsersByRefCode.set(user.referralCode, user);
        return user;
      }
    } catch {
      // fall through
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const id = `usr_${fnv1aHash(email)}_${nowSec.toString(36)}`;
  const referralCode = `LFC${fnv1aHash(email).slice(0, 6).toUpperCase()}`;
  const user: UserRecord = {
    id,
    email,
    referralCode,
    referralRewardsCount: 0,
    createdAt: nowSec,
  };

  memUsersByEmail.set(email, user);
  memUsersById.set(id, user);
  memUsersByRefCode.set(referralCode, user);

  if (db) {
    try {
      await db
        .prepare(
          `INSERT INTO users (id, email, referral_code, referral_rewards_count, created_at)
           VALUES (?1, ?2, ?3, 0, ?4)
           ON CONFLICT(email) DO NOTHING`
        )
        .bind(user.id, user.email, user.referralCode, user.createdAt)
        .run();
    } catch {
      // ignore
    }
  }

  return user;
}

/**
 * Grants or updates a server-side entitlement for a user.
 */
export async function upsertEntitlement(
  params: {
    id?: string;
    email: string;
    planType: PlanTier;
    status: 'active' | 'cancelled' | 'expired' | 'refunded';
    providerOrderId?: string;
    providerSubscriptionId?: string;
    billingCountry?: string;
    durationSeconds?: number;
    expiresAt?: number;
  },
  db?: D1Database
): Promise<EntitlementRecord> {
  const user = await getOrCreateUserByEmail(params.email, db);
  const nowSec = Math.floor(Date.now() / 1000);
  const duration = params.durationSeconds ?? getPlanDurationSeconds(params.planType);
  const expiresAt = params.expiresAt ?? nowSec + duration;
  const isRegional = isEligibleForRegionalPricing(params.billingCountry);
  const id =
    params.id ||
    params.providerSubscriptionId ||
    params.providerOrderId ||
    `ent_${user.id}_${nowSec}`;

  const record: EntitlementRecord = {
    id,
    userId: user.id,
    email: user.email,
    planType: params.planType,
    status: params.status,
    providerOrderId: params.providerOrderId,
    providerSubscriptionId: params.providerSubscriptionId,
    billingCountry: params.billingCountry,
    isRegionalPricing: isRegional,
    startsAt: nowSec,
    expiresAt,
  };

  memEntitlements.set(id, record);

  if (db) {
    try {
      await db
        .prepare(
          `INSERT INTO entitlements (id, user_id, email, plan_type, status, provider_order_id, provider_subscription_id, billing_country, is_regional_pricing, starts_at, expires_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10)
           ON CONFLICT(id) DO UPDATE SET
             status = ?5,
             expires_at = ?11`
        )
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
    } catch {
      // ignore
    }
  }

  return record;
}

/**
 * Checks active, non-expired, non-refunded entitlement for a user ID or email.
 */
export async function getActiveEntitlementForUser(
  userIdOrEmail: string | undefined | null,
  db?: D1Database,
  nowSec: number = Math.floor(Date.now() / 1000)
): Promise<EntitlementRecord | null> {
  if (!userIdOrEmail) return null;
  const key = userIdOrEmail.trim().toLowerCase();

  for (const ent of memEntitlements.values()) {
    if (
      (ent.userId.toLowerCase() === key || ent.email.toLowerCase() === key) &&
      (ent.status === 'active' || ent.status === 'cancelled') &&
      ent.expiresAt > nowSec
    ) {
      return ent;
    }
  }

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
        .bind(userIdOrEmail, key, nowSec)
        .first<any>();
      if (row) {
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
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Processes Lemon Squeezy (Merchant of Record) webhook payloads for:
 * - order_created / subscription_created (new purchase)
 * - subscription_updated / subscription_payment_success (renewal)
 * - subscription_cancelled (cancellation - retains access until expires_at)
 * - order_refunded (immediate revocation)
 */
export async function processPaymentWebhook(
  payload: any,
  db?: D1Database
): Promise<{ handled: boolean; eventName: string; entitlement?: EntitlementRecord }> {
  const eventName = String(
    payload?.meta?.event_name || payload?.event_name || ''
  ).trim();
  const attrs = payload?.data?.attributes || payload?.attributes || {};
  const customData = payload?.meta?.custom_data || payload?.custom_data || {};

  const email = String(
    attrs.user_email || attrs.customer_email || customData.email || ''
  )
    .trim()
    .toLowerCase();

  if (!eventName || !email) {
    return { handled: false, eventName: eventName || 'unknown' };
  }

  const rawVariant = String(
    customData.plan_type || attrs.variant_name || attrs.first_order_item?.variant_name || ''
  ).toLowerCase();

  const planType: PlanTier = rawVariant.includes('semester')
    ? 'semester_pass'
    : rawVariant.includes('month')
    ? 'monthly'
    : 'exam_pass';

  const billingCountry = String(
    attrs.billing_country || attrs.country || customData.billing_country || ''
  ).toUpperCase();

  const orderId = String(payload?.data?.id || attrs.order_number || `ord_${Date.now()}`);
  const subId = attrs.subscription_id ? String(attrs.subscription_id) : undefined;
  const nowSec = Math.floor(Date.now() / 1000);

  const eventId = String(
    payload?.meta?.event_id ||
    payload?.data?.id ||
    attrs.order_number ||
    payload?.meta?.custom_data?.webhook_id ||
    ''
  ).trim();

  // 1. Idempotency check: Ignore duplicate webhook deliveries with the same eventId
  if (eventId && memProcessedWebhooks.has(eventId)) {
    return { handled: true, eventName, duplicate: true } as any;
  }

  if (db && eventId) {
    try {
      const existing = await db
        .prepare(`SELECT event_id FROM processed_webhooks WHERE event_id = ?1`)
        .bind(eventId)
        .first();
      if (existing) {
        memProcessedWebhooks.add(eventId);
        return { handled: true, eventName, duplicate: true } as any;
      }
    } catch {
      // ignore table absence in unit tests
    }
  }

  // 2. Order Deduplication: for order_created, prevent granting a second pass if already active
  if (orderId && (eventName === 'order_created' || eventName === 'subscription_created')) {
    let existingEnt: EntitlementRecord | null = null;
    for (const ent of memEntitlements.values()) {
      if (ent.providerOrderId === orderId && ent.status === 'active') {
        existingEnt = ent;
        break;
      }
    }
    if (!existingEnt && db) {
      try {
        const row = await db
          .prepare(`SELECT * FROM entitlements WHERE provider_order_id = ?1 AND status = 'active' LIMIT 1`)
          .bind(orderId)
          .first<any>();
        if (row) {
          existingEnt = {
            id: row.id,
            userId: row.user_id,
            email: row.email,
            planType: row.plan_type as PlanTier,
            status: row.status,
            providerOrderId: row.provider_order_id,
            providerSubscriptionId: row.provider_subscription_id,
            billingCountry: row.billing_country,
            isRegionalPricing: Boolean(row.is_regional_pricing),
            startsAt: Number(row.starts_at),
            expiresAt: Number(row.expires_at),
          };
        }
      } catch {
        // ignore
      }
    }

    if (existingEnt) {
      if (eventId) memProcessedWebhooks.add(eventId);
      return { handled: true, eventName, entitlement: existingEnt, duplicate: true } as any;
    }
  }

  const markProcessed = async () => {
    if (!eventId) return;
    memProcessedWebhooks.add(eventId);
    if (db) {
      try {
        await db
          .prepare(
            `INSERT OR IGNORE INTO processed_webhooks (event_id, event_name, provider_order_id, created_at)
             VALUES (?1, ?2, ?3, ?4)`
          )
          .bind(eventId, eventName, orderId || null, nowSec)
          .run();
      } catch {
        // ignore
      }
    }
  };

  if (eventName === 'order_created' || eventName === 'subscription_created') {
    const ent = await upsertEntitlement(
      {
        id: subId || orderId,
        email,
        planType,
        status: 'active',
        providerOrderId: orderId,
        providerSubscriptionId: subId,
        billingCountry,
      },
      db
    );
    await markProcessed();
    return { handled: true, eventName, entitlement: ent };
  }

  if (
    eventName === 'subscription_updated' ||
    eventName === 'subscription_payment_success'
  ) {
    const renewsAtIso = attrs.renews_at || attrs.ends_at;
    const expiresAt = renewsAtIso
      ? Math.floor(new Date(renewsAtIso).getTime() / 1000)
      : nowSec + getPlanDurationSeconds(planType);

    const ent = await upsertEntitlement(
      {
        id: subId || orderId,
        email,
        planType,
        status: 'active',
        providerOrderId: orderId,
        providerSubscriptionId: subId,
        billingCountry,
        expiresAt,
      },
      db
    );
    await markProcessed();
    return { handled: true, eventName, entitlement: ent };
  }

  if (eventName === 'subscription_cancelled') {
    const endsAtIso = attrs.ends_at;
    const existing = await getActiveEntitlementForUser(email, db, nowSec);
    const expiresAt = endsAtIso
      ? Math.floor(new Date(endsAtIso).getTime() / 1000)
      : existing?.expiresAt || nowSec + 86400;

    const ent = await upsertEntitlement(
      {
        id: existing?.id || subId || orderId,
        email,
        planType: existing?.planType || planType,
        status: 'cancelled',
        providerOrderId: orderId,
        providerSubscriptionId: subId,
        billingCountry,
        expiresAt,
      },
      db
    );
    await markProcessed();
    return { handled: true, eventName, entitlement: ent };
  }

  if (eventName === 'order_refunded') {
    const existing = await getActiveEntitlementForUser(email, db, nowSec);
    const ent = await upsertEntitlement(
      {
        id: existing?.id || subId || orderId,
        email,
        planType: existing?.planType || planType,
        status: 'refunded',
        providerOrderId: orderId,
        providerSubscriptionId: subId,
        billingCountry,
        expiresAt: nowSec - 1, // immediately expired
      },
      db
    );
    await markProcessed();
    return { handled: true, eventName, entitlement: ent };
  }

  return { handled: false, eventName };
}

/**
 * Creates a passwordless magic link token for an email address.
 */
export async function createMagicLinkToken(
  rawEmail: string,
  db?: D1Database
): Promise<{ token: string; user: UserRecord; expiresAt: number }> {
  const user = await getOrCreateUserByEmail(rawEmail, db);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + 15 * 60; // 15 minutes
  const token = `ml_${fnv1aHash(`${user.email}:${nowSec}`)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const tokenHash = fnv1aHash(token);

  memMagicLinks.set(tokenHash, { email: user.email, expiresAt });

  if (db) {
    try {
      await db
        .prepare(
          `INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)`
        )
        .bind(tokenHash, user.email, expiresAt)
        .run();
    } catch {
      // ignore
    }
  }

  return { token, user, expiresAt };
}

export async function verifyMagicLinkToken(
  token: string,
  secret: string = 'lfc-default-edge-secret',
  db?: D1Database
): Promise<{ user: UserRecord; signedUserCookie: string } | null> {
  if (!token) return null;
  const tokenHash = fnv1aHash(token.trim());
  const nowSec = Math.floor(Date.now() / 1000);

  const memRec = memMagicLinks.get(tokenHash);
  if (memRec && !memRec.usedAt && memRec.expiresAt > nowSec) {
    memRec.usedAt = nowSec;
    const user = await getOrCreateUserByEmail(memRec.email, db);
    const signed = signAnonymousCookieId(user.id, secret);
    return {
      user,
      signedUserCookie: `lfc_uid=${encodeURIComponent(
        signed
      )}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`,
    };
  }

  if (db) {
    try {
      const row = await db
        .prepare(
          `SELECT * FROM magic_links WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2`
        )
        .bind(tokenHash, nowSec)
        .first<any>();
      if (row) {
        await db
          .prepare(`UPDATE magic_links SET used_at = ?1 WHERE token_hash = ?2`)
          .bind(nowSec, tokenHash)
          .run();
        const user = await getOrCreateUserByEmail(row.email, db);
        const signed = signAnonymousCookieId(user.id, secret);
        return {
          user,
          signedUserCookie: `lfc_uid=${encodeURIComponent(
            signed
          )}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`,
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Fraud-resistant referral reward system ("Invite a friend"):
 * When the friend creates their first deck, both get a 3-day Exam Pass.
 * Maximum 5 rewards per referrer.
 * Rejects self-referral from the same cookieId, same actorKey, or same IP hash.
 */
export async function completeReferralOnFirstDeck(params: {
  referralCode: string;
  inviteeEmail?: string;
  inviteeActorKey: string;
  inviteeCookieId: string;
  inviteeIp: string;
  referrerCookieId?: string;
  referrerIp?: string;
  db?: D1Database;
}): Promise<{
  rewarded: boolean;
  reason?: string;
  referrerEntitlement?: EntitlementRecord;
  inviteeEntitlement?: EntitlementRecord;
}> {
  const code = (params.referralCode || '').trim().toUpperCase();
  const referrer = memUsersByRefCode.get(code);
  if (!referrer) {
    return { rewarded: false, reason: 'INVALID_REFERRAL_CODE' };
  }

  // Anti-fraud check 1: Max 5 rewards per person
  if (referrer.referralRewardsCount >= MAX_REFERRAL_REWARDS) {
    return { rewarded: false, reason: 'MAX_REWARDS_REACHED' };
  }

  // Anti-fraud check 2: Cannot refer yourself by email, cookie, or same device IP
  if (
    params.inviteeEmail &&
    params.inviteeEmail.trim().toLowerCase() === referrer.email.toLowerCase()
  ) {
    return { rewarded: false, reason: 'SELF_REFERRAL_BLOCKED' };
  }
  if (
    params.referrerCookieId &&
    params.inviteeCookieId === params.referrerCookieId
  ) {
    return { rewarded: false, reason: 'SAME_COOKIE_SELF_REFERRAL_BLOCKED' };
  }
  const inviteeIpHash = fnv1aHash((params.inviteeIp || '').trim());
  const referrerIpHash = params.referrerIp
    ? fnv1aHash(params.referrerIp.trim())
    : '';
  if (referrerIpHash && inviteeIpHash === referrerIpHash) {
    return { rewarded: false, reason: 'SAME_DEVICE_SELF_REFERRAL_BLOCKED' };
  }

  // Anti-fraud check 3: Invitee actor or cookie has already claimed a referral
  for (const existingRef of memReferrals.values()) {
    if (
      existingRef.inviteeActorKey === params.inviteeActorKey ||
      existingRef.inviteeCookieId === params.inviteeCookieId
    ) {
      return { rewarded: false, reason: 'ALREADY_REWARDED' };
    }
  }

  // Record referral and grant 3-day Exam Pass to both referrer and invitee
  const refId = `ref_${referrer.id}_${Date.now()}`;
  memReferrals.set(refId, {
    id: refId,
    referrerUserId: referrer.id,
    inviteeActorKey: params.inviteeActorKey,
    inviteeIpHash,
    inviteeCookieId: params.inviteeCookieId,
    firstDeckCreated: true,
    rewardGranted: true,
  });

  referrer.referralRewardsCount += 1;

  const referrerEntitlement = await upsertEntitlement(
    {
      id: `ref_pass_${referrer.id}_${referrer.referralRewardsCount}`,
      email: referrer.email,
      planType: 'exam_pass',
      status: 'active',
      durationSeconds: REFERRAL_PASS_DURATION_SECONDS,
    },
    params.db
  );

  const inviteeEmail =
    params.inviteeEmail || `${params.inviteeCookieId}@guest.learnfromclip.com`;
  const inviteeEntitlement = await upsertEntitlement(
    {
      id: `ref_pass_inv_${params.inviteeCookieId}`,
      email: inviteeEmail,
      planType: 'exam_pass',
      status: 'active',
      durationSeconds: REFERRAL_PASS_DURATION_SECONDS,
    },
    params.db
  );

  return {
    rewarded: true,
    referrerEntitlement,
    inviteeEntitlement,
  };
}

export async function syncUserDecksToCloud(
  userId: string,
  decks: Array<{ id: string; title: string; packJson: string; updatedAt: number }>,
  db?: D1Database
): Promise<number> {
  memSyncedDecks.set(userId, decks);
  if (db) {
    for (const d of decks.slice(0, 50)) {
      try {
        await db
          .prepare(
            `INSERT INTO synced_decks (id, user_id, title, pack_json, updated_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET pack_json = ?4, updated_at = ?5`
          )
          .bind(d.id, userId, d.title, d.packJson, d.updatedAt || Date.now())
          .run();
      } catch {
        // ignore
      }
    }
  }
  return decks.length;
}

export async function loadSyncedDecksFromCloud(
  userId: string,
  db?: D1Database
): Promise<Array<{ id: string; title: string; packJson: string; updatedAt: number }>> {
  if (db) {
    try {
      const res = await db
        .prepare(`SELECT id, title, pack_json, updated_at FROM synced_decks WHERE user_id = ?1 ORDER BY updated_at DESC`)
        .bind(userId)
        .all<any>();
      if (Array.isArray(res?.results) && res.results.length > 0) {
        return res.results.map((r: any) => ({
          id: r.id,
          title: r.title,
          packJson: r.pack_json,
          updatedAt: Number(r.updated_at),
        }));
      }
    } catch {
      // fall back
    }
  }
  return memSyncedDecks.get(userId) || [];
}

export function resetMemoryAuthAndPaymentsForTests() {
  memUsersByEmail.clear();
  memUsersById.clear();
  memUsersByRefCode.clear();
  memEntitlements.clear();
  memMagicLinks.clear();
  memReferrals.clear();
  memSyncedDecks.clear();
  memProcessedWebhooks.clear();
}
