// Strategy's cards as one system (owner, 18 Oct 2026, UI redesign B, decision 4): Edit opens only that card's editor; opening another keeps the first
// card's draft and marks it "Unsaved"; one page bar, "Save strategy changes", saves each card's draft to its own home (lists → editTargets, goals →
// editGoal) and discards them all; Esc closes the editor without dropping the draft. The class: every list the target cards edit belongs to one card.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const calls = [];
globalThis.window.pilot = {state: async () => ({settings: {}}),
  editTargets: async lists => { calls.push(['lists', lists]); return {ok: true}; },
  editGoal: async (key, text) => { calls.push(['goal', key, text]); return {ok: true}; }};
const {el} = await import('../renderer/components.js');
const {CARDS, cardOf, cardHeader, cardCount, changed, closeCard, drafts, isOpen, openCard, strategyBar} = await import('../renderer/pages/strategy-cards.js');
const {strategyState} = await import('../renderer/pages/strategy-state.js');

// A page with one card per key, drawn like the real ones: the header from cardHeader, data-card on the section.
const page = el('div', 'strategy-page'), host = el('div');
host.id = 'strategy-bar-host';
globalThis.document.body.append(page, host);
let reloads = 0;
const redraw = () => page.replaceChildren(...Object.keys(CARDS).map(key => {
  const card = el('section', 'card');
  card.dataset.card = key;
  card.append(cardHeader(key, 'pin', 'teal', CARDS[key].title, '', card));
  return card;
}));
strategyState.lastStrategy = {lists: {places: [{fragment: 'zurich', label: 'zurich'}]}, texts: {}};
const bar = strategyBar({redraw, reload: () => { reloads += 1; }, entriesOf: name => strategyState.lastStrategy.lists[name] || []});
redraw();
const card = key => page.querySelector(`[data-card="${key}"]`);
const badge = key => card(key).querySelector('.unsaved-badge');

test('Edit opens only that card; another card keeps the first one\'s draft, shown as Unsaved', () => {
  card('places').querySelector('.card-edit').click();
  assert.ok(isOpen('places'));
  assert.equal(page.querySelectorAll('.card-done').length, 1, 'one editor open');
  drafts().targetEdits.places = {add: ['basel'], remove: []};
  changed();
  assert.equal(badge('places').hidden, false);
  assert.equal(bar.count(), 1);
  card('search').querySelector('.card-edit').click();
  assert.ok(isOpen('search') && !isOpen('places'));
  assert.deepEqual(drafts().targetEdits.places.add, ['basel'], 'the first card\'s draft is kept');
  assert.equal(badge('places').hidden, false, 'its summary says Unsaved');
  assert.equal(badge('search').hidden, true);
});

test('Esc and Done close the editor; the draft stays; Done hides while the open card holds a change (card-shell.js doneButton)', () => {
  openCard('places');
  assert.equal(card('places').querySelector('.card-done').hidden, true, 'with a change the bar decides');
  for (const fn of globalThis.document.listeners?.keydown || []) fn({key: 'Escape', defaultPrevented: false});
  assert.equal(strategyState.editing, '');
  openCard('goals');
  card('goals').querySelector('.card-done').click();
  assert.equal(strategyState.editing, '');
  assert.equal(bar.count(), 1, 'nothing dropped');
});

test('the one bar is "Save strategy changes" and saves each card to its own home, goals included', async () => {
  assert.equal(host.querySelector('.primary').textContent, 'Save strategy changes');
  drafts().goalEdits.work_mode = 'Hybrid';
  drafts().typed.stack = 'Kubernetes';
  changed();
  assert.equal(cardCount('goals'), 1);
  assert.equal(bar.count(), 3);
  const result = await bar.saveAll();
  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter(([kind]) => kind === 'lists').map(([, lists]) => Object.keys(lists)).sort(), [['places'], ['stack']]);
  assert.deepEqual(calls.find(([, lists]) => lists.stack)[1].stack.add, ['kubernetes'], 'a word still typed is saved too');
  assert.deepEqual(calls.filter(([kind]) => kind === 'goal'), [['goal', 'work_mode', 'Hybrid']]);
  assert.equal(bar.count(), 0);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(reloads, 1, 'one read after the saves, not one per card');
});

test('Discard all drops every card\'s draft and writes nothing', () => {
  calls.length = 0;
  drafts().targetEdits.queries = {add: ['devops'], remove: []};
  drafts().goalEdits.seniority = 'Senior';
  changed();
  assert.equal(bar.count(), 2);
  bar.discardAll({ask: false});
  assert.equal(bar.count(), 0);
  assert.deepEqual(calls, []);
});

test('class: every list and value the target cards edit belongs to exactly one card', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/strategy-targets.js', import.meta.url), 'utf8');
  const lists = [...source.matchAll(/\['(\w+)', '[^']*', 'Add [^']*'\]/g)].map(([, name]) => name);
  assert.ok(lists.length >= 12, `read the lists: ${lists}`);
  for (const name of [...lists, 'roles', 'remote', 'relocation', 'minScore']) {
    const owners = Object.keys(CARDS).filter(key => CARDS[key].lists.includes(name) || CARDS[key].values.includes(name));
    assert.equal(owners.length, 1, `${name}: owned by ${owners}`);
    assert.equal(cardOf(name), owners[0]);
  }
  closeCard();
});
