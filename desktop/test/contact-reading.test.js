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

test('class: every data-contact field is inside a box marked data-reads-contact, or the links form (hidden until Edit)', () => {
  const lines = html.split('\n');
  let checked = 0;
  // Walk the markup: a marked box opens at its tag and closes when its div closes.
  let depth = 0, markedAt = -1;
  for (const line of lines) {
    const hasField = /data-contact="/.test(line);
    const opens = (line.match(/<div\b/g) || []).length, closes = (line.match(/<\/div>/g) || []).length;
    if (/data-reads-contact/.test(line) && markedAt < 0) markedAt = depth;
    if (/id="links-form"/.test(line)) markedAt = markedAt < 0 ? depth : markedAt;
    if (hasField) { checked++; assert.ok(markedAt >= 0, `an editable contact field outside a skeleton box: ${line.trim().slice(0, 90)}`); }
    depth += opens - closes;
    if (markedAt >= 0 && depth <= markedAt) markedAt = -1;
  }
  assert.ok(checked >= 10, 'the contact fields were found');
});

test('the contact read keeps its answer, so a second open fills the boxes before the read returns', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');
  const show = source.slice(source.indexOf('export function showContact'));
  assert.match(show, /swr\('contact'/);
  assert.match(show, /loading: \(\) => reading\(true\)/);
  assert.match(show, /reading\(false\);[\s\S]*input\.value = /);
});
