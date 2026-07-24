CREATE TABLE IF NOT EXISTS apk_download_daily (
  day TEXT NOT NULL,
  version_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, version_name, provider)
);
