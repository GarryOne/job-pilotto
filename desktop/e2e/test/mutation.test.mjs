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

// The source of the steps a suite really runs: a suite that runs parts of another (failuresnotion runs activityfailures' 'notion' part) runs only those blocks.
function stepsRunBy(suite) {
  const own = fs.readFileSync(path.join(root, 'desktop', 'e2e', 'suites', `${suite}.mjs`), 'utf8');
  const parts = /runParts\(ctx, \[([^\]]+)\]\)/.exec(own)?.[1].match(/'([\w-]+)'/g)?.map(word => word.slice(1, -1));
  const from = /import \{runParts\} from '\.\/([\w-]+)\.mjs'/.exec(own)?.[1] || suite;
  if (!parts) return own;
  const source = fs.readFileSync(path.join(root, 'desktop', 'e2e', 'suites', `${from}.mjs`), 'utf8');
  return [...source.matchAll(/if \(parts\.includes\('([\w-]+)'\)\) \{([^]*?)(?=\n  if \(parts\.includes\(|\nexport )/g)].filter(([, part]) => parts.includes(part)).map(([, , block]) => block).join('\n');
}

// 12 Oct 2026: raw-http-error named activityfailures, but the step that catches it (an HTML error page from Notion) had moved to failuresnotion when the suite was
// split in three: the mutant "survived" a suite that never ran that step (#354). Each mutant names the words of the step that catches it, and they must be in
// the steps its suite runs.
test('every mutant names the step that catches it, and its suite runs that step', () => {
  for (const mutant of mutants) {
    assert.ok(mutant.catches, `${mutant.id}: no "catches" (the words of the step that turns red when this bug is in the app)`);
    assert.ok(stepsRunBy(mutant.suite).includes(mutant.catches), `${mutant.id}: the ${mutant.suite} suite runs no step with "${mutant.catches}"`);
  }
  assert.ok(!stepsRunBy('activityfailures').includes('Notion answers an HTML error page'), 'the parts model is right: the AI part does not run the Notion steps');
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
