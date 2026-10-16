-- The Pro plan (spec docs/superpowers/specs/2026-10-16-pro-plan.md §1): an account per e-mail, up to 3 devices, the AI credit ledger, the purchases.
-- Money is micro-USD (1e-6 $), like ai_calls. An install is only ever its digest (guard.js digestOf), never the raw install id.
CREATE TABLE pro_accounts (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',          -- active | refunded | disputed
  credit_micro INTEGER NOT NULL DEFAULT 0,        -- what is left; may dip below 0 by the small overdraft so an application in progress finishes
  credit_added_micro INTEGER NOT NULL DEFAULT 0   -- every credit ever added (purchases, adjustments) minus refunds: "AI credit: N% left" is credit / this
);
CREATE TABLE pro_devices (
  install TEXT PRIMARY KEY,                       -- the raw random install id, the same value as telemetry.install (random, no personal data): one install belongs to one account
  account TEXT NOT NULL,
  added_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX pro_devices_account ON pro_devices (account);
CREATE TABLE pro_purchases (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  kind TEXT NOT NULL,                             -- pro | topup5 | topup10 | topup20
  amount_cents INTEGER NOT NULL,                  -- the price paid, VAT included
  currency TEXT NOT NULL,
  credit_micro INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid',            -- paid | refunded | disputed
  at TEXT NOT NULL,
  provider TEXT NOT NULL,                         -- adapter-neutral: 'stripe' today
  provider_ref TEXT NOT NULL,
  country TEXT,                                   -- ISO2 billing country
  tax_cents INTEGER,                              -- the VAT the tax service computed
  fee_cents INTEGER,                              -- the processor fee, null until the balance transaction is known
  UNIQUE (provider, provider_ref)
);
CREATE INDEX pro_purchases_account ON pro_purchases (account);
CREATE TABLE pro_credit (                         -- append-only: balance = sum(delta_micro) (pro_accounts.credit_micro is its cached total)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  delta_micro INTEGER NOT NULL,
  reason TEXT NOT NULL,                           -- purchase | ai_call | refund | adjust
  ref TEXT,
  at TEXT NOT NULL
);
CREATE INDEX pro_credit_account ON pro_credit (account);
CREATE TABLE payment_events (                     -- webhook event ids already handled (replay-safe)
  id TEXT NOT NULL,
  provider TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (provider, id)
);
