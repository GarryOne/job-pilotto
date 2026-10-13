// A CLI installed while the app runs is found without a restart: Windows PATH read again (lib/fresh-path.js) and the chooser's status re-read (renderer/pages/ai-engine.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {parseRegPath, refreshPath} from '../lib/fresh-path.js';

const reg = path => `\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    ${path}\r\n\r\n`;

test('parseRegPath expands %VARS% from the environment', () => {
  assert.equal(parseRegPath(reg('C:\\a;%USERPROFILE%\\.codex\\bin'), {USERPROFILE: 'C:\\Users\\me'}), 'C:\\a;C:\\Users\\me\\.codex\\bin');
  assert.equal(parseRegPath('nothing', {}), '');
});

test('refreshPath adds the registry folders the running PATH lacks, never removes, and does nothing off Windows', async () => {
  const run = (cmd, args, options, done) => done(null, reg('C:\\old;C:\\new\\bin'));
  const env = {PATH: 'C:\\old;C:\\keep'};
  assert.equal(await refreshPath({env, platform: 'win32', run}), true);
  assert.deepEqual(env.PATH.split(';'), ['C:\\old', 'C:\\keep', 'C:\\new\\bin']);
  assert.equal(await refreshPath({env, platform: 'win32', run}), false, 'a second look adds nothing');
  const mac = {PATH: '/bin'};
  assert.equal(await refreshPath({env: mac, platform: 'darwin', run}), false);
  assert.equal(mac.PATH, '/bin');
  assert.equal(await refreshPath({env: {PATH: 'x'}, platform: 'win32', run: (c, a, o, done) => done(new Error('no reg'))}), false);
});

test('both status handlers refresh PATH when their CLI is missing, and the chooser re-reads every CLI on focus and on a timer', () => {
  const handlers = fs.readFileSync(new URL('../lib/setup-handlers.js', import.meta.url), 'utf8');
  for (const name of ['claudeCodeStatus', 'codexStatus']) {
    const body = handlers.slice(handlers.indexOf(`'${name}'`), handlers.indexOf(`'${name}'`) + 700);
    assert.match(body, /refreshPath\(\)/, `${name} looks again after a PATH refresh`);
  }
  const page = fs.readFileSync(new URL('../renderer/pages/ai-engine.js', import.meta.url), 'utf8');
  assert.match(page, /for \(const which of Object\.keys\(CLI\)\) \{\s*CLI\[which\]\.status\(\)/, 'one loop over every CLI');
  for (const hook of ["addEventListener('focus', recheck)", "addEventListener('visibilitychange', onVisible)", 'setInterval(']) assert.ok(page.includes(hook), hook);
});
