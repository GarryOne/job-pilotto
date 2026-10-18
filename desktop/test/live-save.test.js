// Live cards' save queue (renderer/live-save.js; owner, 18 Oct 2026, pilot): quick changes go out as one write, one write at a time; each row says Saving…,
// then "✓ Saved · Undo" for 8 s; Undo puts the value back and saves that; typing waits for a 1.5 s pause; a failed write keeps the value with Retry and counts on
// the page's save bar (Retry all / Discard there); ⌘Z outside a text box undoes the last saved change.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {liveSaver, undoKey, WAIT_PICK, WAIT_TEXT, KEEP_UNDO} = await import('../renderer/live-save.js');
const {el} = await import('../renderer/components.js');
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const status = row => row.children.find(node => node.classList?.contains('live-status'))?.textContent || '';
const fakeBar = () => ({source: null, register(source) { this.source = source; return {changed() {}}; }});
const button = (row, words) => row.querySelectorAll('button').find(node => node.textContent === words);

test('quick changes on one card go out as one write; each row says Saving…, then Saved · Undo for 8 s', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let writes = 0;
  const saver = liveSaver({save: async () => { writes++; return {ok: true}; }});
  const rows = [el('label'), el('label'), el('label')];
  for (const row of rows) saver.changed(row, () => row);
  assert.equal(status(rows[0]), 'Saving…');
  t.mock.timers.tick(WAIT_PICK - 1);
  assert.equal(writes, 0, 'still gathering');
  t.mock.timers.tick(1);
  await settle();
  assert.equal(writes, 1, 'three changes, one write');
  assert.deepEqual(rows.map(status), Array(3).fill('✓ Saved · Undo'));
  t.mock.timers.tick(KEEP_UNDO);
  assert.equal(status(rows[0]), '', 'the line leaves after 8 s');
});

test('Undo puts the value back and saves that; the row then says Undone', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let writes = 0, undone = 0;
  const saver = liveSaver({save: async () => { writes++; return {ok: true}; }});
  const row = el('label');
  saver.changed(row, () => { undone++; return row; });
  t.mock.timers.tick(WAIT_PICK);
  await settle();
  button(row, 'Undo').click();
  await settle();
  assert.equal(undone, 1);
  assert.equal(writes, 2, 'the undo is saved too');
  assert.equal(status(row), 'Undone');
  assert.equal(button(row, 'Undo'), undefined, 'an undo has no Undo of its own');
});

test('typing waits for a 1.5 s pause; a pick waits less', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let writes = 0;
  const saver = liveSaver({save: async () => { writes++; return {ok: true}; }});
  const row = el('label'), box = el('input');
  row.append(box);
  globalThis.document.activeElement = box;
  saver.changed(row, () => row);
  assert.equal(status(row), '', 'no "Saving…" while typing');
  t.mock.timers.tick(WAIT_PICK);
  await settle();
  assert.equal(writes, 0);
  t.mock.timers.tick(WAIT_TEXT - WAIT_PICK);
  await settle();
  assert.equal(writes, 1);
  globalThis.document.activeElement = null;
  assert.ok(WAIT_TEXT === 1500 && WAIT_PICK < WAIT_TEXT, 'owner decision 1: a 1.5 s pause');
});

test('a failed write keeps the value with Retry, and counts on the page bar until it is saved', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let answer = {ok: false, error: 'Notion did not answer'};
  const bar = fakeBar();
  const saver = liveSaver({save: async () => answer, bar, id: 'x', tab: 'details', label: 'Languages'});
  const row = el('label');
  saver.changed(row, () => row);
  t.mock.timers.tick(WAIT_PICK);
  await settle();
  assert.equal(status(row), 'Not saved · Retry');
  assert.ok(row.classList.contains('live-failed'));
  assert.equal(bar.source.count(), 1, 'the bar shows (and leaving the page asks) only now');
  answer = {ok: true};
  button(row, 'Retry').click();
  await settle();
  assert.equal(status(row), '✓ Saved · Undo');
  assert.equal(bar.source.count(), 0);
  assert.equal(row.classList.contains('live-failed'), false);
});

test('the bar\'s Discard all puts failed rows back as they were saved', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const bar = fakeBar();
  let back = 0;
  const saver = liveSaver({save: async () => ({ok: false, error: 'offline'}), bar, id: 'x'});
  saver.changed(el('label'), () => { back++; });
  t.mock.timers.tick(WAIT_PICK);
  await settle();
  bar.source.discard();
  assert.equal(back, 1);
  assert.equal(bar.source.count(), 0);
});

test('one write at a time: a change during a write goes out right after it', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let open = 0, most = 0, writes = 0, finish = null;
  const saver = liveSaver({save: () => { open++; most = Math.max(most, open); writes++; return new Promise(done => { finish = () => { open--; done({ok: true}); }; }); }});
  const a = el('label'), b = el('label');
  saver.changed(a, () => a);
  t.mock.timers.tick(WAIT_PICK);
  await settle();
  saver.changed(b, () => b);
  t.mock.timers.tick(WAIT_PICK);
  await settle();
  assert.equal(writes, 1, 'held while the first write runs');
  finish();
  await settle();
  t.mock.timers.tick(0);
  await settle();
  assert.equal(writes, 2);
  assert.equal(most, 1);
});

test('⌘Z outside a text box undoes the last saved change; inside a box it is the box\'s own', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let undone = 0;
  const saver = liveSaver({save: async () => ({ok: true})});
  const row = el('label');
  saver.changed(row, () => { undone++; return row; });
  t.mock.timers.tick(WAIT_PICK);
  await settle();
  assert.equal(undoKey({metaKey: true, key: 'z', target: el('input')}), false);
  assert.equal(undoKey({metaKey: true, key: 'z', target: el('div')}), true);
  await settle();
  assert.equal(undone, 1);
  assert.equal(undoKey({metaKey: true, key: 'z', target: el('div')}), false, 'nothing left to undo');
});
