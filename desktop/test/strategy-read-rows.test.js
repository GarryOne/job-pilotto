// Strategy's cards as read (owner, 18 Oct 2026, Strategy sketch, decisions 1 and 3): every target card reads as the card shell's lined rows (label left,
// values right, a line between settings), never the old icon rows or "Also inside longer words / Whole word only" headings; a long list shows its
// first 10 chips and "+N more"; a chip that also matches inside longer words is outlined with "≈" and the card says so once. The class: every card.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const every = globalThis.setInterval;   // page modules start their clocks when loaded (interviews.js): never keep the test alive
globalThis.setInterval = (run, ms, ...rest) => every(run, ms, ...rest).unref();
// The page modules look up their nodes when loaded: every id the window's markup has, as an empty node.
const markup = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
for (const [, id] of markup.matchAll(/\sid="([^"]+)"/g)) { const node = globalThis.document.createElement('div'); node.id = id; globalThis.document.body.append(node); }
globalThis.window.pilot = {state: async () => ({settings: {}}), listMeanings: async () => ({meanings: {}, kept: []}), cached: async () => null};
const {TARGET_CARDS, renderTargets} = await import('../renderer/pages/strategy-targets.js');
const {strategyState} = await import('../renderer/pages/strategy-state.js');

const word = n => ({fragment: `place${n}`, label: `place${n}`});
const abroad = Array.from({length: 80}, (_, n) => word(n));
strategyState.lastStrategy = {
  lists: {places: [{fragment: '"zug"', label: 'zug'}, {fragment: 'st.? ?gallen', label: 'st gallen'}], country: [word(1)], abroad, rights: [{fragment: 'eu', label: 'eu'}],
    stack: [{fragment: 'kubernetes', label: 'kubernetes'}], titleSkip: [{fragment: 'tax', label: 'tax'}, {fragment: '"sales"', label: 'sales'}]},
  texts: {queries: ['Software Engineer'], languages: ['German']}, relocation: 'yes', goals: {}, components: [],
};
renderTargets();
const card = key => globalThis.document.querySelector(`[data-card="${key}"]`);

test('class: every target card reads as lined rows, with no old icon rows or match-group headings', () => {
  for (const [key] of TARGET_CARDS) {
    const node = card(key);
    assert.ok(node, `${key}: drawn`);
    assert.ok(node.querySelector('.summary-rows.is-lined'), `${key}: lined rows`);
    assert.equal(node.querySelector('.setting-row:not(.coverage-line)'), null, `${key}: no old icon row`);
    assert.doesNotMatch(node.textContent, /Also inside longer words\b(?! \(tax)|Whole word only/, `${key}: no group headings`);
  }
});

test('a long list shows 10 chips and "+70 more"', () => {
  const relocation = [...card('places').querySelectorAll('dd')].find(dd => /Place0/.test(dd.textContent));
  assert.equal(relocation.querySelectorAll('.chip-tag').length, 10);
  assert.match(relocation.querySelector('.chip-more').textContent, /^\+70 more$/);
});

test('a list mixing both kinds outlines the match-anywhere chips and adds one legend line', () => {
  const places = card('places');
  const marked = [...places.querySelectorAll('dd')].flatMap(dd => [...dd.querySelectorAll('.chip-tag.is-part')]).map(node => node.querySelector('.chip-value').textContent);
  assert.deepEqual(marked, ['St Gallen']);
  assert.equal(places.querySelectorAll('.part-legend').length, 1);
  assert.equal(card('stack').querySelector('.part-legend'), null, 'one kind only: nothing to tell apart');
});
