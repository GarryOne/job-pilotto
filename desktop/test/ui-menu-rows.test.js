// The shared ⋯ menu (components.js openMenu) grown into a list a navigator can use (owner, 18 Oct 2026: "I don't like this dropdown... make it
// nice. Modern."): a row may carry an icon tile, a detail line, a state pill and a current mark; a heading names a group; a search box filters
// long lists; ↑ / ↓ move between rows. Plain ⋯ items are unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const {openMenu, closeMenu, menuStep} = await import('../renderer/components.js');
const menu = () => body.querySelector('.ui-menu');
const anchor = () => { const node = globalThis.document.createElement('button'); body.append(node); return node; };

test('a plain ⋯ item is drawn as before: one button with its label', () => {
  const ran = [];
  openMenu(anchor(), [{label: 'Dismiss', run: () => ran.push('dismiss')}, '-', {label: 'Delete', danger: true, run() {}}]);
  assert.equal(menu().hidden, false);
  const buttons = menu().querySelectorAll('button');
  assert.deepEqual(buttons.map(b => b.textContent), ['Dismiss', 'Delete']);
  assert.equal(menu().querySelectorAll('.ui-menu-row').length, 0);
  buttons[0].click();
  assert.deepEqual(ran, ['dismiss']);
  assert.equal(menu().hidden, true);
});

test('a row: tile, label, detail line, state pill, current mark; a heading starts a group', () => {
  openMenu(anchor(), [
    {label: 'Earliest start date', detail: 'Your details → Availability', tile: 'calendar', badge: ['Missing', 'warn'], current: true, run() {}},
    {heading: 'Set aside · 1 · not counted'},
    {label: 'Title', detail: 'Adnovum · Application form', badge: ['Set aside', 'neutral'], run() {}},
  ], {width: 'anchor'});
  const rows = menu().querySelectorAll('.ui-menu-row');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Earliest start date/);
  assert.match(rows[0].querySelector('.ui-menu-detail').textContent, /Your details → Availability/);
  assert.equal(rows[0].querySelector('.ui-pill').textContent, 'Missing');
  assert.ok(rows[0].querySelector('.ui-pill').classList.contains('tone-warn'));
  assert.equal(rows[0].getAttribute('aria-current'), 'true');
  assert.ok(rows[0].classList.contains('is-current'));
  assert.equal(rows[1].getAttribute('aria-current'), null);
  assert.equal(menu().querySelector('.ui-menu-heading').textContent, 'Set aside · 1 · not counted');
  closeMenu();
});

test('a search box only from the given count; typing keeps the rows whose words match and their group', () => {
  const items = n => Array.from({length: n}, (_, i) => ({label: i === 4 ? 'Expected yearly salary' : `Question ${i + 1}`, detail: i === 6 ? 'Salary per country' : 'Acme', run() {}}));
  openMenu(anchor(), items(8), {search: 9});
  assert.equal(menu().querySelector('.ui-menu-search'), null, '8 rows: no search');
  closeMenu();
  openMenu(anchor(), [...items(9), {heading: 'Set aside · 1'}, {label: 'How did you hear about us?', run() {}}], {search: 9});
  const box = menu().querySelector('.ui-menu-search input');
  assert.ok(box, '9 rows: a search box');
  box.value = 'salary';
  box.dispatch('input');
  const shown = menu().querySelectorAll('button').filter(b => !b.hidden).map(b => b.querySelector('.ui-menu-label')?.textContent || b.textContent);
  assert.deepEqual(shown, ['Expected yearly salary', 'Question 7'], 'label or detail matches');
  assert.equal(menu().querySelector('.ui-menu-heading').hidden, true, 'a group with no match hides its heading');
  box.value = '';
  box.dispatch('input');
  assert.equal(menu().querySelectorAll('button').filter(b => b.hidden).length, 0);
  closeMenu();
});

test('↑ / ↓ move between the rows that show, and wrap', () => {
  assert.equal(menuStep(0, 3, 'ArrowDown'), 1);
  assert.equal(menuStep(2, 3, 'ArrowDown'), 0);
  assert.equal(menuStep(0, 3, 'ArrowUp'), 2);
  assert.equal(menuStep(-1, 3, 'ArrowDown'), 0, 'from the search box: the first row');
  assert.equal(menuStep(1, 3, 'Home'), 0);
  assert.equal(menuStep(1, 3, 'End'), 2);
  assert.equal(menuStep(1, 3, 'x'), null);
});

// 18 Oct 2026 (the navigator's first render): the click that opened the list from a button that is not a ⋯ reached the document's "click outside"
// check and shut the list at once; and closing left that button's aria-expanded "true", so the next press read as "close".
test('any anchor: its own click is not "outside", and closing resets its aria-expanded', () => {
  const source = fs.readFileSync(new URL('../renderer/components.js', import.meta.url), 'utf8');
  assert.match(source, /addEventListener\('click', event => \{ if \(!menu\.hidden && !event\.target\.closest\('\.ui-menu, \.ui-more'\) && !menuAnchor\?\.contains\(event\.target\)\) closeMenu\(\); \}\)/);
  const button = anchor();
  openMenu(button, [{label: 'Go', run() {}}]);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  closeMenu();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  openMenu(button, [{label: 'Go', run() {}}]);
  assert.equal(menu().hidden, false, 'the next press opens it again');
  closeMenu();
});
