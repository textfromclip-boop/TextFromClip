-- Cookieless page-view analytics for the private admin dashboard.
-- No IP addresses are stored. visitor_hash is a salted SHA-256 of (day, IP, user agent) that changes
-- every day, so it counts unique visitors per day but cannot follow a person across days.
CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  utc_date TEXT NOT NULL,
  path TEXT NOT NULL,
  country TEXT,
  city TEXT,
  referrer TEXT,
  device TEXT,
  browser TEXT,
  os TEXT,
  visitor_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_page_views_date ON page_views(utc_date);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);
