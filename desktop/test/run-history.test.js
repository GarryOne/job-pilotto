import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as history from '../lib/run-history.js';

const row = (id, props, extra = {}) => ({id, url: `https://www.notion.so/${id}`, created_time: '2026-09-28T10:00:00.000Z', ...extra, properties: {
  Started: {date: {start: props.started}}, Mode: {select: {name: props.mode}}, Status: {select: {name: props.status}},
  Trigger: {select: {name: props.trigger}}, Summary: {rich_text: [{plain_text: props.summary || ''}]},
  'Duration (s)': {number: props.seconds ?? null}, 'New jobs': {number: props.fresh ?? 0}, 'AI cost (USD)': {number: 0.01},
  'Run URL': {url: props.runUrl || null},
  'Run id': props.runId ? {rich_text: [{plain_text: props.runId}]} : {rich_text: []}}});
const NOW = Date.parse('2026-09-28T12:10:00Z');

test('a Notion ⏱️ Search runs row reads as an activity record, wherever it ran', () => {
  const gh = history.fromRow(row('r1', {started: '2026-09-28T12:00:00Z', mode: 'insight', status: 'OK', trigger: 'Schedule', seconds: 50,
    summary: 'Insight sent: Skills — Go is in 40% (AI cost $0.012)', runUrl: 'https://github.com/me/p/actions/runs/1', runId: 'abc123def456'}), NOW);
  assert.equal(gh.kind, 'insight');
  assert.equal(gh.runId, 'abc123def456');
  assert.equal(gh.where, 'github');
  assert.equal(gh.trigger, 'schedule');
  assert.equal(gh.ok, true);
  assert.equal(gh.result, 'Insight sent: Skills — Go is in 40%');
  assert.equal(gh.endedAt, '2026-09-28T12:00:50.000Z');
  const search = history.fromRow(row('r2', {started: '2026-09-28T11:00:00Z', mode: 'scheduled', status: 'OK', trigger: 'Mac schedule', seconds: 200, fresh: 3}), NOW);
  assert.deepEqual([search.kind, search.where, search.result], ['search', 'mac', '3 new jobs']);
});

test('a job running anywhere shows its progress line; one "Running" for hours never finished', () => {
  const live = history.fromRow(row('r3', {started: '2026-09-28T12:08:00Z', mode: 'run', status: 'Running', trigger: 'Manual',
    summary: '⏳ Scoring 12 new jobs', runUrl: 'https://github.com/x'}), NOW);
  assert.equal(live.live, true);
  assert.equal(live.step, 'Scoring 12 new jobs');
  const lost = history.fromRow(row('r4', {started: '2026-09-28T02:00:00Z', mode: 'mail', status: 'Running', trigger: 'Schedule'}), NOW);
  assert.equal(lost.live, undefined);
  assert.equal(lost.ok, false);
  assert.equal(lost.result, 'never finished (see the log)');
});

test('merge: Notion is the history; this Mac\'s record of the same run keeps its full log; a job sent to GitHub waits for its row', () => {
  const notion = [history.fromRow(row('r5', {started: '2026-09-28T12:00:00Z', mode: 'mail', status: 'OK', trigger: 'Mac (you)', seconds: 30,
    summary: 'Gmail check: 2 new email(s) read, 1 update(s) recorded; AI cost $0.002.'}), NOW)];
  const local = [{id: Date.parse('2026-09-28T12:00:00.500Z'), kind: 'mail', notionUrl: 'https://www.notion.so/r5', log: ['full', 'log'], ok: true},
    {id: Date.parse('2026-09-28T12:05:00Z'), kind: 'insight', log: ['not in Notion yet']}];
  const pending = [{id: NOW, mode: 'weekly', live: true, step: 'Starting on GitHub…'}];
  const {runs, live, waiting} = history.merge(notion, local, pending);
  assert.equal(runs.length, 2);
  const mail = runs.find(r => r.kind === 'mail');
  assert.deepEqual(mail.log, ['full', 'log']);
  assert.equal(mail.pageId, 'r5');
  assert.equal(mail.result, 'Gmail check: 2 new email(s) read, 1 update(s) recorded');
  assert.equal(live.step, 'Starting on GitHub…');
  assert.equal(waiting.length, 1);
  // Once the weekly report's row exists, it's no longer waiting.
  const started = history.fromRow(row('r6', {started: new Date(NOW + 30000).toISOString(), mode: 'weekly', status: 'Running', trigger: 'Manual'}), NOW + 40000);
  assert.equal(history.merge([started, ...notion], local, pending).waiting.length, 0);
});

test('a run\'s page gives its result and technical log', async () => {
  const para = (type, content) => ({type, [type]: {rich_text: [{plain_text: content}]}});
  const fetcher = async url => Response.json(url.includes('blocks/toggle-1/') ? {results: [para('code', 'line 1\nline 2')]}
    : {results: [para('heading_3', 'Report'), para('bulleted_list_item', 'Insight sent: Skills'), para('heading_3', 'Result'),
      para('paragraph', '💡 Skills'), para('paragraph', 'Go is in 40%'),
      {id: 'toggle-1', type: 'toggle', has_children: true, toggle: {rich_text: [{plain_text: 'Technical log (last 2 lines)'}]}}]});
  const storage = {secret: () => 'secret_x', settings: () => ({})};
  assert.deepEqual(await history.detail(storage, 'r1', {fetcher}), {message: '💡 Skills\nGo is in 40%', log: ['line 1', 'line 2'], report: ['Insight sent: Skills']});
});

test('every finished job is a notification wherever it ran; a quiet Gmail check and a button action are not', () => {
  assert.deepEqual(history.notice({kind: 'insight', where: 'github', ok: true, result: 'Insight sent: Skills — Go is in 40%'}),
    {title: 'Insight done (on GitHub)', body: 'Insight sent: Skills — Go is in 40%'});
  assert.deepEqual(history.notice({kind: 'search', trigger: 'schedule', ok: true, new: 3}), {title: 'Scheduled jobs check done', body: '3 new jobs found.'});
  assert.deepEqual(history.notice({ok: true, new: 0}), {title: 'Jobs check done', body: 'No new jobs this time.'});  // an older record without kind
  assert.equal(history.notice({kind: 'weekly', where: 'github', ok: false}).title, 'Weekly report had problems (on GitHub)');
  assert.deepEqual(history.notice({kind: 'mail', ok: true, updates: ['Grafana Labs: Rejected']}),
    {title: 'Gmail: 1 application update', body: 'Grafana Labs: Rejected'});
  assert.equal(history.notice({kind: 'mail', where: 'github', ok: true, result: 'Gmail check: 4 new email(s) read, 2 update(s) recorded'}).title,
    'Gmail: 2 application updates (on GitHub)');
  assert.equal(history.notice({kind: 'mail', ok: true, updates: []}), null);
  assert.equal(history.notice({kind: 'mail', ok: true, result: 'Gmail check: 3 new email(s) read, 0 update(s) recorded'}), null);
  assert.equal(history.notice({kind: 'action', ok: true}), null);
});

test('two runs started in the same minute keep apart (the activity list selects one, not both)', () => {
  const props = {started: '2026-09-29T12:50:00Z', mode: 'mail', status: 'OK', trigger: 'Schedule', seconds: 5};
  const a = history.fromRow(row('3ea62be8-fd86-8145-b7a4-f8301f01b089', props), NOW);
  const b = history.fromRow(row('3ea62be8-fd86-81c2-9d33-01e5c7a2c4d1', props), NOW);
  assert.notEqual(a.id, b.id);
  assert.ok(Math.abs(a.id - Date.parse(props.started)) < 1000 && Math.abs(b.id - Date.parse(props.started)) < 1000);
});

test('a row reads the same with an old or a new title: the kind comes from Mode, never from the title', () => {
  const props = {started: '2026-09-30T09:44:00Z', mode: 'add', status: 'OK', trigger: 'Mac (you)', seconds: 20, summary: 'Tracked recruiter lead'};
  const titled = run => ({...row('3ea62be8-fd86-8145-b7a4-f8301f01b089', props), properties: {...row('x', props).properties, Run: {title: [{plain_text: run}]}}});
  const old = history.fromRow(titled('2026-09-30 11:44 · Logged activity'), NOW);
  const bare = history.fromRow(titled('add'), NOW);
  const fresh = history.fromRow(titled('2026-09-30 11:44 · Log activity · Duvo.ai — SRE'), NOW);
  assert.deepEqual(fresh, old);
  assert.deepEqual(bare, old);
  assert.equal(fresh.kind, 'add');
  assert.equal(fresh.mode, 'add');
});

test('an interview-insights run is named for what it is, not the daily "Insight" (owner, 30 Sep 2026: "confusing")', () => {
  const interview = history.fromRow(row('r9', {started: '2026-09-30T11:56:00Z', mode: 'insight', status: 'OK', trigger: 'Mac (you)', seconds: 40,
    summary: 'Interview insights updated from 2 interview(s): When a client names its key need… (AI cost $0.181)'}), NOW);
  assert.equal(interview.kind, 'interviewInsight');
  assert.equal(history.notice(interview).title, 'Interview insights done');
  const daily = history.fromRow(row('r10', {started: '2026-09-30T07:00:00Z', mode: 'insight', status: 'OK', trigger: 'Schedule', seconds: 40,
    summary: 'Software-titled jobs convert at 3%'}), NOW);
  assert.equal(daily.kind, 'insight');
});
