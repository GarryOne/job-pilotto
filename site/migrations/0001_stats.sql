-- Website stats (src/stats.js). No cookies, no IP addresses: "visitor" is a hash of IP + browser + a daily salt,
-- so it only tells visits apart within one day. Apply: npx wrangler@4 d1 migrations apply www-stats --remote
CREATE TABLE visits (
  day TEXT NOT NULL,        -- 2026-09-29 (UTC)
  at TEXT NOT NULL,         -- ISO time
  visitor TEXT NOT NULL,
  page TEXT NOT NULL,       -- /, /compare.html
  source TEXT NOT NULL,     -- where the visitor came from: google.com, linkedin.com, direct, or utm_source
  country TEXT NOT NULL,
  device TEXT NOT NULL      -- Mac, Windows, iPhone, Android, Linux, other
);
CREATE INDEX visits_day ON visits(day);

CREATE TABLE downloads (
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  visitor TEXT NOT NULL,
  platform TEXT NOT NULL,   -- mac, windows
  button TEXT NOT NULL,     -- header, hero, pricing, faq, compare-header, compare-bottom
  page TEXT NOT NULL,
  source TEXT NOT NULL,
  country TEXT NOT NULL,
  device TEXT NOT NULL
);
CREATE INDEX downloads_day ON downloads(day);
