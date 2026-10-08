// A live-test twin (lib/twin.js) runs on the owner's real state but reaches nothing of theirs: owner, 8 Oct 2026 ("not my main app window").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {isTwin, realFolder, twinRefusal, twinSecret} from '../lib/twin.js';
import {createStorage} from '../lib/storage.js';
import {pipelineEnv} from '../lib/pipeline-env.js';
import {reportingOff} from '../lib/telemetry.js';

const real = '/Users/someone/Library/Application Support/Job Pilotto';
const twin = {JOB_PILOTTO_TWIN: '1', JOB_PILOTTO_USER_DATA: '/tmp/jp-twin/data', JOB_PILOTTO_TWIN_NOTION_TOKEN: 'ntn_mirror'};

test('a twin starts only on its own folder and with the mirror\'s token', () => {
  assert.equal(twinRefusal({}, real), '');                                     // not a twin: nothing to check
  assert.equal(twinRefusal(twin, real), '');
  assert.match(twinRefusal({...twin, JOB_PILOTTO_USER_DATA: ''}, real), /never runs on the real folder/);
  assert.match(twinRefusal({...twin, JOB_PILOTTO_USER_DATA: `${real}/`}, real), /is the real folder/);
  assert.match(twinRefusal({...twin, JOB_PILOTTO_TWIN_NOTION_TOKEN: ''}, real), /Live Test mirror/);
  assert.equal(realFolder('/Users/someone', 'darwin'), real);
});

test('the twin\'s Notion token is the mirror\'s, never one in the cloned secrets.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twin-'));
  const crypto = {encrypt: value => `sealed:${value}`, decrypt: sealed => sealed.slice(7)};
  const storage = createStorage(dir, crypto);
  storage.setSecret('NOTION_TOKEN', 'ntn_REAL');
  storage.setSecret('EXTENSION_TOKEN', 'ext');
  const saved = {...process.env};
  try {
    Object.assign(process.env, twin);
    assert.equal(storage.secret('NOTION_TOKEN'), 'ntn_mirror');
    assert.equal(storage.secret('EXTENSION_TOKEN'), 'ext');                   // the others as usual
    assert.equal(twinSecret('NOTION_TOKEN', {...twin, JOB_PILOTTO_TWIN_NOTION_TOKEN: ''}), '');   // never falls back to the real one
  } finally { process.env = saved; }
  assert.equal(storage.secret('NOTION_TOKEN'), 'ntn_REAL');                   // not a twin: unchanged
});

test('a twin\'s engine sees no Keychain and nothing reports to the product', () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twin-')), {encrypt: v => v, decrypt: v => v});
  assert.equal(pipelineEnv(storage, twin).JOB_PILOTTO_TWIN, '1');
  assert.equal(pipelineEnv(storage, {}).JOB_PILOTTO_TWIN, undefined);
  assert.equal(reportingOff(twin, {packaged: true}), 'a live-test twin');
  assert.ok(isTwin(twin) && !isTwin({}));
});

test('every path out of a twin is guarded: Telegram, schedules, AppleScript on Chrome and Terminal, the Mac-only tab search', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(read('main.js'), /function restartTelegram\(\) \{\n  polling\?\.stop\(\);\n  if \(isTwin\(\)\) \{ polling = null; return; \}/);
  assert.match(read('main.js'), /if \(twinRefusal\(\)\) \{[^\n]*app\.exit\(3\)/);
  assert.match(read('lib/background-handlers.js'), /if \(!isTwin\(\)\) startSchedule\(/);
  assert.match(read('lib/form-tab.js'), /const jxa = script => new Promise\(\(resolve, reject\) => \(isTwin\(\) \? reject/);
  assert.match(read('lib/apply-handlers.js'), /process\.platform === 'darwin' && !isTwin\(\)/);
  // Every AppleScript in the app is one of the guarded two: a new one fails here until it is guarded too.
  const lib = fs.readdirSync(new URL('../lib/', import.meta.url)).filter(name => name.endsWith('.js'));
  const callers = lib.filter(name => /['"]osascript['"]/.test(read(`lib/${name}`))).sort();
  assert.deepEqual(callers, ['claude-session.js', 'form-tab.js']);
  assert.equal((read('lib/claude-session.js').match(/if \(isTwin\(\)\) throw/g) || []).length, 2);
});
