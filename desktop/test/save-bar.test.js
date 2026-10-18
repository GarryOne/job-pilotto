// The one page save bar (renderer/save-bar.js; owner, 18 Oct 2026, UI redesign D2): counts drafts across tabs and names them, dots on those tabs, Discard all
// asks when drafts sit on more than one tab, a failed check saves nothing and names tab + field, a part-way failure keeps the failed drafts, leaving asks.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {pageSaveBar, scopeText, countText, anyUnsaved} = await import('../renderer/save-bar.js');
const {el} = await import('../renderer/components.js');

const TABS = {details: 'Your details', experience: 'Experience', answers: 'Application answers'};
function setup() {
  const host = el('div'), buttons = Object.fromEntries(Object.keys(TABS).map(key => [key, el('button')]));
  const opened = [];
  const bar = pageSaveBar({host, tabs: TABS, tabButton: key => buttons[key], openTab: key => opened.push(key), words: 'Used from the next form.'});
  // A card's drafts: a Map of field → value; save() clears them unless told to fail.
  const card = (id, tab, label, {fail = '', invalid = null} = {}) => {
    const drafts = new Map();
    const source = {id, tab, label, count: () => drafts.size, discard: () => drafts.clear(), revealed: [],
      reveal: field => source.revealed.push(field),
      validate: invalid ? () => ({ok: false, ...invalid}) : undefined,
      save: async () => { if (fail) return {ok: false, error: fail}; drafts.clear(); return {ok: true}; }};
    const handle = bar.register(source);
    return {source, edit: (field, value) => { drafts.set(field, value); handle.changed(); }};
  };
  return {host, bar, buttons, opened, card, title: () => bar.node.querySelector('.save-bar-title').textContent, note: () => bar.node.querySelector('.message').textContent};
}

test('scope and count words', () => {
  assert.equal(scopeText(['Your details']), 'Your details');
  assert.equal(scopeText(['Your details', 'Experience']), 'Your details and Experience');
  assert.equal(scopeText(['CV', 'Your details', 'Experience', 'CV']), 'CV, Your details and Experience');
  assert.equal(countText(1), '1 unsaved change');
  assert.equal(countText(3), '3 unsaved changes');
});

test('the bar hides with no drafts; with drafts it names every tab and dots them; its buttons say "all"', () => {
  const {bar, buttons, card, title} = setup();
  assert.equal(bar.node.hidden, true);
  const contact = card('contact', 'details', 'Contact'), summary = card('summary', 'experience', 'Summary');
  contact.edit('email', 'a@b.c'); contact.edit('phone', '1'); summary.edit('text', 'x');
  assert.equal(bar.node.hidden, false);
  assert.equal(title(), '3 unsaved changes in Your details and Experience');
  assert.equal(buttons.details.classList.contains('has-drafts'), true);
  assert.equal(buttons.experience.classList.contains('has-drafts'), true);
  assert.equal(buttons.answers.classList.contains('has-drafts'), false);
  assert.deepEqual(bar.node.querySelectorAll('button').map(node => node.textContent), ['Discard all', 'Save all changes']);
  assert.equal(anyUnsaved(), true, 'the window close guard sees the drafts');
});

test('Save all saves every tab, then says Saved and clears the dots', async () => {
  const {bar, buttons, card, note} = setup();
  card('contact', 'details', 'Contact').edit('email', 'a@b.c');
  card('summary', 'experience', 'Summary').edit('text', 'x');
  const result = await bar.saveAll();
  assert.equal(result.ok, true);
  assert.equal(bar.count(), 0);
  assert.equal(note(), 'Saved ✓');
  assert.equal(buttons.details.classList.contains('has-drafts'), false);
});

test('a failed check saves nothing, keeps every draft and names the tab and field', async () => {
  const {bar, opened, card, note} = setup();
  const contact = card('contact', 'details', 'Contact', {invalid: {field: 'Email', error: 'not an e-mail address'}});
  const summary = card('summary', 'experience', 'Summary');
  contact.edit('email', 'nope'); summary.edit('text', 'x');
  const result = await bar.saveAll();
  assert.equal(result.ok, false);
  assert.equal(bar.count(), 2, 'no draft is lost');
  assert.match(note(), /^Nothing saved\. Your details · Contact · Email: not an e-mail address$/);
  assert.deepEqual(opened, ['details']);
  assert.deepEqual(contact.source.revealed, ['Email']);
});

test('a save that fails part-way keeps the failed drafts, names them and never says Saved', async () => {
  const {bar, card, note, title} = setup();
  card('contact', 'details', 'Contact').edit('email', 'a@b.c');
  card('summary', 'experience', 'Summary', {fail: 'Notion is busy'}).edit('text', 'x');
  const result = await bar.saveAll();
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed.map(item => item.id), ['summary']);
  assert.equal(bar.count(), 1);
  assert.equal(title(), '1 unsaved change in Experience');
  assert.match(note(), /Experience · Summary: Notion is busy \(the other change was saved\)/);
  assert.doesNotMatch(note(), /Saved ✓/);
});

test('Discard all asks first when drafts sit on more than one tab; one tab discards at once', () => {
  const {bar, card} = setup();
  const asked = [];
  globalThis.confirm = text => { asked.push(text); return false; };
  card('contact', 'details', 'Contact').edit('email', 'a@b.c');
  assert.equal(bar.discardAll(), true, 'one tab: no question');
  assert.equal(asked.length, 0);
  card('links', 'details', 'Links').edit('github', 'x');
  card('summary', 'experience', 'Summary').edit('text', 'x');
  assert.equal(bar.discardAll(), false, 'said no');
  assert.deepEqual(asked, ['Discard your unsaved changes in Your details and Experience?']);
  assert.equal(bar.count(), 2);
  globalThis.confirm = () => true;
  assert.equal(bar.discardAll(), true);
  assert.equal(bar.count(), 0);
  delete globalThis.confirm;
});

test('leaving the page: free with no drafts, held (and asked) with drafts', () => {
  const {bar, card} = setup();
  let went = 0;
  assert.equal(bar.leave(() => went++), true);
  card('contact', 'details', 'Contact').edit('email', 'a@b.c');
  assert.equal(bar.leave(() => went++), false, 'held: the dialog asks Keep editing / Discard all / Save all changes');
  assert.equal(went, 0);
});

test('saveLabel names the scope on the bar and in the leave question (Strategy: "Save strategy changes")', () => {
  const host = el('div');
  const bar = pageSaveBar({host, tabs: {targets: 'Targets'}, saveLabel: 'Save strategy changes'});
  const drafts = new Map();
  const handle = bar.register({id: 'targets', tab: 'targets', label: 'Targets', count: () => drafts.size, save: async () => ({ok: true}), discard: () => drafts.clear()});
  drafts.set('role', 'x'); handle.changed();
  assert.deepEqual(bar.node.querySelectorAll('button').map(node => node.textContent), ['Discard all', 'Save strategy changes']);
  assert.equal(bar.leave(() => {}), false);
  const dialog = globalThis.document.body.querySelectorAll('dialog').at(-1);
  assert.ok(dialog?.querySelectorAll('button').map(node => node.textContent).includes('Save strategy changes'), 'the leave question says it too');
});

test('a source must say how to count, save and discard', () => {
  const {bar} = setup();
  assert.throws(() => bar.register({id: 'x', count: () => 0}), /needs save/);
});
