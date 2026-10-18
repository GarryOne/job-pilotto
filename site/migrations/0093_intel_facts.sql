-- Which facts of Your details forms asked an install (site/src/fact-asks.js): a fixed fact id and an install digest, no text. Counted per fact (3+ installs) for the missing-facts order.
CREATE TABLE IF NOT EXISTS intel_facts (fact TEXT NOT NULL, install TEXT NOT NULL, last_day TEXT NOT NULL, PRIMARY KEY (fact, install));
CREATE INDEX IF NOT EXISTS intel_facts_day ON intel_facts (last_day);
