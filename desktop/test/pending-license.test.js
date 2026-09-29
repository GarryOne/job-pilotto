import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {consume, FILE} from '../lib/pending-license.js';

function setup(key, {hasKey = false, valid = true} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-pending-'));
  if (key) fs.writeFileSync(path.join(dir, FILE), `${key}\n`);
  let settings = {}; const secrets = hasKey ? {ANTHROPIC_API_KEY: 'sk-ant-own'} : {};
  const storage = {settings: () => settings, saveSettings: p => { settings = {...settings, ...p}; }, secret: n => secrets[n], setSecret: (n, v) => { secrets[n] = v; }};
  const license = {set: k => { if (!valid) return {ok: false, error: 'bad key'}; settings = {...settings, license: {key: k}}; return {ok: true}; }};
  return {dir, storage, license, secrets, licenseState: () => ({licensed: valid})};
}

test('the key left by the installer unlocks the app and starts the free credit, once', () => {
  const s = setup('JP1.abc.def');
  const env = {};
  assert.deepEqual(consume(s.dir, {...s, env}), {ok: true, trial: true});
  assert.equal(s.secrets.ANTHROPIC_API_KEY, 'JP1.abc.def');
  assert.ok(env.ANTHROPIC_BASE_URL);
  assert.equal(fs.existsSync(path.join(s.dir, FILE)), false);
  assert.equal(consume(s.dir, {...s, env}), null);  // nothing left
});

test('an own Anthropic key is kept; a bad key is dropped with the reason', () => {
  const own = setup('JP1.abc.def', {hasKey: true});
  assert.deepEqual(consume(own.dir, {...own, env: {}}), {ok: true, trial: false});
  assert.equal(own.secrets.ANTHROPIC_API_KEY, 'sk-ant-own');
  const bad = setup('nonsense', {valid: false});
  assert.deepEqual(consume(bad.dir, {...bad, env: {}}), {ok: false, error: 'bad key'});
  assert.equal(fs.existsSync(path.join(bad.dir, FILE)), false);
});
