-- Facts about employer sites that installs learn while reading them (src/contribute.py sites, 7 Oct 2026): where a company's job list is
-- (jobpage, with its address), that a site is readable only in a person's browser (browser), and a job page that is gone (dead). One row
-- per install, host and kind, kept 90 days like contributions. Served to every install once 3 installs agree (k >= 3), so none has to
-- look a job page up with AI, probe a browser-only site, or retry a dead page. Public facts about sites only, never who read them.
CREATE TABLE IF NOT EXISTS sitefacts (
  install TEXT NOT NULL,
  day TEXT NOT NULL,
  host TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  PRIMARY KEY (install, host, kind)
);
CREATE INDEX IF NOT EXISTS sitefacts_day ON sitefacts(day);
CREATE INDEX IF NOT EXISTS sitefacts_fact ON sitefacts(host, kind, url);
