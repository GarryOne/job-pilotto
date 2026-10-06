-- The pool is added up in SQL, page by page, by feed and by dead-end key (scale, 7 Oct 2026): these keep each page an index range.
CREATE INDEX IF NOT EXISTS contributions_feed ON contributions(ats, slug);
CREATE INDEX IF NOT EXISTS nofeed_key ON nofeed(key);
