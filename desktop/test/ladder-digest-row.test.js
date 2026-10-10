// One row of the digest score (e2e/lib/ladder-digest-row.mjs): the validated answer next to what the model itself said (raw), the press_kind it gave the control it chose, and what the validator
// dropped. Why: 11 Oct 2026, a digest answer that was dropped or pressed the wrong control looked like a bare "miss"; the reason (a number outside the candidates, a sign-in judged "apply") was not on the line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {digestRow, digestRowLine} from '../e2e/lib/ladder-digest-row.mjs';

const fixture = {id: 'jobs-ch-x', source: 'captured', trap: false, expect: {outcome: 'posting'}};
const hit = {outcome: 'form', verb: 'press', numbers: [1], confidence: 0.9, chosen: [{n: 1, kind: 'button', text: 'Apply now'}], raw: {outcome: 'form', verb: 'press', numbers: [1], press_kind: 'apply', confidence: 0.9}};
const dropped = {outcome: 'other', verb: 'none', numbers: [], confidence: 0.9, dropped: 'unknown candidate number', raw: {outcome: 'form', verb: 'press', numbers: [99], press_kind: 'apply', confidence: 0.9}};

test('a hit carries the model\'s own answer and the press_kind of the control it chose', () => {
  const row = digestRow(fixture, hit);
  assert.deepEqual([row.status, row.pressKind, row.dropped], ['hit', 'apply', '']);
  assert.deepEqual(row.raw, {outcome: 'form', verb: 'press', numbers: [1]});
  assert.match(digestRowLine(row), /want form\s+got form\s+press\s+\[1\].*press_kind=apply/);
});

test('a dropped answer says why, and what the model had said before the validator removed it', () => {
  const row = digestRow(fixture, dropped);
  assert.equal(row.status, 'wrong-confident');   // 0.9 sure, outside the wanted outcomes
  assert.equal(row.dropped, 'unknown candidate number');
  const line = digestRowLine(row);
  assert.match(line, /dropped=unknown candidate number/);
  assert.match(line, /raw=form\/press\/\[99\]/);
  assert.match(line, /press_kind=apply/);
});

test('an error row says the error and nothing else is invented', () => {
  const row = digestRow(fixture, {error: 'not JSON'});
  assert.deepEqual([row.outcome, row.status, row.pressKind, row.dropped], ['error: not JSON', 'miss', '', '']);
  assert.match(digestRowLine(row), /got error: not JSON/);
});

test('a row never carries a candidate\'s text, only its number and kind', () => {
  const row = digestRow(fixture, hit);
  assert.deepEqual(row.chosen, ['1:button']);
  assert.equal(JSON.stringify(row).includes('Apply now'), false);
});
