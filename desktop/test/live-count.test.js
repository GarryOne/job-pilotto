// A search's live counter (src/progress.py "⏳ <step>: N of M …") is shown outside the Technical log: the Actions banner, Recent activity's
// row, the header and the running step (owner, 7 Oct 2026: the banner said "Closed 0 job(s) not seen for 7 days" for minutes).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../renderer/pages/activity.js', import.meta.url), 'utf8');
const liveCount = new Function(`${/export const liveCount = [^\n]+/.exec(source)[0].replace('export ', '')}; return liveCount;`)();

test('a counter line reads as its words; the heartbeat and other lines do not', () => {
  assert.equal(liveCount('⏳ Reading employer job sites: 120 of 202 · 3,412 jobs listed'), 'Reading employer job sites: 120 of 202 · 3,412 jobs listed');
  assert.equal(liveCount('⏳ Scoring jobs against your Profile: 12 of 40'), 'Scoring jobs against your Profile: 12 of 40');
  assert.equal(liveCount('⏳ Still running · no new output for 2 min'), '');
  assert.equal(liveCount('Closed 0 job(s) not seen for 7 days'), '');
});

test('every place that shows a running search uses it', () => {
  assert.match(source, /export function searchPhase\(step = ''\) \{\n  const live = liveCount\(step\)/, 'header, bottom bar and Recent activity row');
  assert.match(source, /run\?\.live && i === at \? lines\.map\(liveCount\)/, 'the running step in the run detail');
  const runs = fs.readFileSync(new URL('../renderer/pages/runs-page.js', import.meta.url), 'utf8');
  assert.match(runs, /liveCount\(running\.step\)/, 'the Actions banner');
});
