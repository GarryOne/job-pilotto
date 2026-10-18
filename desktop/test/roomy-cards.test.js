// Roomy cards (owner, 18 Oct 2026, mockup 03 approved: "Look at the cards with chips how roomier they are"): the shared parts keep their shape, and every
// Strategy card sits in the .roomy-cards container with its header from card-shell.js cardHead, so a new card gets the look without its own CSS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {document} = globalThis;
const {cardHead, readRows, settingBlock} = await import('../renderer/card-shell.js');
const {summaryTiles} = await import('../renderer/page-parts.js');
const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const classes = node => String(node.className).split(/\s+/);
const text = node => node.textContent;

test('the roomy stylesheet loads after style.css (its rules win over the older .review/.card ones), in the app and the gallery', () => {
  for (const page of ['index.html', 'gallery.html']) {
    const links = [...read(page).matchAll(/href="([^"]+\.css)"/g)].map(match => match[1]);
    assert.ok(links.indexOf('roomy-cards.css') > links.indexOf('style.css'), `${page}: roomy-cards.css after style.css`);
  }
});

test('class: every Strategy card is inside .roomy-cards and draws its header with cardHead', () => {
  const html = read('index.html'), live = html.slice(html.indexOf('id="strategy-live"') - 80);
  assert.match(live, /^[\s\S]*?class="review strategy-live roomy-cards" id="strategy-live"/);
  const yours = html.slice(html.indexOf('id="strategy-yours"'), html.indexOf('id="strategy-suggestions"'));
  // Static card heads (the conflict card) have the cardHead shape: tile, then the words.
  for (const head of yours.match(/<div class="card-head[^"]*">[\s\S]*?<\/div><\/div>/g) || []) {
    if (/job-prefs-head/.test(head)) continue;   // replaced by cardHeader at load (job-preferences.js strategyCard)
    assert.match(head, /^<div class="card-head"><span class="ui-tile tone-\w+">.*?<div class="card-words"><h3>/, head);
  }
  assert.match(read('pages/strategy-cards.js'), /return cardHead\(\{glyph, tone, title, lead, badge, action\}\);/);
  assert.match(yours, /class="roomy-pair"/, 'Locations beside Job preferences through the shared pair');
  assert.doesNotMatch(read('strategy-cards.css'), /\.strategy-pair\b/, 'no page-only copy of the pair');
});

test('cardHead: icon tile, title with its status pill, one-line lead, the action last', () => {
  const action = document.createElement('button'), badge = document.createElement('span');
  badge.textContent = 'Unsaved';
  const head = cardHead({glyph: 'pin', tone: 'teal', title: 'Locations', lead: 'Where you want to work.', badge, action});
  assert.deepEqual(head.children.map(child => classes(child)[0] || child.tagName), ['ui-tile', 'card-words', 'BUTTON']);
  assert.ok(classes(head.children[0]).includes('tone-teal'));
  assert.equal(text(head.children[1].children[0]), 'LocationsUnsaved');
  assert.equal(text(head.children[1].children[1]), 'Where you want to work.');
});

test('a list is its heading over its chips, the qualifier joined to the heading (never a lone line under the chips)', () => {
  const chips = document.createElement('div');
  const block = settingBlock('Preferred locations', chips, {qualifier: 'ranked first'});
  assert.ok(classes(block).includes('setting-block'));
  assert.equal(block.children.length, 2);
  assert.equal(text(block.children[0]), 'Preferred locations· ranked first');
  assert.equal(block.children[1], chips);
});

test('readRows with icons: the icon in the label cell, the list marked has-icons; without, unchanged', () => {
  const rows = readRows([{icon: 'clock', label: 'Workload', value: '80 – 100%'}], {lined: true});
  assert.ok(classes(rows).includes('has-icons') && classes(rows).includes('is-lined'));
  assert.equal(rows.children[0].children[0].tagName, 'SVG');
  assert.equal(text(rows.children[0]), 'Workload');
  assert.ok(!classes(readRows([{label: 'Workload', value: 'Any'}])).includes('has-icons'));
});

test('divided tiles: "+N more" and a status badge sit inside the value, never as a line under it', () => {
  const box = summaryTiles([{key: 'roles', icon: 'briefcase', label: 'Target roles', value: 'A · B', more: '+2 more'},
    {key: 'salary', icon: 'coins', label: 'Minimum salary', value: 'CHF 1', badge: {text: 'As written', title: 'Edit to pick its currency'}}], {divided: true});
  assert.ok(classes(box).includes('is-divided'));
  for (const tile of box.children) {
    const words = tile.children[1];
    assert.equal(words.children.length, 2, 'label and value only: nothing under the value');
  }
  assert.equal(text(box.children[0].children[1].children[1]), 'A · B +2 more');
  assert.match(text(box.children[1].children[1].children[1]), /^CHF 1As written$/);
});
