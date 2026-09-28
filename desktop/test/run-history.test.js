import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as history from '../lib/run-history.js';

const row = (id, props, extra = {}) => ({id, url: `https://www.notion.so/${id}`, created_time: '2026-09-28T10:00:00.000Z', ...extra, properties: {
  Started: {date: {start: props.started}}, Mode: {select: {name: props.mode}}, Status: {select: {name: props.status}},
  Trigger: {select: {name: props.trigger}}, Summary: {rich_text: [{plain_text: props.summary || ''}]},
  'Duration (s)': {number: props.seconds ?? null}, 'New jobs': {number: props.fresh ?? 0}, 'AI cost (USD)': {number: 0.01},
  'Run URL': {url: props.runUrl || null}}});
const NOW = Date.parse('2026-09-28T12:10:00Z');

test('a Notion ⏱️ Search runs row reads as an activity record, wherever it ran', () => {
  const gh = history.fromRow(row('r1', {started: '2026-09-28T12:00:00Z', mode: 'insight', status: 'OK', trigger: 'Schedule', seconds: 50,
    summary: 'Insight sent: Skills — Go is in 40% (AI cost $0.012)', runUrl: 'https://github.com/me/p/actions/runs/1'}), NOW);
  assert.equal(gh.kind, 'insight');
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
  assert.deepEqual(await history.detail(storage, 'r1', {fetcher}), {message: '💡 Skills\nGo is in 40%', log: ['line 1', 'line 2']});
});
