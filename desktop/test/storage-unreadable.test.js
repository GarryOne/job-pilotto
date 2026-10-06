// A saved secret this computer can no longer decrypt counts as missing instead of breaking every start (lib/storage.js; Windows e2e, 6 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';

test('an undecryptable secret reads as empty, shows as not set, is named, and a new value clears it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-secrets-'));
  let broken = false;
  const crypto = {encrypt: value => `sealed:${value}`, decrypt: sealed => { if (broken) throw new Error('Error while decrypting the ciphertext'); return sealed.slice(7); }};
  const storage = createStorage(dir, crypto);
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-test');
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), 'sk-test');
  broken = true;   // the key that sealed it is gone
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), '');
  assert.equal(storage.secretsPresent().ANTHROPIC_API_KEY, false);
  assert.deepEqual(storage.unreadableSecrets(), ['ANTHROPIC_API_KEY']);
  broken = false;
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-new');
  assert.deepEqual(storage.unreadableSecrets(), []);
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), 'sk-new');
});
