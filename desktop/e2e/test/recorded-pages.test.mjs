// Layer 2: every recorded case (e2e/recorded/*) replayed with the real extension, offline (lib/page-replay.mjs). A fix to a site's shape adds its case here, seen
// failing on the build before the fix (REAL_EXTENSION_DIR=<old build>). Run: cd desktop/e2e && npm run recorded.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {extensionVersion, upload, uploadable} from '../lib/applying-report.mjs';
import {loadCases, runCase} from '../lib/page-replay.mjs';

const extensionDir = process.env.REAL_EXTENSION_DIR || undefined;
const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1 (npm run recorded); it starts Chromium with the real extension';
const results = [];   // sent to /admin/applying once every case ran (not from CI, nor from a control run on an old build)
after(async () => {   // a case without its control (case.json: seen failing on an older build, or a stated guard) is never sent: it could be a pass that proves nothing
  const {rows, held} = uploadable(results, extensionVersion());
  for (const one of held) console.log(`applying report: ${one.name} held back, ${one.why}`);
  if (rows.length) console.log(await upload('recorded', rows.map(({control, ...row}) => row)));
});
const only = process.env.REPLAY_ONLY || '';   // a part of a case name: replay just those
for (const item of loadCases().filter(one => one.name.includes(only))) {
  test(`${item.name}: ${item.shape}`, {skip}, async () => {
    const result = await runCase(item, {extensionDir});
    results.push({name: item.name, control: item.control, ok: result.ok, ...(Number.isInteger(item.rung) ? {rung: item.rung} : {}), note: result.failures.join('; ').slice(0, 200)});
    assert.deepEqual(result.failures, [], `${item.name} (${item.why || ''})`);
  });
}
