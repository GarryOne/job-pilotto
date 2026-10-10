// The prompt fingerprint of the ladder (e2e/lib/ladder-fingerprint.mjs): the push gate replays STORED answers, so a changed prompt or schema would never be seen by it. A hash of every model-facing prompt and
// schema sits in e2e/ladder-baseline.json (promptFingerprint); a different hash fails the ratchet with what to re-run. Here: an unchanged tree passes, a changed string in a COPY of a file fails, only that rung.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {PROMPT_FILES, fingerprintProblems, fingerprints} from '../e2e/lib/ladder-fingerprint.mjs';
import {nextBaseline, readBaseline} from '../e2e/lib/ladder-baseline.mjs';
import {touchedLadderFiles} from '../../tools/ladder-gate.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// A loader that imports a COPY of one prompt file with one string changed (its relative imports made absolute), so the real tree is never touched.
function loaderWithChange(file, from, to) {
  const source = fs.readFileSync(path.join(repo, file), 'utf8');
  assert.ok(source.includes(from), `${file} does not contain ${JSON.stringify(from)}`);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-fp-'));
  const copy = path.join(folder, path.basename(file));
  const absolute = source.replace(from, to).replace(/(from\s*|import\()\s*(['"])(\.{1,2}\/[^'"]+)\2/g, (_, lead, quote, spec) => `${lead}${quote}${pathToFileURL(path.resolve(path.dirname(path.join(repo, file)), spec)).href}${quote}`);
  fs.writeFileSync(copy, absolute);
  return target => import(target === file ? pathToFileURL(copy).href : pathToFileURL(path.join(repo, target)).href);
}

test('every model-facing prompt and schema is exported, and the fingerprint is stable', async () => {
  const first = await fingerprints(), second = await fingerprints();
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), PROMPT_FILES.map(item => item.key));
  assert.deepEqual(Object.keys(first), ['rung2', 'rung2-frames', 'rung3', 'account-judge', 'form-judge', 'rung4']);
  assert.ok(Object.values(first).every(hash => /^[0-9a-f]{16}$/.test(hash)));
  assert.equal(new Set(Object.values(first)).size, 6, 'two rungs hash the same: a part is missing');
});

test('control: an unchanged tree matches the committed baseline', async () => {
  assert.deepEqual(fingerprintProblems(await fingerprints(), readBaseline()), []);
});

test('a changed prompt string in a copy fails the gate, for that rung only, with what to re-run', async () => {
  const changed = await fingerprints({load: loaderWithChange('desktop/lib/ladder/rung3-digest.js', 'Beware: a closed notice', 'Beware (changed): a closed notice')});
  const problems = fingerprintProblems(changed, readBaseline());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /the prompt of rung 3 changed: re-run `npm run ladder-score` live \(plan path\), `--record` the changed answers, then `--offline --update-baseline "<why>"`/);
});

test('a changed schema or a judge prompt fails too, each naming its own rung or judge', async () => {
  const schema = await fingerprints({load: loaderWithChange('desktop/lib/ladder/rung2-sketch.js', "bot_check: {type: 'boolean'", "bot_check: {type: 'string'")});
  assert.match(fingerprintProblems(schema, readBaseline()).join('\n'), /the prompt of rung 2 changed/);
  const judge = await fingerprints({load: loaderWithChange('desktop/lib/form-judge.js', 'You judge one page of a JOB APPLICATION form', 'You judge one PAGE of a JOB APPLICATION form')});
  assert.match(fingerprintProblems(judge, readBaseline()).join('\n'), /the prompt of the form judge changed/);
});

test('a baseline without a fingerprint, or with a missing one, asks for an update instead of passing', async () => {
  const now = await fingerprints();
  assert.match(fingerprintProblems(now, {fixtures: {}}).join('\n'), /no prompt fingerprint in the baseline/);
  const {rung4: _gone, ...partial} = now;
  assert.match(fingerprintProblems(partial, {promptFingerprint: now}).join('\n'), /rung 4/);
});

test('--update-baseline writes the fingerprints; a push touching a prompt file starts the gate', async () => {
  const written = nextBaseline([], {reasons: []}, 'why', '2026-10-11', await fingerprints());
  assert.deepEqual(written.promptFingerprint, await fingerprints());
  const touched = touchedLadderFiles(['desktop/lib/ladder/rung4-picture.js', 'desktop/lib/account-judge.js', 'desktop/lib/form-judge.js', 'README.md'], []);
  assert.equal(touched.length, 3);
});
