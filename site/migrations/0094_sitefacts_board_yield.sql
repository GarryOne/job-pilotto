-- What a job board gave the install that shares it (src/contribute.py site_facts 'yield', 18 Oct 2026, spec 2026-10-18-search-learns-sources.md PR 6):
-- its jobs in the install's places and those with a fit of 70+, plus the install's fixed-list countries and role families. Summed per role
-- family × country and served in the employer index only for a cell 3+ installs share (employers.js agreedSites), so installs read the boards
-- that gave others their jobs first. Counts and fixed ids only.
ALTER TABLE sitefacts ADD COLUMN in_places INTEGER;
ALTER TABLE sitefacts ADD COLUMN fit70 INTEGER;
ALTER TABLE sitefacts ADD COLUMN countries TEXT;
ALTER TABLE sitefacts ADD COLUMN families TEXT;
