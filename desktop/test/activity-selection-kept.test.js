// A run starting in the background keeps the run you selected in Recent activity; only starting one yourself moves the panel to it (6 Oct 2026, CI activity suite).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('the live log handler never clears the selected run; the buttons that start a run do', () => {
  const jobs = fs.readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');
  const onLog = jobs.slice(jobs.indexOf('window.pilot.onLog('), jobs.indexOf("$('search-status')"));
  assert.ok(onLog.length > 50, 'the onLog handler was found');
  assert.doesNotMatch(onLog, /selectedRun\s*=\s*null/, 'a background run must not move the panel away from the run being read');
  assert.match(jobs.slice(jobs.indexOf("$('refresh').addEventListener")), /selectedRun = null/, 'Refresh still follows the run it starts');
});
