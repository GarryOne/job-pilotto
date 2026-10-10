// Layer 2: every recorded case (e2e/recorded/*) replayed with the real extension, offline (lib/page-replay.mjs). A fix to a site's shape adds its case here, seen
// failing on the build before the fix (REAL_EXTENSION_DIR=<old build>). Run: cd desktop/e2e && npm run recorded.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadCases, runCase} from '../lib/page-replay.mjs';

const extensionDir = process.env.REAL_EXTENSION_DIR || undefined;
const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1 (npm run recorded); it starts Chromium with the real extension';
const only = process.env.REPLAY_ONLY || '';   // a part of a case name: replay just those
for (const item of loadCases().filter(one => one.name.includes(only))) {
  test(`${item.name}: ${item.shape}`, {skip}, async () => {
    const result = await runCase(item, {extensionDir});
    assert.deepEqual(result.failures, [], `${item.name} (${item.why || ''})`);
  });
}
