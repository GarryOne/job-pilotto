-- The pool's life cycle (src/applying-stage.js): a row's own data, uploaded with the pool: 'watch' (the daily list) or 'archived' (+ why: fixed | working | posting-gone). NULL = derived.
ALTER TABLE applying_pool ADD COLUMN stage TEXT;
ALTER TABLE applying_pool ADD COLUMN stage_why TEXT;
