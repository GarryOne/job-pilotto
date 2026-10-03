-- The employer index in D1 (src/employers.js): one row per feed, with the coarse regions it hires in (fixed list, pool.js REGIONS),
-- so an install downloads only the slice for its own regions instead of the whole list. The KV copy stays for older app versions.
CREATE TABLE IF NOT EXISTS index_feeds (
  ats TEXT NOT NULL,
  slug TEXT NOT NULL,
  regions TEXT NOT NULL DEFAULT ',',   -- ",europe,remote," (LIKE-matched); "," when the feed's places are unknown
  body TEXT NOT NULL,                  -- the cleaned feed as JSON, exactly what a client receives
  generated TEXT NOT NULL,
  PRIMARY KEY (ats, slug)
);
