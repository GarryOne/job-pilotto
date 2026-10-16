// Settings → Profile's texts as cards (renderer/pages/text-cards.js): every text that text-editors.js edits is drawn as cards, with its actions in ⌘K.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../renderer/index.html'), editors = read('../renderer/pages/text-editors.js'), cards = read('../renderer/pages/text-cards.js');

test('each of the three texts is drawn as cards by the one editor, and its panel shows no "as text" lead', () => {
  assert.match(editors, /import \{cardsEditor\} from '\.\/text-cards\.js'/);
  assert.match(editors, /cardsEditor\(name, result\.markdown/);
  for (const name of ['profile', 'answers', 'knowledge']) {
    const panel = html.match(new RegExp(`<div class="setting panel"[^>]*data-text-editor="${name}"[^>]*>[\\s\\S]*?</div>\\s*</div>|<div class="setting panel"[^>]*data-text-editor="${name}"[^>]*>[\\s\\S]*?<div class="text-editor-body"></div>`))?.[0];
    assert.ok(panel, name);
    assert.doesNotMatch(panel, /as text/, name);
  }
});

test('the Profile form shows the rest of the Profile as cards, and its "Edit as text" is the plain editor', () => {
  const form = read('../renderer/pages/profile-form.js');
  assert.match(form, /cardsEditor\('profile', backend\.rest/);
  assert.match(form, /loadTextEditor\('profile', \{plain: true\}\)/);
});

test('every action of the card editor is a button with an id, so the ⌘K sweep of Settings lists it (Save, Edit as text, Add a line)', () => {
  for (const action of ['text-save-', 'text-mode-', 'text-add-']) assert.match(editors, new RegExp(`id: \`${action}\\$\\{name\\}\``), action);
  assert.match(read('../renderer/pages/nav.js'), /section\.querySelectorAll\('button\[id\]'\)/);
});

test('a card is the shared .answer-item, a kind is a shared pill, and nothing is dropped: Remove is the only way a line goes', () => {
  assert.match(cards, /'answer-item text-card'/);
  assert.match(cards, /pill\(row\.kind/);
  assert.match(cards, /Kept as is/);
  assert.equal([...cards.matchAll(/rows\.splice\(at, 1\)/g)].length, 1);
});
