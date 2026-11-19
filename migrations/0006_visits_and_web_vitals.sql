-- Visits (first page of a page load) and real-user speed samples for the admin console.
-- The Worker also creates these on first use if this migration has not been applied.
ALTER TABLE page_views ADD COLUMN is_entry INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_page_views_created_entry ON page_views(created_at, is_entry);

CREATE TABLE IF NOT EXISTS web_vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  utc_date TEXT NOT NULL,
  path TEXT NOT NULL,
  country TEXT,
  device TEXT,
  browser TEXT,
  os TEXT,
  lcp_ms INTEGER,
  inp_ms INTEGER,
  cls REAL,
  ttfb_ms INTEGER,
  load_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_web_vitals_created ON web_vitals(created_at);
