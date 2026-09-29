-- Feedback people send from the Job Pilotto app (site/src/feedback.js; the app's "Send feedback…"). Their own words,
-- an optional contact they chose to give, the app version. Read by the owner (Brain bot) and the product brain.
CREATE TABLE feedback (
  at TEXT NOT NULL,        -- when received (UTC)
  day TEXT NOT NULL,
  install TEXT NOT NULL,   -- the app's random install id
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  text TEXT NOT NULL,      -- ≤ 2000 characters
  contact TEXT NOT NULL    -- optional email or handle, '' when not given
);
CREATE INDEX feedback_day ON feedback(day);
