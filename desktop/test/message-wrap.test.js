// A .message line (e.g. a raw API error in #cv-message) must wrap long unbroken text instead of spilling out of its box.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('.message wraps long unbroken text', () => {
  const css = fs.readFileSync(path.join(here, '..', 'renderer', 'style.css'), 'utf8');
  const rule = css.match(/^\.message\s*\{([^}]*)\}/m);
  assert.ok(rule, '.message rule exists');
  assert.match(rule[1], /overflow-wrap:\s*anywhere/);
});
