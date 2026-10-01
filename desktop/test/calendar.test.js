// Calendar: meetings from jobs' Next interview and saved recordings, the month grid, the agenda split.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as c from '../renderer/calendar.js';

const ZONE = 'Europe/Zurich';
const job = (id, next, extra = {}) => ({url: `https://x/${id}`, notion_url: `https://www.notion.so/Co-${id.padEnd(32, '0')}`, company: `Co ${id}`, title: 'SRE', stage: 'Interview scheduled', status: 'applied', next_interview: next, ...extra});

test('a job with a Next interview is one meeting; a dismissed or undated job is none', () => {
  const list = c.meetings([job('a', '2026-10-05T09:00:00+02:00'), job('b', ''), job('c', '2026-10-06T09:00:00+02:00', {status: 'dismissed'})], [], {zone: ZONE});
  assert.equal(list.length, 1);
  assert.equal(list[0].day, '2026-10-05');
  assert.equal(list[0].held, false);
});

test('a screening is told from an interview by the stage or the recorded round', () => {
  assert.equal(c.kindOf('Screening'), 'screening');
  assert.equal(c.kindOf('Interview scheduled'), 'interview');
  assert.equal(c.kindOf('Interviewing', 'Recruiter screen'), 'screening');
  assert.equal(c.kindOf('Screening', 'Technical 1'), 'interview');
});

test('a recording on its job\'s interview day is the same meeting, shown once as held', () => {
  const a = job('a', '2026-10-05T09:00:00+02:00');
  const list = c.meetings([a], [{id: 'r1', date: '2026-10-05', round: 'Technical 1', application: [`a`.padEnd(32, '0')]}], {zone: ZONE});
  assert.equal(list.length, 1);
  assert.equal(list[0].held, true);
  assert.equal(list[0].round, 'Technical 1');
});

test('a recording of another day, or of an unknown job, is its own past meeting', () => {
  const list = c.meetings([job('a', '2026-10-05T09:00:00+02:00')], [{id: 'r2', date: '2026-09-20', title: 'Acme call', application: []}], {zone: ZONE});
  assert.deepEqual(list.map(m => [m.day, m.held]), [['2026-09-20', true], ['2026-10-05', false]]);
  assert.equal(list[0].title, 'Acme call');
});

test('the month grid starts on Monday, has whole weeks and puts a meeting on its day', () => {
  const list = c.meetings([job('a', '2026-10-05T09:00:00+02:00')], [], {zone: ZONE});
  const weeks = c.monthGrid(2026, 9, list, '2026-10-01');
  assert.equal(weeks[0][0].day, '2026-09-28');                       // 1 Oct 2026 is a Thursday
  assert.ok(weeks.every(week => week.length === 7));
  const cell = weeks.flat().find(x => x.day === '2026-10-05');
  assert.equal(cell.meetings.length, 1);
  assert.equal(weeks.flat().find(x => x.day === '2026-10-01').today, true);
  assert.equal(weeks.flat().find(x => x.day === '2026-09-28').inMonth, false);
});

test('the agenda: coming meetings soonest first, past ones latest first, today\'s past recordings with the past', () => {
  const now = Date.parse('2026-10-05T12:00:00+02:00');
  const list = c.meetings([job('a', '2026-10-07T09:00:00+02:00'), job('b', '2026-10-05T15:00:00+02:00')],
    [{id: 'r1', date: '2026-10-01T10:00:00+02:00', application: []}, {id: 'r2', date: '2026-10-05T09:00:00+02:00', application: []}], {zone: ZONE});
  const {upcoming, past} = c.agenda(list, now, ZONE);
  assert.deepEqual(upcoming.map(m => m.day), ['2026-10-05', '2026-10-07']);
  assert.deepEqual(past.map(m => m.recording), ['r2', 'r1']);
});
