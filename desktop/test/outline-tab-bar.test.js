// An outline tab on the page's one save bar (owner, 18 Oct 2026: "one sticky Save/Discard bar for all Strategy drafts"; Strategy → Job preferences): given
// {bar, tab, label}, outlineTab draws no bar of its own, counts its changes on the page bar, and the page bar's Save writes them (textEdit) and its Discard
// drops them. Without a bar it keeps its own (Profile's tabs until they move).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const edits = [];
globalThis.window.pilot = {state: async () => ({settings: {}}), textEdit: async (name, changes) => { edits.push({name, changes}); return {ok: true, items: []}; },
  textOutline: async () => ({ok: true, items: [], store: 'sqlite', link: ''})};
const {pageSaveBar} = await import('../renderer/save-bar.js');
const {outlineTab} = await import('../renderer/pages/outline-tab.js');
const {el} = await import('../renderer/components.js');

function setup(withBar) {
  const host = el('div'), body = el('div');
  const bar = withBar ? pageSaveBar({host, tabs: {yours: 'Your strategy'}, area: 'Strategy'}) : null;
  let view = null;
  const tab = outlineTab('prefs-test', ['Profile'], body, next => { view = next; }, withBar ? {bar, tab: 'yours', label: 'Job preferences'} : {});
  tab.redraw();
  return {bar, body, tab, view: () => view};
}

test('on a page bar: no own bar, its changes counted there, saved and discarded by it', async () => {
  const {bar, body, view} = setup(true);
  assert.equal(body.querySelector('.save-bar'), null, 'no bar of its own');
  view().change('Profile', {op: 'set', id: 'a', index: 0, text: 'Full-time'});
  assert.equal(bar.count(), 1);
  assert.equal(bar.node.hidden, false);
  await bar.saveAll();
  assert.deepEqual(edits.map(edit => edit.name), ['Profile']);
  assert.equal(bar.count(), 0);
  view().change('Profile', {op: 'set', id: 'b', index: 0, text: '80%'});
  bar.discardAll();
  assert.equal(bar.count(), 0);
  assert.equal(edits.length, 1, 'discard writes nothing');
});

test('without a page bar it keeps its own', () => {
  const {body} = setup(false);
  assert.ok(body.querySelector('.save-bar'), 'its own bar');
});
