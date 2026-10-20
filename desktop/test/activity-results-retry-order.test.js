// Retry on the "No result was saved" card must not hit a const still in its temporal dead zone (Sentry JOB-PILOTTO-APP-2X).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('read is declared before the early show() return that can leave it uninitialized', () => {
  const src = fs.readFileSync(new URL('../renderer/pages/activity-results.js', import.meta.url), 'utf8');
  const early = src.indexOf('if (run.message || !run.pageId)');
  const decl = src.indexOf('const read =');
  assert.ok(early > 0 && decl > 0);
  assert.ok(decl < early, 'retry -> load() -> read() throws ReferenceError when the early return skipped the declaration');
});
