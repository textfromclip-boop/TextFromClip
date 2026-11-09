-- Migration: 0002_learnfromclip_schema.sql
-- LearnFromClip Schema for Caching, Daily Quotas, Auth, Entitlements, Synced Decks, Referrals & Cost Telemetry

-- 1. Cached Transcripts (by provider + video_id + language)
CREATE TABLE IF NOT EXISTS cached_transcripts (
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
);

CREATE INDEX IF NOT EXISTS idx_cached_transcripts_lookup ON cached_transcripts (provider, video_id);

-- 2. Cached Revision Packs (by transcript_hash + settings)
CREATE TABLE IF NOT EXISTS cached_packs (
    pack_cache_key TEXT PRIMARY KEY,
    transcript_hash TEXT NOT NULL,
    second_language TEXT NOT NULL DEFAULT '',
    max_cards INTEGER NOT NULL DEFAULT 30,
    pack_json TEXT NOT NULL,
    dropped_quotes_count INTEGER NOT NULL DEFAULT 0,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cached_packs_hash ON cached_packs (transcript_hash);

-- 3. Daily Usage Quotas (resets daily at 00:00 UTC)
CREATE TABLE IF NOT EXISTS daily_quotas (
    actor_key TEXT NOT NULL,
    utc_date TEXT NOT NULL,
    links_used INTEGER NOT NULL DEFAULT 0,
    upload_seconds_used REAL NOT NULL DEFAULT 0,
    ai_actions_half_units INTEGER NOT NULL DEFAULT 0, -- 2 half-units = 1.0 AI action; 1 half-unit = 0.5 AI action
    mock_exams_used INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (actor_key, utc_date)
);

-- 4. Users & Passwordless Magic Links
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    referral_code TEXT UNIQUE NOT NULL,
    referred_by_user_id TEXT,
    referral_rewards_count INTEGER NOT NULL DEFAULT 0,
    streak_days INTEGER NOT NULL DEFAULT 0,
    last_study_utc_date TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
);

-- 5. Paid Plan Entitlements (Exam Pass, Monthly, Semester Pass, Referral Pass)
CREATE TABLE IF NOT EXISTS entitlements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    plan_type TEXT NOT NULL, -- 'exam_pass' | 'monthly' | 'semester_pass' | 'referral_pass'
    status TEXT NOT NULL,    -- 'active' | 'cancelled' | 'expired' | 'refunded'
    provider_order_id TEXT,
    provider_subscription_id TEXT,
    billing_country TEXT,
    is_regional_pricing INTEGER NOT NULL DEFAULT 0,
    starts_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements (user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_entitlements_email ON entitlements (email, status, expires_at);

-- 6. Cloud-Synced Study Decks (for Paid Users)
CREATE TABLE IF NOT EXISTS synced_decks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    provider TEXT,
    video_id TEXT,
    source_url TEXT,
    pack_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synced_decks_user ON synced_decks (user_id, updated_at DESC);

-- 7. Fraud-Resistant Referrals ("Invite a friend" -> 3-day Exam Pass when friend creates first deck, max 5)
CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    referrer_user_id TEXT NOT NULL,
    invitee_actor_key TEXT NOT NULL,
    invitee_ip_hash TEXT NOT NULL,
    invitee_cookie_id TEXT NOT NULL,
    first_deck_created INTEGER NOT NULL DEFAULT 0,
    reward_granted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee ON referrals (invitee_actor_key);

-- 8. Daily Cost & Cache Telemetry
CREATE TABLE IF NOT EXISTS cost_telemetry (
    utc_date TEXT PRIMARY KEY,
    whisper_audio_seconds REAL NOT NULL DEFAULT 0,
    llm_input_tokens INTEGER NOT NULL DEFAULT 0,
    llm_output_tokens INTEGER NOT NULL DEFAULT 0,
    transcript_cache_hits INTEGER NOT NULL DEFAULT 0,
    transcript_cache_misses INTEGER NOT NULL DEFAULT 0,
    pack_cache_hits INTEGER NOT NULL DEFAULT 0,
    pack_cache_misses INTEGER NOT NULL DEFAULT 0
);

-- 9. Privacy-Friendly Analytics Events (no PII)
CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT NOT NULL,
    route_path TEXT,
    plan_type TEXT DEFAULT 'free',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time ON analytics_events (event_name, created_at DESC);

-- 10. Webhook Idempotency (prevents duplicate pass grants)
CREATE TABLE IF NOT EXISTS processed_webhooks (
    event_id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    provider_order_id TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_order ON processed_webhooks (provider_order_id);
