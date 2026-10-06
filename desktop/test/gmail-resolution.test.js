// An answered "which job?" email says what the answer did, one row for every answer: linked to a job, created one, not about a job,
// or answered before the app kept which job; never the picker's option label as a job's name (owner, 6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer');
const read = file => fs.readFileSync(path.join(renderer, file), 'utf8');

test('a new job is recorded as "<company> — new job", not the option label', () => {
  const js = read('pages/reassign.js');
  assert.match(js, /choice === 'new' \? `\$\{item\.company \|\| 'New job'\} — new job`/);
  assert.doesNotMatch(js, /'Not in my list yet: a new job'/);
});

test('one resolution line per answer, and an unrecorded answer is said as such', () => {
  const js = read('pages/activity.js');
  for (const words of ['Linked to ', 'Created a job for ', 'Marked as not job-related', 'which job it went to was not recorded']) assert.ok(js.includes(words), words);
  assert.doesNotMatch(js, /Not about a job, or the job was not recorded/);
  assert.equal((js.match(/job: '', unknown: true/g) || []).length, 2, 'both fallbacks mark the answer as unrecorded');
});
