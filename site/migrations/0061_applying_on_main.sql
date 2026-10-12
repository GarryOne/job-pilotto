-- A Mac run counts in the Resolution tile only when the extension it ran is main's (cc's review, 12 Oct 2026; src/applying-resolution.js): the uploader sends onMain, true when the
-- extension's fingerprint (its files, the version left out) equals the one main records (desktop/e2e/lib/applying-report.mjs buildOnMain). 1: main's build; 0 or null (older
-- uploads): a branch or unknown, kept out of the tile like a PR's run.
ALTER TABLE applying_runs ADD COLUMN on_main INTEGER;
