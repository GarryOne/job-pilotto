// A failed case's printout shows only its own lines, in a browser shared with other cases (CI run 14 Oct 2026: another case's dropdown under combo-never-opens-late-answers-1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {linesOfCase} from '../lib/replay-lines.mjs';

const line = (text, fields = {}, at = text) => ({at, text, fields});
const own = ['jobs.example-a.test'], others = ['careers.example-b.test'];

test('a shared browser prints only the failed case\'s lines under its name', () => {
  const entries = [
    line('fill: filling', {host: 'jobs.example-a.test', tab: 7}),
    line('fill: option list opened', {tab: 7}),                          // no host, but its tab is the case's
    line('fill: option "Work permit" chosen', {host: 'careers.example-b.test', tab: 9}),
    line('fill: option list opened', {tab: 9}),                          // another case's tab
    line('worker: boot', {}),                                            // names nothing
  ];
  const {mine, unplaced} = linesOfCase(entries, {own, others});
  assert.deepEqual(mine.map(entry => entry.text), ['fill: filling', 'fill: option list opened']);
  assert.ok(mine.every(entry => entry.fields.tab === 7), 'a line of another case\'s tab was printed under this case');
  assert.equal(unplaced, 1);
});

test('a line pushed twice prints once', () => {
  const again = line('fill: filling', {host: 'jobs.example-a.test'}, 'same');
  assert.equal(linesOfCase([again, {...again}], {own, others}).mine.length, 1);
});
