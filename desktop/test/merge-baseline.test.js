// The ladder baseline's merge driver: two sessions' baseline updates on different fixtures merge; the same fixture changed both ways stops.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {mergeBaselines} from '../../tools/merge-baseline.mjs';

const fixture = (outcome, status = 'exact') => ({expect: {outcome}, outcome, status});
const base = {schemaVersion: 1, reasons: [{date: 'd0', reason: 'start'}], promptFingerprint: {rung2: 'a', rung3: 'b'}, fixtures: {x: fixture('form'), y: fixture('posting', 'wrong')}};

test('two sessions changing different fixtures and prompt keys merge, with both reasons kept', () => {
  const ours = {...base, reasons: [...base.reasons, {date: 'd1', reason: 'ours'}], promptFingerprint: {rung2: 'a2', rung3: 'b'}, fixtures: {...base.fixtures, x: fixture('form_in_frame'), z: fixture('email')}};
  const theirs = {...base, reasons: [...base.reasons, {date: 'd1', reason: 'theirs'}], promptFingerprint: {rung2: 'a', rung3: 'b3'}, fixtures: {...base.fixtures, y: fixture('posting')}};
  const {merged, conflicts} = mergeBaselines(base, ours, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(merged.fixtures, {x: fixture('form_in_frame'), y: fixture('posting'), z: fixture('email')});
  assert.deepEqual(merged.promptFingerprint, {rung2: 'a2', rung3: 'b3'});
  assert.deepEqual(merged.reasons.map(r => r.reason), ['start', 'ours', 'theirs']);
});

test('a fixture removed on one side and untouched on the other stays removed', () => {
  const ours = {...base, fixtures: {x: base.fixtures.x}};
  assert.deepEqual(Object.keys(mergeBaselines(base, ours, base).merged.fixtures), ['x']);
});

test('the same fixture or prompt key changed differently on both sides is a conflict, never a silent pick', () => {
  const ours = {...base, fixtures: {...base.fixtures, y: fixture('posting')}};
  const theirs = {...base, promptFingerprint: {rung2: 'z', rung3: 'b'}, fixtures: {...base.fixtures, y: fixture('form')}};
  const ours2 = {...ours, promptFingerprint: {rung2: 'w', rung3: 'b'}};
  assert.deepEqual(mergeBaselines(base, ours2, theirs).conflicts, ['fixture y', 'prompt rung2']);
});

test('as git calls it: the result is written to %A, and a conflict exits 1 leaving %A as it was', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-baseline-'));
  const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };
  const script = fileURLToPath(new URL('../../tools/merge-baseline.mjs', import.meta.url));
  const ours = {...base, fixtures: {...base.fixtures, z: fixture('email')}}, theirs = {...base, fixtures: {...base.fixtures, y: fixture('posting')}};
  const [o, a, b] = [write('o', base), write('a', ours), write('b', theirs)];
  execFileSync('node', [script, o, a, b], {stdio: 'ignore'});
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(a, 'utf8')).fixtures).sort(), ['x', 'y', 'z']);
  const a2 = write('a2', {...base, fixtures: {...base.fixtures, y: fixture('form')}});
  assert.throws(() => execFileSync('node', [script, o, a2, b], {stdio: 'ignore'}));
});

test('the driver is wired: .gitattributes names it and ship.sh registers it before its rebase', () => {
  const root = new URL('../../', import.meta.url);
  assert.match(fs.readFileSync(new URL('.gitattributes', root), 'utf8'), /desktop\/e2e\/ladder-baseline\.json merge=ladder-baseline/);
  assert.match(fs.readFileSync(new URL('tools/ship.sh', root), 'utf8'), /merge\.ladder-baseline\.driver/);
});
