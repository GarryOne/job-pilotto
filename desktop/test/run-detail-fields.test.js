// Recent activity → a run's detail (P8 D): who started it and whether its message went to Telegram, from either store's run record.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fromRecord, fromRow} from '../lib/run-rows.js';

test('the store on this Mac: the trigger as written and stats.telegram', () => {
  const run = fromRecord({id: 'r1', mode: 'mail', status: 'Done', trigger: 'Telegram', started_at: '2026-10-09T08:00:00Z', finished_at: '2026-10-09T08:01:00Z',
    summary: 'Gmail check: nothing new', stats: {telegram: 1, billed_to: 'Plan'}}, Date.parse('2026-10-09T09:00:00Z'));
  assert.deepEqual([run.startedBy, run.telegram, run.billing], ['Telegram', true, 'Plan']);
  assert.equal(fromRecord({id: 'r2', status: 'Done', started_at: '2026-10-09T08:00:00Z', stats: {}}).telegram, false);
});

test('Notion: the Trigger select and the Telegram text column', () => {
  const text = content => ({rich_text: [{plain_text: content}]});
  const run = fromRow({id: 'p1', url: 'https://www.notion.so/p1', created_time: '2026-10-09T08:00:00Z', properties: {
    Mode: {select: {name: 'mail'}}, Status: {select: {name: 'Done'}}, Trigger: {select: {name: 'Manual'}}, Started: {date: {start: '2026-10-09T08:00:00Z'}},
    Summary: text('Gmail check: nothing new'), Telegram: text('📬 Gmail check…')}}, Date.parse('2026-10-09T09:00:00Z'));
  assert.deepEqual([run.startedBy, run.telegram], ['Manual', true]);
});
