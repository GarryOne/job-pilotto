-- Who may use the recipe library and the employer index, and what looks wrong (src/guard.js). Nobody is named: `who` is a short digest
-- of the install id (or of the network address for token minting), so the owner can see a pattern without a person behind it.
-- anomalies: a quota reached, minting pressure, a honeypot touched: counted per day. revoked: installs whose tokens no longer work.
-- honeypots: decoy fingerprints that no real form produces; an install that asks for one is scanning the library.
CREATE TABLE anomalies (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,          -- quota, mint, honeypot, index-quota
  who TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 1,
  detail TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (day, kind, who)
);
CREATE TABLE revoked (
  who TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE honeypots (
  fingerprint TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
