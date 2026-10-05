import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keychainEnv, pickSuites} from '../run-all.mjs';

const ALL = ['jobs', 'personas', 'quality', 'settings', 'wizard'], cadence = {personas: 'manual', quality: 'nightly'};

test('run-all picks what a manual CI run would: everything that is not manual; --manual adds them; --only names exactly', () => {
  assert.deepEqual(pickSuites({all: ALL, cadence}), ['jobs', 'quality', 'settings', 'wizard']);
  assert.deepEqual(pickSuites({all: ALL, cadence, manual: true}), ALL);
  assert.deepEqual(pickSuites({all: ALL, cadence, only: 'personas,jobs'}), ['jobs', 'personas']);
  assert.deepEqual(pickSuites({all: ALL, cadence, skip: 'quality,wizard'}), ['jobs', 'settings']);
  assert.throws(() => pickSuites({all: ALL, cadence, only: 'nope'}), /unknown suite: nope/);
  assert.throws(() => pickSuites({all: ALL, cadence, skip: 'nope'}), /unknown suite to skip: nope/);
});

test('secrets already in the environment are kept; the rest come from the Keychain, per suite', () => {
  const store = {'job-pilotto.e2e.notion_token': 'w', 'job-pilotto.e2e.notion_token_quality': 'q'};
  const found = keychainEnv(['jobs', 'quality'], {env: {E2E_NOTION_TOKEN: 'already'}, read: service => store[service] || ''});
  assert.deepEqual(found, {E2E_NOTION_TOKEN_QUALITY: 'q'});   // the wizard token is set, the jobs token is not in the Keychain
});

test('the Anthropic key is never read from the Keychain, even when it is there (owner, 5 Oct 2026: no local e2e run loads it)', () => {
  const asked = [];
  const found = keychainEnv(['jobs'], {env: {}, read: service => { asked.push(service); return 'secret'; }});
  assert.ok(!asked.some(service => /anthropic/i.test(service)), `asked for ${asked.join(', ')}`);
  assert.ok(!('E2E_ANTHROPIC_KEY' in found));
});
