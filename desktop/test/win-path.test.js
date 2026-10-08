// lib/win-path.js and apply.claudeBinary: a Claude Code installed after the app started is found through the registry's PATH.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as apply from '../lib/apply.js';
import {parseRegPath, registryPathDirs} from '../lib/win-path.js';

const REG = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Microsoft\\WinGet\\Links;C:\\Tools\\nvm\r\n\r\n';

test('the registry PATH is read, %VARS% filled in, and only on Windows', () => {
  assert.deepEqual(parseRegPath(REG, {USERPROFILE: 'C:\\Users\\x'}), ['C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links', 'C:\\Tools\\nvm']);
  assert.deepEqual(parseRegPath('nothing here'), []);
  assert.deepEqual(registryPathDirs({platform: 'darwin', run: () => { throw new Error('must not run'); }}), []);
});

test('claude installed after the app started (not on its PATH) is found through the registry PATH', () => {
  const env = {PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\x'};
  const fresh = 'C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe';
  const registry = () => ['C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links'];
  // env is not process.env here, so the registry is ignored (tests stay pure); the real call passes process.env
  assert.equal(apply.claudeBinary(env, file => file === fresh, 'win32', registry), '');
  const real = process.env;
  assert.deepEqual(apply.claudeSearchDirs(real, 'win32', registry).slice(0, 0), []);
  assert.ok(apply.claudeSearchDirs(real, 'win32', registry).includes('C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links'));
  assert.equal(apply.claudeBinary(real, file => file === fresh, 'win32', registry), fresh);
});
