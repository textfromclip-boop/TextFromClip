-- Migration: 0003_audit_hardening.sql
-- Security / correctness fixes from the launch audit.

-- 1. Webhook idempotency: every processed Lemon Squeezy delivery is recorded by the SHA-256 of
--    its raw body, so a re-delivered or replayed event can never grant access twice.
CREATE TABLE IF NOT EXISTS webhook_events (
    event_hash TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    received_at INTEGER NOT NULL
);

-- 2. Synced decks are owned per user. The old table used a global PRIMARY KEY (id), so one user
--    could overwrite another user's deck by reusing its id. Rebuild with (user_id, id).
CREATE TABLE IF NOT EXISTS synced_decks_v2 (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    pack_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
);
INSERT OR IGNORE INTO synced_decks_v2 (id, user_id, title, pack_json, updated_at, created_at)
    SELECT id, user_id, title, pack_json, updated_at, created_at FROM synced_decks;
DROP TABLE IF EXISTS synced_decks;
ALTER TABLE synced_decks_v2 RENAME TO synced_decks;
CREATE INDEX IF NOT EXISTS idx_synced_decks_user ON synced_decks (user_id, updated_at DESC);

-- 3. Referral anti-fraud: remember the device fingerprint (IP + user-agent hash) that created a
--    referral code, and allow each invitee identity to be rewarded only once.
ALTER TABLE users ADD COLUMN referral_device_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_invitee_actor_unique ON referrals (invitee_actor_key);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee_ip ON referrals (invitee_ip_hash, created_at);

-- 4. Entitlement lookups by provider ids (refunds, subscription updates).
CREATE INDEX IF NOT EXISTS idx_entitlements_order ON entitlements (provider_order_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_sub ON entitlements (provider_subscription_id);

-- 5. Google Sign-In profile columns on users.
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN picture TEXT;
ALTER TABLE users ADD COLUMN google_sub TEXT;
