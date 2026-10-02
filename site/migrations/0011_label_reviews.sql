-- Wordings the alias proposer already looked at and found to mean nothing we fill (salary, "Search jobs", "Careers" ...): not proposed again for a while.
CREATE TABLE label_reviews (
  label TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,       -- none
  day TEXT NOT NULL
);
