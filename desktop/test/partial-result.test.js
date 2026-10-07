// A Tailor CVs run that made only some CVs is "With warnings" in the list and the header, not a green Completed; its card says
// which failed, so no generic warnings box is added (owner, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {partialResult, runStatus, runWarned} from '../renderer/run-status.js';

const partial = {kind: 'tailor', ok: true, message: '✂️ Tailored CVs ready\n3 of 5 tailored · 2 failed · check each before you apply'};

test('3 of 5 is warned; 5 of 5 is not', () => {
  assert.ok(partialResult(partial));
  assert.ok(runWarned(partial));
  assert.deepEqual(runStatus(partial, runWarned(partial)), ['With warnings', 'warn']);
  assert.equal(runWarned({...partial, message: partial.message.replace('3 of 5 tailored · 2 failed', '5 of 5 tailored')}), false);
});

test('the warnings box is not opened for it (the card explains), the header says Completed with warnings', () => {
  const js = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer/pages/activity.js'), 'utf8');
  assert.match(js, /const warnedOnly = !warnings\.length && !run\?\.live && !!run\?\.warned && !head;/);
  assert.match(js, /run\.warned \|\| partialResult\(run\)\) \? \['Completed with warnings', 'warn'\]/);
});

test('a browser run that read some of its sites is "With warnings", not "Completed"; all read, or none, is not partial (owner, 8 Oct 2026)', () => {
  const run = message => ({ok: true, kind: 'visits', message});
  assert.ok(partialResult(run('🌐 Sites read\nRead 2 of 4 sites · 8 jobs (8 new) · 0 matching your search')));
  assert.deepEqual(runStatus(run('🌐 Sites read\nRead 2 of 4 sites · 8 jobs (8 new)'), runWarned(run('🌐 Sites read\nRead 2 of 4 sites · 8 jobs (8 new)'))), ['With warnings', 'warn']);
  assert.ok(!partialResult(run('🌐 Sites read\nRead 4 of 4 sites · 30 jobs (2 new)')));
  assert.ok(!partialResult(run('🌐 Sites read\nRead 1 of 1 site · 3 jobs (3 new)')));
});
