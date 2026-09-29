// A changed Chrome extension ships with a new version, or Chrome keeps running the old one (scripts/extension-fingerprint.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hash, manifestVersion, recorded} from '../scripts/extension-fingerprint.mjs';

test('the extension files match the fingerprint recorded with its version', () => {
  const kept = recorded();
  assert.equal(hash(), kept.hash, 'extension/ changed: raise "version" in extension/manifest.json, then run '
    + '`node desktop/scripts/extension-fingerprint.mjs --write` (Chrome reloads the extension only on a new version)');
  assert.equal(manifestVersion(), kept.version, 'extension/fingerprint.json was recorded for another version: run the script with --write');
});
