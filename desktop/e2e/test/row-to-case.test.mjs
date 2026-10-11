// lib/row-to-case.mjs: the whole proof of a row case with its replays injected: the case is written only when the NEW build replays the live run's journey and improves on it (expect from the
// replay, never by hand), the OLD build fails the case (exit 3 when it passes) and replays the live run's page kinds (exit 4 when it does not), and no cold ask is left (exit 4).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {rowToCase} from '../lib/row-to-case.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-r2c-'));
const base = {pageKinds: ['page kind: posting {}'], fields: [{label: 'Email', outcome: 'filled', reason: 'your details'}], pressed: []};
const build = async ({name, outDir}) => { const dir = path.join(outDir, name); fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify({replay: 'row', pages: [], baseline: base, expect: {}})); fs.writeFileSync(path.join(dir, 'model-memo.json'), '{}'); return {dir, bytes: 900, verdict: 'ok'}; };
const result = (kinds, extra = {}) => ({appLog: kinds.map(kind => `12:00:00Z [extension] page kind: ${kind} {}`).join('\n'), requests: [{route: '/extension/run', body: JSON.stringify({trace: [{label: 'Email', outcome: 'filled', reason: 'your details'}]})}], misses: 0, unrecorded: [], seconds: 3, divergence: '', ...extra});
const replayBy = (newKinds, oldKinds, extra = {}) => async (dir, options = {}) => result(options.extensionDir ? oldKinds : newKinds, extra);
const go = (replay, extra = {}) => { const outDir = tmp(); return rowToCase({rowDir: '/row', name: 'start-dialog-1', outDir, oldDir: '/old', build, replay, ...extra}).then(done => ({...done, outDir})); };

test('the new build improves and the old build fails: the case is written with the expect the replay derived', async () => {
  const done = await go(replayBy(['posting', 'form'], ['posting']));
  assert.equal(done.code, 0);
  const item = JSON.parse(fs.readFileSync(path.join(done.outDir, 'start-dialog-1', 'case.json'), 'utf8'));
  assert.deepEqual(item.expect, {kinds: ['posting', 'form']});
});

test('exit 3: the old build passes the case (the control proves nothing); nothing is written', async () => {
  const done = await go(replayBy(['posting', 'form'], ['posting', 'form']));
  assert.equal(done.code, 3);
  assert.deepEqual(fs.readdirSync(done.outDir), []);
});

test('exit 4: nothing improved, the old build does not replay the live run\'s page kinds, a cold ask is left, or the new build diverged', async () => {
  assert.match((await go(replayBy(['posting'], ['posting']))).lines.join('\n'), /nothing improved/);
  const old = await go(replayBy(['posting', 'form'], ['form']));
  assert.equal(old.code, 4); assert.match(old.lines.join('\n'), /old build.*does not replay the live run/);
  const cold = await go(replayBy(['posting', 'form'], ['posting'], {misses: 2}));
  assert.equal(cold.code, 4); assert.match(cold.lines.join('\n'), /2 model ask.*--ask-cold/);
  const diverged = await go(replayBy(['posting', 'form'], ['posting'], {divergence: 'press 1: pressed X; live pressed Y'}));
  assert.equal(diverged.code, 4);
});

test('a kept ask with a clock time or a date in its prompt is said as a warning: no memo can match it again', async () => {
  const build2 = async args => { const built = await build(args); fs.writeFileSync(path.join(built.dir, 'model-memo.json'), JSON.stringify({k1: {}, 'k1#volatile': ['user:contact_details']})); return built; };
  const done = await go(replayBy(['posting', 'form'], ['posting']), {build: build2});
  assert.match(done.lines.join('\n'), /WARNING: a kept ask carries a clock time or a date in user:contact_details/);
});

test('exit 2: a case that exists is not overwritten, the old build is required', async () => {
  const outDir = tmp(); fs.mkdirSync(path.join(outDir, 'start-dialog-1'));
  assert.equal((await rowToCase({rowDir: '/row', name: 'start-dialog-1', outDir, oldDir: '/old', build, replay: replayBy(['a'], ['b'])})).code, 2);
  assert.equal((await go(replayBy(['a'], ['b']), {oldDir: ''})).code, 2);
});

test('--ask-cold: the new build\'s cold asks are kept in the case\'s memo (scrubbed), then it must replay with none', async () => {
  let asked = 0;
  const replay = async (dir, options = {}) => {
    if (options.extensionDir) return result(['posting']);
    if (options.ask) { asked += 1; return result(['posting', 'form'], {memoAfter: {k1: {content: 'anna.muster@gmail.com'}, 'k1#parts': {model: 'abc'}}}); }
    return result(['posting', 'form'], {misses: asked ? 0 : 1});
  };
  const done = await go(replay, {askCold: true});
  assert.equal(done.code, 0);
  assert.equal(asked, 1);
  const memo = fs.readFileSync(path.join(done.outDir, 'start-dialog-1', 'model-memo.json'), 'utf8');
  assert.ok(memo.includes('k1#parts') && !memo.includes('gmail'));
});
