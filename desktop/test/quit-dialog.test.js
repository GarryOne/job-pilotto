import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sessionsOnly, working} from '../lib/quit-dialog.js';

const label = session => session.company;
const sessions = names => names.map(company => ({company}));

test('only sessions: a title with the count, one line each, what happens, two clear buttons', () => {
  const dialog = sessionsOnly(sessions(['N26', 'Grafana Labs']), label);
  assert.equal(dialog.message, 'Claude is still filling 2 applications');
  assert.match(dialog.detail, /^•  N26\n•  Grafana Labs\n\nQuitting stops them where they are\./);
  assert.match(dialog.detail, /Resume Claude/);
  assert.deepEqual(dialog.buttons, ['Keep working', 'Stop and quit']);
  assert.equal(sessionsOnly(sessions(['N26']), label).message, 'Claude is still filling an application');
});

test('a long list is cut with "and N more", never a wall of job titles', () => {
  const dialog = sessionsOnly(sessions(['A', 'B', 'C', 'D', 'E', 'F']), label);
  assert.equal(dialog.detail.split('\n').filter(line => line.startsWith('•')).length, 5);
  assert.match(dialog.detail, /•  and 2 more/);
});

test('a search, waiting tasks and sessions together: one line each, then the three choices', () => {
  const dialog = working({busy: {kind: 'search'}, queue: [{kind: 'mail'}, {kind: 'insight'}], sessions: sessions(['N26']), label,
    taskName: kind => ({search: 'New jobs check', mail: 'Gmail check', insight: 'Insight'})[kind]});
  assert.equal(dialog.message, 'Job Pilotto is still working');
  assert.match(dialog.detail, /^•  New jobs check is running\n•  2 tasks waiting: Gmail check, Insight\n•  Claude is filling 1 application: N26\n\n/);
  assert.match(dialog.detail, /Quit when done:.*\nQuit now:/);
  assert.deepEqual(dialog.buttons, ['Quit when done', 'Quit now', 'Cancel']);
  assert.doesNotMatch(working({busy: {kind: 'search'}, taskName: () => 'Search', label}).detail, /Resume Claude/);
});
