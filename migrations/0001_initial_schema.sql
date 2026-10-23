-- Migration: 0001_initial_schema.sql
-- TextFromClip Operational Schema for Cloudflare D1 (SQLite)

-- Jobs table for ephemeral metadata and status tracking
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    video_id TEXT NOT NULL,
    video_title TEXT,
    video_duration_seconds REAL DEFAULT 0,
    source_type TEXT NOT NULL, -- 'captions' | 'ai_whisper' | 'failed'
    status TEXT NOT NULL,      -- 'queued' | 'processing' | 'completed' | 'failed'
    language TEXT DEFAULT 'en',
    segment_count INTEGER DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

-- Index for expiration cleanup and provider lookup
CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs (expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_video_provider ON jobs (provider, video_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);

-- Minimal aggregate usage metrics (no PII, no URLs, strictly aggregated counters)
CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL, -- 'request_start' | 'request_success' | 'request_error'
    provider TEXT NOT NULL,
    source_type TEXT,
    status_code INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events (created_at DESC);

-- Distributed rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
    ip_hash TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

