-- Trial accounts (owner, 16 Oct 2026): the onboarding wizard may ask for an e-mail (Skip allowed) and make a TRIAL account on the server, so the trial, hosted Always on and a later
-- Pro purchase share one account. `status` keeps meaning the payment state (active | refunded | disputed); the new `plan` says trial or pro, and only plan = 'pro' AND status = 'active'
-- gets the Pro lane. Existing rows were made by a purchase: they are Pro. Spec: docs/superpowers/specs/2026-10-16-pro-plan.md; hosted trial: 2026-10-16-hosted-always-on.md.
ALTER TABLE pro_accounts ADD COLUMN plan TEXT NOT NULL DEFAULT 'pro';           -- 'trial' | 'pro'
ALTER TABLE pro_accounts ADD COLUMN email_confirmed_at TEXT;                     -- ISO, null until the address is confirmed
ALTER TABLE pro_accounts ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0; -- 0 | 1; an opt-out just sets 0
ALTER TABLE pro_accounts ADD COLUMN marketing_opt_in_at TEXT;
ALTER TABLE pro_accounts ADD COLUMN trial_started_at TEXT;                       -- ISO: the 60-day trial end and the "trial ending" reminder read it
ALTER TABLE pro_accounts ADD COLUMN service_mail_off_at TEXT;                    -- ISO: the service-mail unsubscribe
