// Your details never shows empty boxes for "not read yet" (owner, 18 Oct 2026): the marked boxes are a skeleton until the read answers; the kept copy fills them at once.
// A class test: every editable contact field of the page sits in a marked box or in the links form that stays hidden until Edit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {reading} = await import('../renderer/contact-reading.js');
const {el} = await import('../renderer/components.js');
const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');

test('before the read answers, the marked boxes are hidden behind a skeleton; after, the boxes are back and the skeleton gone', () => {
  const root = el('div'), grid = el('div'), tiles = el('div');
  grid.dataset.readsContact = '1'; tiles.dataset.readsContact = '1';
  grid.append(el('input')); root.append(grid, tiles);
  reading(true, root);
  assert.equal(grid.hidden, true);
  assert.equal(tiles.hidden, true);
  assert.equal(root.children.filter(child => /contact-reading/.test(child.className)).length, 2, 'one skeleton per box');
  reading(true, root);
  assert.equal(root.children.filter(child => /contact-reading/.test(child.className)).length, 2, 'asking twice adds none');
  reading(false, root);
  assert.equal(grid.hidden, false);
  assert.equal(root.children.filter(child => /contact-reading/.test(child.className)).length, 0);
});

// Fields that are empty by design (optional, never "the data"), with why.
const EMPTY_BY_DESIGN = {'letter-feedback': 'an optional "ask for a change" line'};
const TABS = ['cv', 'details', 'experience', 'answers', 'letter'];

test('class: on every Profile tab, no editable text field is drawn empty before its read: it sits in a skeleton box, a hidden form, or is empty by design', () => {
  const found = Object.fromEntries(TABS.map(tab => [tab, []]));
  let tab = null, depth = 0, marked = -1;   // marked: the depth a skeleton box or hidden form opened at
  for (const line of html.split('\n')) {
    if (/class="setting panel"/.test(line)) tab = line.match(/data-profile-panel="(\w+)"/)?.[1] || null;
    if (/<div class="save-bar"/.test(line)) tab = null;
    if (marked < 0 && /data-reads-(contact|letter)|id="links-form"[^>]*hidden/.test(line)) marked = depth;
    const field = line.match(/<(input|textarea)\b[^>]*>/);
    if (tab && field && !/type="(checkbox|radio|hidden|button|file)"/.test(field[0])) {
      const id = field[0].match(/\bid="([^"]+)"/)?.[1] || field[0].match(/data-contact="([^"]+)"/)?.[1] || '?';
      if (/data-reads-(contact|letter)/.test(field[0]) || marked >= 0 || id in EMPTY_BY_DESIGN) found[tab]?.push(id);
      else assert.fail(`${tab}: ${id} is an editable text field that shows empty while the tab is still reading; mark its box data-reads-contact/-letter (renderer/contact-reading.js) or list it as empty by design`);
    }
    depth += (line.match(/<div\b/g) || []).length - (line.match(/<\/div>/g) || []).length;
    if (marked >= 0 && depth <= marked && !/data-reads-(contact|letter)|id="links-form"/.test(line)) marked = -1;
  }
  assert.ok(found.details.length >= 10, 'the Your details fields were found');
  assert.ok(found.letter.includes('letter-text'), 'the letter box is a skeleton while it reads');
});

test('the cover letter shows a skeleton in place of its empty box until the read answers, like the contact form', () => {
  const root = el('div'), box = el('textarea');
  box.dataset.readsLetter = '1'; root.append(box);
  reading(true, root, 'letter');
  assert.equal(box.hidden, true);
  assert.equal(root.children.filter(child => /contact-reading/.test(child.className)).length, 1);
  reading(false, root, 'letter');
  assert.equal(box.hidden, false);
  assert.match(fs.readFileSync(new URL('../renderer/pages/base-letter.js', import.meta.url), 'utf8'), /swr\('cover-letter'[\s\S]*loading: \(\) => \{ reading\(true, document, 'letter'\)/);
});

test('the contact read keeps its answer, so a second open fills the boxes before the read returns', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');
  const show = source.slice(source.indexOf('export function showContact'));
  assert.match(show, /swr\('contact'/);
  assert.match(show, /loading: \(\) => reading\(true\)/);
  assert.match(show, /reading\(false\);[\s\S]*input\.value = /);
});
