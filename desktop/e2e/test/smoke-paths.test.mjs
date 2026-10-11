// The two path guards of the pool (lib/smoke-paths.mjs): a plain-node row that reaches less than its last result is re-run on Electron and is a regression only
// when Electron shows it too; a paired sample each pass, least recently paired first, with the report's first line saying whether the paths agree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {compare} from '../lib/smoke.mjs';
import {agree, lastPaired, lessThanLast, pairResult, pairedLine, pairedSample, pathDifferenceLine} from '../lib/smoke-paths.mjs';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://jobs.example.org/1';

// The class: every kind of regression compare() counts triggers the re-run, and nothing else does.
const KINDS = [
  {name: 'reached an earlier step', before: {url: URL, reached: 'form', filled: 5}, now: {url: URL, reached: 'posting', filled: null}},
  {name: 'filled fewer on the same posting', before: {url: URL, reached: 'form', filled: 5}, now: {url: URL, reached: 'form', filled: 3}},
];
test('every regression compare() counts makes the row "less than its last", and an equal or better row does not', () => {
  for (const kind of KINDS) {
    assert.equal(compare({s: kind.before}, {s: kind.now}).length, 1, `${kind.name}: compare counts it`);
    assert.ok(lessThanLast(kind.before, kind.now), `${kind.name}: no re-run`);
  }
  assert.equal(lessThanLast({url: URL, reached: 'form', filled: 5}, {url: URL, reached: 'form', filled: 5}), '');
  assert.equal(lessThanLast({url: URL, reached: 'form', filled: 5}, {url: URL, reached: 'ready', filled: 6}), '');
  assert.equal(lessThanLast(null, {url: URL, reached: 'posting'}), '', 'no last result: nothing to fall below');
});

test('a fall on plain node that Electron does not show is a path difference, not a regression; one Electron shows too stands', () => {
  const previous = {url: URL, reached: 'form', filled: 5}, node = {url: URL, reached: 'posting', filled: null};
  const differs = pairResult(node, {url: URL, reached: 'form', filled: 5}, {day: '2026-10-11', previous});
  assert.match(differs.pathDifference, /plain node posting, Electron form 5 filled \(reached posting, last time form\)/);
  assert.equal(differs.paired.agree, false);
  const both = pairResult(node, {url: URL, reached: 'posting', filled: null}, {day: '2026-10-11', previous});
  assert.equal(both.pathDifference, undefined, 'Electron shows it too: the regression stands');
  assert.match(pathDifferenceLine({Teamtailor: {...node, ...differs}}), /^PATH DIFFERENCE .*Teamtailor: plain node posting/);
  assert.equal(pathDifferenceLine({Teamtailor: {...node, ...both}}), '');
});

test('the paths agree within one field on the same step', () => {
  assert.equal(agree({reached: 'form', filled: 5}, {reached: 'form', filled: 6}), true);
  assert.equal(agree({reached: 'form', filled: 5}, {reached: 'form', filled: 7}), false);
  assert.equal(agree({reached: 'form', filled: 5}, {reached: 'posting', filled: 5}), false);
  assert.equal(agree({reached: 'form'}, null), false);
});

test('the paired sample takes the never paired first, then the oldest pairing, in the pool\'s order on a tie', () => {
  const chosen = ['A', 'B', 'C', 'D'].map(shape => ({shape}));
  const paired = lastPaired([{results: {A: {paired: {day: '2026-10-10'}}, B: {paired: {day: '2026-10-09'}}}}, {results: {A: {paired: {day: '2026-10-11'}}}}]);
  assert.deepEqual(paired, {A: '2026-10-11', B: '2026-10-09'});
  assert.deepEqual(pairedSample(chosen, paired, 2), ['C', 'D']);
  assert.deepEqual(pairedSample(chosen, paired, 3), ['C', 'D', 'B']);
  assert.deepEqual(pairedSample(chosen, {}, 0), []);
});

test('the report\'s first line says the sample agrees, or names the rows that differ', () => {
  const ok = {A: {reached: 'form', filled: 6, paired: {electron: {reached: 'form', filled: 5}, agree: true}}};
  assert.equal(pairedLine(ok), 'paired sample: 1 rows, all within +-1');
  const off = {...ok, B: {reached: 'posting', filled: null, paired: {electron: {reached: 'form', filled: 4}, agree: false}}};
  assert.equal(pairedLine(off), 'paired sample: 2 rows; DIFFER: B (plain node posting, Electron form 4 filled)');
  assert.equal(pairedLine({}), 'paired sample: none this pass');
});

test('smoke.mjs wires both guards: the Electron re-run on a fall, the paired sample, and both lines first in the summary', () => {
  const source = fs.readFileSync(path.join(E2E, 'smoke.mjs'), 'utf8');
  assert.match(source, /lessThanLast\(/, 'a fall on plain node is checked');
  assert.match(source, /liveRun\(posting, seconds, '', 'electron'\)/, 'the re-run is on Electron, the same posting');
  assert.match(source, /pairedSample\(/, 'a paired sample is chosen each pass');
  assert.match(source, /the run did not finish: \$\{lastError\(again\.output\)\}/, 'an Electron leg that did not finish says why');
  const first = source.indexOf('console.log(`smoke: ${pairedLine(results)}`)'), regressionsLine = source.indexOf("REGRESSIONS:");
  assert.ok(first > 0 && first < regressionsLine, 'the paired line comes before the regressions');
});

test('a row with a path difference is no regression anywhere the pool counts one (compare: the day\'s summary and each site\'s record)', () => {
  const before = {url: URL, reached: 'form', filled: 5}, now = {url: URL, reached: 'posting', filled: null};
  assert.equal(compare({s: before}, {s: now}).length, 1);
  assert.deepEqual(compare({s: before}, {s: {...now, pathDifference: 'plain node posting, Electron form 5 filled'}}), []);
});
