// Which AI engine the app under test uses. CI uses the API key (that is what ships to users); a developer's Mac uses their own Claude Code, so local runs do not spend the
// shared test key's credit. A suite that needs real API answers through the proxy pins the API.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DUMMY_KEY, pickEngine} from '../lib/engine.mjs';

const yes = () => true, no = () => false;

test('CI uses the API key, a Mac with Claude Code uses it, a Mac without it falls back to the API key', () => {
  assert.equal(pickEngine({env: {CI: 'true'}, installed: yes}), 'api');
  assert.equal(pickEngine({env: {}, installed: yes}), 'cli');
  assert.equal(pickEngine({env: {}, installed: no}), 'api');
});

test('a suite that pins the API keeps it, and E2E_AI_ENGINE overrides the default', () => {
  assert.equal(pickEngine({env: {}, suiteEngine: 'api', installed: yes}), 'api');
  assert.equal(pickEngine({env: {E2E_AI_ENGINE: 'api'}, installed: yes}), 'api');
  assert.equal(pickEngine({env: {E2E_AI_ENGINE: 'cli', CI: 'true'}, installed: yes}), 'cli');
  assert.throws(() => pickEngine({env: {E2E_AI_ENGINE: 'gpt'}, installed: yes}), /E2E_AI_ENGINE/);
});

test('the placeholder key is shaped like a key and is never a real one', () => {
  assert.match(DUMMY_KEY, /^sk-ant-/);
  assert.match(DUMMY_KEY, /not-a-real-key/);
});
