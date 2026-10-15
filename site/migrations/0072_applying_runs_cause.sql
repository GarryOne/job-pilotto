-- Why a pool row ended where it did: one fixed word (extension/ladder/endings.js CAUSES), validated on upload; older runs have none (the Resolution table shows a dash).
ALTER TABLE applying_runs ADD COLUMN cause TEXT;
