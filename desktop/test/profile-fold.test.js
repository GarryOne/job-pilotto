// Every Profile tab's cards fold, and one bar opens or folds the cards of the tab you are on and never another tab's (owner, 18 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {TABS, countTab, foldTab} = await import('../renderer/profile-fold.js');

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
// The panels of each tab, from the markup: id, tab, and whether a title bar (panel-top or summary-head) follows.
const panels = [...html.matchAll(/<div class="setting panel[^"]*" id="([^"]+)" data-profile-panel="(\w+)"[^>]*>\s*<div class="(panel-top|summary-head)/g)].map(([, id, tab, bar]) => ({id, tab, bar}));
const fakeCards = () => {
  const cards = new Map();
  for (const panel of panels) cards.set(panel.id, {tab: panel.tab, folded: false, set(on) { this.folded = on; }, isFolded() { return this.folded; }});
  cards.set('card-a', {tab: 'experience', folded: false, set(on) { this.folded = on; }, isFolded() { return this.folded; }});
  return cards;
};

test('class: every Profile tab has foldable cards in the markup, each with a title bar', () => {
  for (const tab of TABS) assert.ok(panels.some(panel => panel.tab === tab) || tab === 'experience', `${tab} has no foldable card`);
  const all = [...html.matchAll(/class="setting panel[^"]*" id="([^"]+)" data-profile-panel="(\w+)"/g)].map(([, id]) => id);
  assert.deepEqual(all.filter(id => !panels.some(panel => panel.id === id)), [], 'a Profile card without a title bar cannot fold');
});

test('Collapse all folds every card of the open tab and leaves the other tabs as they were; Expand all opens them again', () => {
  for (const tab of TABS) {
    const cards = fakeCards(), before = new Map([...cards].map(([id, card]) => [id, card.folded]));
    const touched = foldTab(cards, tab, true);
    assert.equal(touched, [...cards.values()].filter(card => card.tab === tab).length, tab);
    for (const [id, card] of cards) assert.equal(card.folded, card.tab === tab ? true : before.get(id), `${tab}: ${id}${card.tab === tab ? ' should be folded' : ' must not change'}`);
    foldTab(cards, tab, false);
    assert.ok([...cards.values()].filter(card => card.tab === tab).every(card => !card.folded), `${tab}: Expand all opens them`);
    assert.deepEqual(countTab(cards, tab), {cards: touched, open: touched});
  }
});

test('the bar sits at the bottom of the Profile page with both buttons, and the page wires it', () => {
  assert.match(html, /id="profile-foldbar"[^>]*role="toolbar"[\s\S]*data-fold="open">Expand all<[\s\S]*data-fold="close">Collapse all</);
  const profile = read('pages/profile.js');
  assert.match(profile, /foldProfilePanels\(/);
  assert.match(profile, /initFoldBar\(\)/);
  assert.match(profile, /showFoldBar\(\);[\s\S]{0,80}if \(name === 'answers'\)/, 'the bar follows the tab that opens');
  assert.match(read('pages/experience-profile.js'), /registerCard\(box, tab\)/, 'the Experience cards fold with the rest');
  assert.match(read('components.css'), /\.foldbar \{ position: sticky; bottom: 0;/);
});

// Owner, 18 Oct 2026: "x of x filled" must start at one x on every folded card: the title block has one width and the summary is the grid's second column.
test('class: every folded Profile card puts its summary in one column, whatever the title or actions', () => {
  const css = read('components.css'), fold = read('profile-fold.js');
  assert.match(fold, /bar\.classList\.add\('has-summary'\)/);   // every card of every tab goes through foldProfilePanels
  assert.match(css, /\.panel-top\.has-summary \{[^}]*grid-template-columns: minmax\(0, var\(--fold-title-w\)\) minmax\(0, 1fr\) auto/);
  assert.match(css, /\.panel-top\.has-summary > \.panel-actions \{ grid-column: 3/);
  assert.doesNotMatch(css, /\.panel-summary \{[^}]*margin-left/);
});
