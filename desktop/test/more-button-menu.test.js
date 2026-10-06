// The ⋯ menu must reset every expanded ⋯ button, not just the first, so a press always toggles aria-expanded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('closeMenu resets all expanded ⋯ buttons', () => {
  const source = fs.readFileSync(new URL('../renderer/components.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function closeMenu'), source.indexOf('export function openMenu'));
  assert.match(body, /querySelectorAll\('\.ui-more\[aria-expanded="true"\]'\)/);
});

// 6 Oct 2026: a Jobs list redrawn in the background closed the ⋯ menu open on Focus (the window has one menu). A page that closes it on redraw names itself.
test('a page redraw closes the ⋯ menu only when the menu belongs to that page', () => {
  const source = fs.readFileSync(new URL('../renderer/components.js', import.meta.url), 'utf8');
  assert.match(source, /export function closeMenu\(within = null\) \{\n\s+if \(within && !\(menuAnchor && within\.contains\(menuAnchor\)\)\) return;/);
  assert.match(source, /menuAnchor = anchor;/);
  const dir = new URL('../renderer/pages/', import.meta.url);
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
    for (const [call] of fs.readFileSync(new URL(file, dir), 'utf8').matchAll(/\bcloseMenu\([^)]*\)/g))
      assert.notEqual(call, 'closeMenu()', `${file}: closeMenu() closes a menu open on any page; pass the page's element`);
  }
});
