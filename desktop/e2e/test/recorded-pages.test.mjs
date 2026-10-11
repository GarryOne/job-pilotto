// Layer 2: every recorded case (e2e/recorded/*) replayed with the real extension, offline (lib/page-replay.mjs). A fix to a site's shape adds its case here, seen
// failing on the build before the fix (REAL_EXTENSION_DIR=<old build>). Run: cd desktop/e2e && npm run recorded.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {extensionVersion, upload, uploadable} from '../lib/applying-report.mjs';
import {loadCases, runCase} from '../lib/page-replay.mjs';
import {replayInTabs} from '../lib/replay-browser.mjs';

const extensionDir = process.env.REAL_EXTENSION_DIR || undefined;
const skip = process.env.JP_REPLAY ? false : 'opt-in: set JP_REPLAY=1 (npm run recorded); it starts Chromium with the real extension';
const results = [];   // sent to /admin/applying once every case ran (not from CI, nor from a control run on an old build)
after(async () => {   // a case without its control (case.json: seen failing on an older build, or a stated guard) is never sent: it could be a pass that proves nothing
  const {rows, held} = uploadable(results, extensionVersion());
  for (const one of held) console.log(`applying report: ${one.name} held back, ${one.why}`);
  if (rows.length) console.log(await upload('recorded', rows.map(({control, ...row}) => row)));
});
const only = process.env.REPLAY_ONLY || '';   // a part of a case name: replay just those
// The cases run N tabs at a time in ONE browser (lib/replay-browser.mjs; JP_REPLAY_TABS, default 4; 1 = one browser per case, in turn, as before: said in the log). A case that fails in
// parallel is run again alone in its own browser: it counts as passed only if it passes alone, and it is said as FLAKY (never a silent pass).
const cases = loadCases().filter(one => one.name.includes(only));
const tabs = Math.max(1, Number(process.env.JP_REPLAY_TABS || 4));
let batch = null;   // started by the first test, once: every test awaits its own case's result
const batchResults = () => batch ||= tabs === 1 ? Promise.resolve(null) : replayInTabs(cases, {tabs, extensionDir}).then(list => new Map(list.map(result => [result.name, result])));
if (!skip) console.log(tabs === 1 ? 'recorded pages: JP_REPLAY_TABS=1, one browser per case, in turn' : `recorded pages: ${tabs} tabs at a time in one browser (JP_REPLAY_TABS=1: serial)`);
for (const item of cases) {
  test(`${item.name}: ${item.shape}`, {skip}, async () => {
    let result = (await batchResults())?.get(item.name);
    if (!result || !result.ok) {
      const parallel = result?.failures;
      result = await runCase(item, {extensionDir});
      if (parallel && result.ok) console.log(`FLAKY in parallel: ${item.name} failed in ${tabs} tabs (${parallel.join('; ').slice(0, 160)}) and passed alone; counted as passed`);
    }
    results.push({name: item.name, control: item.control, ok: result.ok, ...(Number.isInteger(item.rung) ? {rung: item.rung} : {}), note: result.failures.join('; ').slice(0, 200)});
    assert.deepEqual(result.failures, [], `${item.name} (${item.why || ''})`);
  });
}
