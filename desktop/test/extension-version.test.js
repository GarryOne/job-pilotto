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

test('the fingerprint is the same on Windows (a checkout with \\r\\n line endings)', async () => {
  const {hash} = await import('../scripts/extension-fingerprint.mjs');
  const fsm = await import('node:fs'), osm = await import('node:os'), pathm = await import('node:path');
  const make = eol => {
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'ext-'));
    fsm.mkdirSync(pathm.join(dir, 'page'));
    fsm.writeFileSync(pathm.join(dir, 'manifest.json'), `{"version": "1.0"}${eol}`);
    fsm.writeFileSync(pathm.join(dir, 'page', 'fill.js'), `const a = 1;${eol}const b = 2;${eol}`);
    return dir;
  };
  assert.equal(hash(make('\r\n')), hash(make('\n')));
});
