-- What the installs teach about the job search itself (Notion: "Knowledge as data"). Counts only, by coarse fixed-list tags: no job title,
-- no company, no text, no install. Each table is a day's counts; the owner's /intelligence page reads them.
CREATE TABLE intel_terms (        -- role words people accepted from the "your search is narrow" card (a fixed vocabulary), per role and region
  day TEXT NOT NULL, term TEXT NOT NULL, role TEXT NOT NULL, region TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, term, role, region)
);
CREATE TABLE intel_coverage (     -- per crawl report: postings in the wanted places, and how many the role keywords caught
  day TEXT NOT NULL, role TEXT NOT NULL, region TEXT NOT NULL, reports INTEGER NOT NULL DEFAULT 0, in_places INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, role, region)
);
CREATE TABLE intel_missed (       -- ... and how many in-place postings each fixed role word would have added
  day TEXT NOT NULL, role TEXT NOT NULL, region TEXT NOT NULL, term TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, role, region, term)
);
CREATE TABLE intel_dismiss (      -- why a job was dismissed, by the job's fit-score band
  day TEXT NOT NULL, reason TEXT NOT NULL, bucket TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, reason, bucket)
);
CREATE TABLE intel_scores (       -- a daily snapshot: jobs per score band and what became of them (new, saved, applied, replied ...)
  day TEXT NOT NULL, bucket TEXT NOT NULL, state TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, bucket, state)
);
