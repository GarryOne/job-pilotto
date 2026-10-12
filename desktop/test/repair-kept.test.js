// The fill ladder's kept repairs (lib/ladder/repair-kept.js, PR D): a repair that worked is kept per the control's fingerprint (no text), only when it does not depend on one page;
// the next miss on that widget is repaired from it without a model call, through the same floors; one miss drops it; the counts are fixed values for the feed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {counts, keptFor, noteRepair, repairStore} from '../lib/ladder/repair-kept.js';
import {askRepair} from '../lib/ladder/fill-repair.js';

const fresh = () => repairStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-repairs-')), 'fill-repairs.json'));
const raw = {url: 'https://jobs.example.com/apply/1', title: 'Apply', buttons: [], texts: [], frames: [], controls: [
  {type: 'text', label: 'First name', state: 'filled', match: 'yes', fp: 'abc123'},
  {type: 'select-one', label: 'Country', required: true, state: 'empty', match: 'no', answer: 'dial_code', options: ['Select', 'Switzerland'], fp: 'menu42x'},
  {type: 'checkbox', label: 'I accept the terms', state: 'unchecked', match: 'no', legal: true, fp: 'box77zz'}]};
const client = answer => { const sent = []; return {sent, messages: {create: async body => { sent.push(body); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}]}; }}}; };

test('only a page-independent repair that worked is kept; a numbered option or a layer button is asked again; text cannot be stored', () => {
  const store = fresh();
  assert.equal(noteRepair(store, {fp: 'menu42x', verb: 'choose_option', widget: 'native_select', option: 0, ok: true}), 'kept');
  assert.equal(noteRepair(store, {fp: 'other99', verb: 'choose_option', widget: 'native_select', option: 3, ok: true}), 'counted', 'option 3 belongs to one page');
  assert.equal(noteRepair(store, {fp: 'layer11', verb: 'dismiss_layer', widget: 'other', option: 2, ok: true}), 'counted');
  assert.equal(noteRepair(store, {fp: 'Not A Fingerprint', verb: 'retype', widget: 'text', ok: true}), '');
  assert.equal(noteRepair(store, {fp: 'box1234', verb: 'retype', widget: 'text', ok: true, label: 'secret', value: 'secret'}), 'kept');
  assert.ok(!JSON.stringify(store.data).includes('secret'));
  assert.deepEqual(keptFor(store, 'menu42x'), {verb: 'choose_option', widget: 'native_select'});
});

test('one miss drops a kept repair; a hit counts; the counts are fixed values for the feed', () => {
  const store = fresh();
  noteRepair(store, {fp: 'menu42x', verb: 'choose_option', widget: 'native_select', option: 0, ok: true});
  assert.equal(noteRepair(store, {fp: 'menu42x', verb: 'choose_option', widget: 'native_select', option: 0, ok: true}), 'hit');
  assert.equal(noteRepair(store, {fp: 'menu42x', verb: 'choose_option', widget: 'native_select', option: 0, ok: false}), 'dropped');
  assert.equal(keptFor(store, 'menu42x'), null);
  assert.deepEqual(counts(store), [{fp: 'menu42x', verb: 'choose_option', ok: 2, failed: 1}]);
});

test('the second miss on the same widget is repaired from the kept repair with NO model call; the floors still hold', async () => {
  const store = fresh();
  const first = client({repairs: [{n: 2, widget: 'native_select', verb: 'choose_option', option: 0}]});
  const one = await askRepair(first, raw, [{n: 2, verdict: 'wrong', reason: 'wrong_class'}], {keptFor: fp => keptFor(store, fp)});
  assert.equal(first.sent.length, 1);
  noteRepair(store, {fp: 'menu42x', ...one.repairs[0], ok: true});
  const second = client({repairs: []});
  const two = await askRepair(second, raw, [{n: 2, verdict: 'wrong', reason: 'wrong_class'}], {keptFor: fp => keptFor(store, fp)});
  assert.equal(second.sent.length, 0, 'the second visit asks nothing');
  assert.deepEqual(two.repairs.map(row => [row.n, row.verb, row.option, row.kept]), [[2, 'choose_option', 0, true]]);
  assert.equal(two.asked, false);
  noteRepair(store, {fp: 'box77zz', verb: 'toggle', widget: 'checkbox_group', ok: true});
  const legal = await askRepair(null, raw, [{n: 3, verdict: 'empty', reason: 'not_selected'}], {keptFor: fp => keptFor(store, fp)});
  assert.deepEqual(legal.repairs.map(row => [row.n, row.verb, row.refused]), [[3, 'ask_person', 'floor: legal or password']], 'a kept toggle on a legal box is refused like a fresh one');
});

test('the app\'s route: a reported result keeps the repair; the next repair ask for that fingerprint makes no model call', async () => {
  const {decideAccountJudge} = await import('../lib/server-pages.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-repairs-route-')), storage = {path: name => path.join(dir, name)};
  const noted = await decideAccountJudge(storage, {phase: 'repair-result', results: [{fp: 'menu42x', verb: 'choose_option', widget: 'native_select', option: 0, ok: true}]});
  assert.deepEqual(noted, {ok: true, noted: ['kept']});
  const silent = client({repairs: []});
  const found = await decideAccountJudge(storage, {phase: 'repair', sketch: raw, verdicts: [{n: 2, verdict: 'wrong', reason: 'wrong_class'}]}, {client: silent});
  assert.equal(silent.sent.length, 0);
  assert.deepEqual(found.repairs.map(row => [row.n, row.verb, row.kept]), [[2, 'choose_option', true]]);
  assert.ok(fs.readFileSync(path.join(dir, 'fill-repairs.json'), 'utf8').includes('menu42x'));
});
