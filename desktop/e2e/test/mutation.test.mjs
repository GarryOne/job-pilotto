// Every mutant still applies to today's code exactly once (a stale mutant fails here, not silently in the weekly run), and the score reads runs right.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {applyMutant, score, summary} from '../lib/mutation.mjs';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const mutants = JSON.parse(fs.readFileSync(new URL('../mutants.json', import.meta.url), 'utf8'));

test('every mutant applies to the current code exactly once, changes it, and names a suite that exists', () => {
  for (const mutant of mutants) {
    const source = fs.readFileSync(path.join(root, mutant.file), 'utf8');
    const changed = applyMutant(source, mutant);
    assert.notEqual(changed, source, mutant.id);
    assert.ok(fs.existsSync(path.join(root, 'desktop', 'e2e', 'suites', `${mutant.suite}.mjs`)), `${mutant.id}: no suite ${mutant.suite}`);
  }
  assert.equal(new Set(mutants.map(item => item.id)).size, mutants.length, 'ids are unique');
});

test('a stale or ambiguous mutant is an error, never a silent pass', () => {
  assert.throws(() => applyMutant('abc', {id: 'x', file: 'f', find: 'zzz', replace: 'y'}), /no longer in f/);
  assert.throws(() => applyMutant('aa', {id: 'x', file: 'f', find: 'a', replace: 'b'}), /more than once/);
});

test('red kills, green survives, a red baseline makes it unknown; the score counts only judged mutants', () => {
  const list = [{id: 'm1', suite: 's', what: 'a'}, {id: 'm2', suite: 's', what: 'b'}, {id: 'm3', suite: 't', what: 'c'}];
  const result = score(list, {'baseline:s': 'success', m1: 'failure', m2: 'success', 'baseline:t': 'failure', m3: 'failure'});
  assert.deepEqual(result.rows.map(row => row.outcome), ['killed', 'survived', 'unknown']);
  assert.equal(result.score, 50);
  assert.match(summary(result), /50% of the planted code bugs caught \(1 caught, 1 missed, 1 unknown\)/);
});

test('a finding the baseline did not raise kills a mutant too: a truth check files, it does not turn the suite red', () => {
  const list = [{id: 'day', suite: 'calendar', what: 'a day is lost'}];
  const kept = score(list, {'baseline:calendar': {conclusion: 'success', findings: ['tiny-text|calendar']}, day: {conclusion: 'success', findings: ['tiny-text|calendar', 'wrong-result|calendar']}});
  assert.equal(kept.rows[0].outcome, 'killed');
  assert.match(kept.rows[0].why, /wrong-result\|calendar/);
  const same = score(list, {'baseline:calendar': {conclusion: 'success', findings: ['tiny-text|calendar']}, day: {conclusion: 'success', findings: ['tiny-text|calendar']}});
  assert.equal(same.rows[0].outcome, 'survived', 'what the baseline also raised says nothing');
});
