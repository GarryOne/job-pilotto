// The shared page blocks (renderer/page-parts.js, renderer/shared-counts.js; owner, 18 Oct 2026, UI redesign): review list, empty state, summary tiles,
// reference row, one count for every place it shows, and the page header (title + lead, tabs right under it, at most one primary button).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {reviewList, emptyState, summaryTiles, referenceRow} = await import('../renderer/page-parts.js');
const {defineCount, paintCount, countWords} = await import('../renderer/shared-counts.js');
const {el} = await import('../renderer/components.js');
const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const texts = (node, selector) => node.querySelectorAll(selector).map(each => each.textContent);

test('review list: pending first, done folded as "Reviewed · N", one orange button for the whole list (the first pending next step)', () => {
  const pressed = [];
  const list = reviewList([
    {key: 'a', title: 'Kubernetes', why: 'In 4 of 5 top jobs', status: {text: 'Done', tone: 'good'}, done: true},
    {key: 'b', title: 'Terraform', why: 'In 3 of 5 top jobs', source: 'From the CV check', status: {text: 'Needs review', tone: 'warn'},
      actions: [{label: 'Confirm', primary: true, run: item => pressed.push(item.key)}, {label: 'Dismiss', primary: true, run: () => {}}]},
  ]);
  const items = list.querySelectorAll('.review-item');
  assert.deepEqual(items.map(item => item.dataset.key), ['b', 'a'], 'pending first');
  assert.equal(list.querySelector('.review-done summary').textContent, 'Reviewed · 1');
  const buttons = items[0].querySelectorAll('button');
  assert.deepEqual(buttons.map(node => node.className), ['primary small-btn', 'secondary small-btn'], 'a second "primary" is drawn quiet');
  const two = reviewList([{key: 'x', title: 'X', actions: [{label: 'Review', primary: true}]}, {key: 'y', title: 'Y', actions: [{label: 'Review', primary: true}]}]);
  assert.equal(two.querySelectorAll('button.primary').length, 1, 'one orange button per list');
  buttons[0].click();
  assert.deepEqual(pressed, ['b']);
  assert.equal(reviewList([]).textContent, 'Nothing to review.');
  let undone = 0;
  const kept = reviewList([{key: 'c', title: 'C', done: true, status: {text: 'Confirmed', tone: 'good'}, actions: [{label: 'Undo', primary: true, run: () => undone++}],
    detail: el('p', '', 'The fix and where it came from')}]);
  const undo = kept.querySelector('.review-done button');
  assert.equal(undo.className, 'secondary small-btn', 'a done item keeps its action, quiet');
  undo.click();
  assert.equal(undone, 1);
  assert.equal(kept.querySelector('.review-detail summary').textContent, 'View details');
});

test('empty state: neutral "Not created" chip, title, one line, primary then quiet action, a note', () => {
  let drafted = 0;
  const box = emptyState({icon: 'file', title: 'No base letter yet', text: 'One letter for every job.', note: 'Uses about 1 cent of AI.',
    actions: [{label: 'Draft with AI', run: () => drafted++}, {label: 'Write my own'}, {label: 'A third'}]});
  assert.equal(box.querySelector('.ui-pill').textContent, 'Not created');
  assert.match(box.querySelector('.ui-pill').className, /tone-neutral/);
  assert.deepEqual(box.querySelectorAll('button').map(node => [node.className, node.textContent]), [['primary', 'Draft with AI'], ['secondary', 'Write my own']]);
  box.querySelector('button').click();
  assert.equal(drafted, 1);
});

test('summary tiles: label and big value per tile; an empty value says "Not set"', () => {
  const box = summaryTiles([{key: 'salary', icon: 'coins', tone: 'good', label: 'Minimum salary', value: 'CHF 140k'}, {key: 'where', icon: 'pin', label: 'Where', value: ''}]);
  assert.deepEqual(texts(box, '.summary-tile-value'), ['CHF 140k', 'Not set']);
  assert.match(box.querySelectorAll('.summary-tile-value')[1].className, /is-empty/);
  assert.deepEqual(box.querySelectorAll('.summary-tile').map(tile => tile.dataset.key), ['salary', 'where']);
});

test('reference row: where it is kept, its words, one quiet link that opens it', () => {
  let opened = 0;
  const row = referenceRow({text: 'Swiss permit B', open: () => opened++});
  assert.deepEqual(texts(row, 'span'), ['From Your details', 'Swiss permit B']);
  const link = row.querySelector('button');
  assert.equal(link.className, 'link small');
  assert.equal(link.textContent, 'Edit in Your details');
  link.click();
  assert.equal(opened, 1);
});

test('one count paints the banner, the chip and the tab badge alike; 0 hides them unless asked', () => {
  const root = el('div');
  const banner = el('span'), badge = el('span'), chip = el('span');
  Object.assign(banner.dataset, {countOf: 'to-check', countOne: 'detail to check', countMany: 'details to check'});
  badge.dataset.countOf = 'to-check';
  Object.assign(chip.dataset, {countOf: 'to-check', countZero: 'show'});
  root.append(banner, badge, chip);
  let n = 3;
  assert.equal(defineCount('to-check', () => n, root), 3);
  assert.deepEqual([banner.textContent, badge.textContent, chip.textContent], ['3 details to check', '3', '3']);
  n = 0;
  paintCount('to-check', root);
  assert.deepEqual([banner.hidden, badge.hidden, chip.hidden], [true, true, false]);
  assert.equal(countWords(1, 'detail to check', 'details to check'), '1 detail to check');
});

test('class: every page header has its title and lead, at most one primary button, and tabs (when it has them) right under it', () => {
  const html = read('index.html');
  const heads = [...html.matchAll(/<header class="view-head">([\s\S]*?)<\/header>(\s*(?:<!--[\s\S]*?-->\s*)*)(<div class="tabs)?/g)];
  assert.ok(heads.length >= 5, 'the page headers are found');
  for (const [, inner] of heads) {
    const title = (inner.match(/<h1>([^<]*)/) || [])[1] || inner.slice(0, 60);
    assert.ok((inner.match(/class="primary[" ]/g) || []).length <= 1, `${title}: at most one primary button in the page header`);
  }
  const strategy = heads.find(([, inner]) => inner.includes('Search strategy'));
  assert.ok(strategy?.[3], 'Strategy: its tabs come right under the header');
});

test('the blocks are linked and in the gallery (the rules: docs/rules/desktop-ui.md "Page blocks")', () => {
  for (const page of ['index.html', 'gallery.html']) assert.match(read(page), /href="page-parts\.css"/, page);
  for (const part of ['reviewList(', 'emptyState(', 'summaryTiles(', 'referenceRow(']) assert.ok(read('gallery-cards.js').includes(part), part);
});
