// Which AI engine the app under test uses. THE RULE (owner, 5 Oct 2026): the e2e key is for CI only. A Mac runs the app, the judges and the explorer on its own Claude Code (the
// plan's fixed price); no suite loads, reads or spends an Anthropic key there. A step the AI proxy answers runs on the API engine with a placeholder key.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appKey, DUMMY_KEY, isCi, pickEngine, testKey} from '../lib/engine.mjs';

const yes = () => true, no = () => false;

test('CI uses the API key; a Mac uses Claude Code', () => {
  assert.equal(pickEngine({env: {CI: 'true'}, installed: yes}), 'api');
  assert.equal(pickEngine({env: {}, installed: yes}), 'cli');
});

test('a Mac without Claude Code stops with a clear message instead of falling back to a key', () => {
  assert.throws(() => pickEngine({env: {}, installed: no}), /Claude Code is not installed/);
});

test('a suite that pins the API keeps it (its steps are answered by the proxy); E2E_AI_ENGINE=api is refused on a Mac', () => {
  assert.equal(pickEngine({env: {}, suiteEngine: 'api', installed: yes}), 'api');
  assert.throws(() => pickEngine({env: {E2E_AI_ENGINE: 'api'}, installed: yes}), /CI only/);
  assert.equal(pickEngine({env: {E2E_AI_ENGINE: 'cli', CI: 'true'}, installed: yes}), 'cli');
  assert.throws(() => pickEngine({env: {E2E_AI_ENGINE: 'gpt'}, installed: yes}), /E2E_AI_ENGINE/);
});

test('on a Mac the test key is empty whatever the environment holds; in CI it is the secret', () => {
  assert.equal(testKey({E2E_ANTHROPIC_KEY: 'sk-ant-real'}), '');
  assert.equal(testKey({CI: 'true', E2E_ANTHROPIC_KEY: 'sk-ant-real'}), 'sk-ant-real');
  assert.equal(isCi({}), false);
});

test('the key an app holds on a Mac is the placeholder; in CI the real one', () => {
  assert.equal(appKey('', {}), DUMMY_KEY);
  assert.equal(appKey('sk-ant-real', {CI: 'true'}), 'sk-ant-real');
});

test('the placeholder key is shaped like a key and is never a real one', () => {
  assert.match(DUMMY_KEY, /^sk-ant-/);
  assert.match(DUMMY_KEY, /not-a-real-key/);
});
