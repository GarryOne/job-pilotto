// The extension's tab memory survives its own update reload (extension/carry.js): 8 Oct 2026, an update seconds after a fill made the
// app say "Form closed" for an open form and reset the panel to "Fill this form".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {CARRY_MS, packCarry, unpackCarry} from '../../extension/carry.js';

const items = {boot: '1759928000000', 'session:812': 'a094bc8f', 'armed:812': true, 'read:9': 'ab12'};

test('what the worker knew comes back right after its reload', () => {
  assert.deepEqual(unpackCarry(packCarry(items, 1000), 1000 + 800), items);
});

test('a carry too old to trust (a Chrome restart since: tab ids start again) is not put back', () => {
  assert.equal(unpackCarry(packCarry(items, 1000), 1000 + CARRY_MS), null);
  assert.equal(unpackCarry(packCarry(items, 5000), 1000), null);   // from the future: a clock change
});

test('nothing carried, or something unreadable: null', () => {
  for (const carry of [undefined, null, 'x', {}, {at: 'soon', items}, {at: 1000}]) assert.equal(unpackCarry(carry, 1500), null);
});

const worker = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
test('the worker writes its memory before an update reload, and puts it back before it reads the run id or the armed tabs', () => {
  const reload = worker.indexOf('chrome.runtime.reload()');
  assert.ok(worker.lastIndexOf('carry: packCarry(', reload) > worker.lastIndexOf('reloadedFor: answer.latest', reload), 'carry written right before the reload');
  for (const reader of ['const bootId = () =>', 'async function settleOpenTabs() {']) {
    const at = worker.indexOf(reader);
    assert.ok(at > 0 && worker.slice(at, at + 200).includes('await carriedBack'), `${reader} waits for the carry`);
  }
});

test('no update reload while a form is being filled', () => {
  assert.ok(worker.includes("&& !readingNow() && !fillsNow.size) {"), "the update check waits for fills");
  assert.match(worker, /fillsNow\.add\(tab\.id\);\s*try \{ return await fillOpenedTabNow\(tab, \.\.\.rest\); \} finally \{ fillsNow\.delete\(tab\.id\); \}/);
});
