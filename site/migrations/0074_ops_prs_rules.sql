-- Which version of the category rules (src/ops-categories.js RULES_VERSION) put a PR in its category: a newer version re-reads and replaces the row.
ALTER TABLE ops_prs ADD COLUMN rules INTEGER NOT NULL DEFAULT 0;
