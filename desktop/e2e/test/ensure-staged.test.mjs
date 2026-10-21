// The gate's plan loads every suite, and suites/apply.mjs imports desktop/lib/ladder/rung2-sketch.js, which needs the gitignored desktop/shared/: a CI step that never staged it
// crashed plan-run.mjs (hidden by a pipe), so every release gate skipped its E2E and Release jobs from 18 Oct 2026 (e2c7b7e) until 21 Oct.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {ensureStaged} from '../lib/ensure-staged.mjs';
import {suiteFacts} from '../plan-run.mjs';

const desktop = () => fs.mkdtempSync(path.join(os.tmpdir(), 'staged-'));

test('a desktop folder without shared/ is staged once; one with it is left alone', () => {
  const dir = desktop(), calls = [];
  assert.equal(ensureStaged(dir, (...args) => calls.push(args)), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], [path.join(dir, 'scripts', 'stage.mjs'), '--files-only']);
  fs.mkdirSync(path.join(dir, 'shared'));
  fs.writeFileSync(path.join(dir, 'shared', 'alias-schema.js'), '');
  assert.equal(ensureStaged(dir, () => assert.fail('staged again')), false);
});

test('plan-run stages before it loads the suites (every workflow that plans a gate goes through suiteFacts)', () => {
  const source = fs.readFileSync(new URL('../plan-run.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function suiteFacts'));
  assert.ok(body.indexOf('ensureStaged(') > 0 && body.indexOf('ensureStaged(') < body.indexOf("await import('./lib/context.mjs')"));
  assert.equal(typeof suiteFacts, 'function');
});

test('every suite run stages before it loads the suite (the CI suite jobs stage nothing)', () => {
  const source = fs.readFileSync(new URL('../lib/suite-main.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('ensureStaged(') > 0 && source.indexOf('ensureStaged(') < source.indexOf('await import(`../suites/${name}.mjs`)'));
});
