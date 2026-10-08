// Take over with Claude (the panel's button): the session starts at once and the app shows it (9 Oct 2026, seen live in the twin:
// it waited 14 s on a fresh jobs read, and a render with the list from before the session existed swapped it for the oldest one).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('panel events find their job in the Jobs screen\'s last list before reading Notion again', () => {
  const source = read('lib/server.js');
  const kept = source.indexOf("viewCache.recall(storage, 'jobs')"), fresh = source.indexOf('pipeline.jobs(storage)', kept);
  assert.ok(kept > 0 && fresh > kept, 'the cached list is asked first, the fresh read only when the job is not in it');
});

test('a session opened a moment ago is not swapped for another by a render with an older list', () => {
  const source = read('renderer/pages/session-log.js');
  assert.match(source, /shared\.openWanted = \{id, at: Date\.now\(\)\}/);
  assert.match(source, /shared\.openSessionId !== wanted\) \{ shared\.openSessionId = item\.id/);
});
