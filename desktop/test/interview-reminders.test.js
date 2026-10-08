// Interview reminders (10 and 1 minute before) and matching a recording to the job whose interview time is close.
import assert from 'node:assert/strict';
import {mainSource} from './main-source.js';
import {test} from 'node:test';
import * as r from '../lib/interview-reminders.js';

const at = iso => Date.parse(iso);
const NOW = at('2026-10-01T13:00:00Z');
const job = (id, iso, extra = {}) => ({url: `https://x/${id}`, page_id: id, company: `Co ${id}`, title: 'SRE', status: 'applied', next_interview: iso, ...extra});

test('a reminder 10 minutes and 1 minute before, each only once', () => {
  const jobs = [job('a', '2026-10-01T13:10:00Z')];
  assert.deepEqual(r.due(jobs, {}, NOW - 60000), []);                               // 11 min ahead: too early
  const first = r.due(jobs, {}, NOW);                                                // 10 min ahead
  assert.equal(first.length, 1);
  assert.equal(first[0].minutes, 10);
  const sent = Object.fromEntries(first[0].keys.map(k => [k, true]));
  assert.deepEqual(r.due(jobs, sent, NOW + 5 * 60000), []);                          // 5 min ahead, 10 already sent
  const second = r.due(jobs, sent, NOW + 9 * 60000);                                 // 1 min ahead
  assert.equal(second.length, 1);
  assert.equal(second[0].minutes, 1);
});

test('a missed window: one reminder with the minutes really left, and the earlier one counts as sent', () => {
  const jobs = [job('a', '2026-10-01T13:04:00Z')];
  const items = r.due(jobs, {}, NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].minutes, 4);
  assert.equal(items[0].keys.length, 1);   // only the 10-minute window has been reached
});

test('past, rejected and time-less interviews give no reminder; a moved interview is a new one', () => {
  assert.deepEqual(r.due([job('a', '2026-10-01T12:00:00Z'), job('b', '2026-10-01T13:05:00Z', {status: 'rejected'}), job('c', '')], {}, NOW), []);
  const old = job('a', '2026-10-01T13:05:00Z');
  const sent = Object.fromEntries(r.due([old], {}, NOW)[0].keys.map(k => [k, true]));
  assert.equal(r.due([job('a', '2026-10-01T13:30:00Z')], sent, at('2026-10-01T13:25:00Z')).length, 1);   // new time, new reminder
});

test('the notification says who, when, and to start the recording', () => {
  const t = r.text({job: job('a', '2026-10-01T13:10:00Z', {company: 'Zephyr AI', title: 'Infrastructure Engineer'}), minutes: 10});
  assert.equal(t.title, 'Interview with Zephyr AI starts in 10 minutes');
  assert.match(t.body, /Infrastructure Engineer/);
  assert.match(t.body, /everyone agreed/);
  assert.equal(r.text({job: job('a', ''), minutes: 1}).title, 'Interview with Co a starts in 1 minute');
});

test('a recording is matched to the job whose interview time is close, and never guessed when two are close', () => {
  const jobs = [job('a', '2026-10-01T13:00:00Z'), job('b', '2026-10-02T09:00:00Z')];
  assert.equal(r.match(jobs, at('2026-10-01T13:12:00Z')).url, 'https://x/a');         // began 12 minutes after
  assert.equal(r.match(jobs, at('2026-10-01T12:50:00Z')).url, 'https://x/a');         // began early
  assert.equal(r.match(jobs, at('2026-10-01T16:00:00Z')), null);                      // nothing near
  assert.equal(r.match([job('a', '2026-10-01T13:00:00Z'), job('c', '2026-10-01T13:10:00Z')], at('2026-10-01T13:05:00Z')), null);   // ambiguous
});

test('reminders are on unless switched off', () => {
  assert.equal(r.on({settings: () => ({})}), true);
  assert.equal(r.on({settings: () => ({interviewReminders: false})}), false);
});

test('the app wires it: a timer, the switch, the page toggle, the suggestion note, and a click opening Interviews', async () => {
  const {readFileSync} = await import('node:fs');
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const main = mainSource(), preload = read('preload.cjs'), html = read('renderer/index.html'), page = read('renderer/pages/interviews.js');
  assert.match(main, /reminders\.due\(jobs, sent\)/);
  assert.match(main, /setInterval\(remind, 30000\)/);
  assert.match(main, /ipcMain\.handle\('ivRemindSet'/);
  assert.match(main, /reminders\.match\(jobs, Date\.parse\(draft\.createdAt\)\)/);
  assert.match(main, /toWindow\('openInterviews'\)/);
  assert.match(preload, /remindGet: call\('ivRemindGet'\)/);
  assert.match(preload, /onOpenInterviews/);
  assert.match(html, /id="iv-remind"/);
  assert.match(page, /Suggested from your calendar/);
  assert.match(page, /draft\.jobUrl \|\| draft\.suggestedJobUrl/);
});
