-- "No readable job site" results installs share (src/contribute.py nofeed): a company name and its website host, per install, kept 90 days like
-- contributions. The central scout publishes them with the index so other installs do not probe the same employer again for 30 days.
CREATE TABLE nofeed (
  install TEXT NOT NULL,
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  company TEXT NOT NULL,
  host TEXT,
  PRIMARY KEY (install, key)
);
CREATE INDEX nofeed_day ON nofeed(day);
