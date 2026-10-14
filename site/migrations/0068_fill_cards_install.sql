-- Which install a user's fill card came from (the same salted hash as host_uses.install), only to COUNT distinct installs: /admin/form-filling shows no percentage or ranking
-- of real fills until 3+ installs reported some (src/thin-data.js). Never served, never joined to anything. Cards before this stay '' (not counted as an install).
ALTER TABLE fill_cards ADD COLUMN install TEXT NOT NULL DEFAULT '';
