-- How applications went, as told by users with one click ("Heard back: a reply"): counted by job board, outcome and coarse days since applying.
-- No company, no role, no address and no install: the one thing that identifies where someone applied is deliberately not sent. Product data only.
CREATE TABLE application_outcomes (
  day TEXT NOT NULL,
  board TEXT NOT NULL,         -- a known board name, or a short hash of any other site
  outcome TEXT NOT NULL,       -- reply, screening, offer, rejected, no_response
  days TEXT NOT NULL,          -- 0-3, 4-7, 8-14, 15-30, 31+ or ''
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board, outcome, days)
);
