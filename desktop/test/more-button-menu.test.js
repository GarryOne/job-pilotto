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

// 6 Oct 2026 (#307, #308): `addEventListener('scroll', closeMenu)` handed the Event to closeMenu as `within`; `within.contains` threw before the menu hid, so an
// open ⋯ menu stayed on screen while the page scrolled away from its button. A listener calls closeMenu itself, never passes it.
test('no event listener passes closeMenu itself (the Event would be read as `within`)', () => {
  const files = [new URL('../renderer/components.js', import.meta.url)];
  const dir = new URL('../renderer/pages/', import.meta.url);
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) files.push(new URL(file, dir));
  for (const file of files)
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /addEventListener\([^,]+,\s*closeMenu\b/, `${file.pathname}: wrap it, () => closeMenu()`);
});

// 7 Oct 2026 (Windows focusdismiss suite): scroll events arrive a frame late, so the scroll that brought a ⋯ button into view before the click shut the menu the
// click had just opened. A scroll closes the menu only when it moved the button, or the button left the page (a redraw replaced it).
test('a scroll closes the ⋯ menu only when its button moved or is gone', () => {
  const source = fs.readFileSync(new URL('../renderer/components.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function scrollCloses'), source.indexOf("document.addEventListener('scroll'"));
  const scrollCloses = new Function(`${body.replace('export ', '')}; return scrollCloses;`)();
  const button = (top, left = 900, isConnected = true) => ({isConnected, getBoundingClientRect: () => ({top, left})});
  assert.equal(scrollCloses(button(300), {top: 300, left: 900}), false);   // a late event from a scroll before the click: the menu stays
  assert.equal(scrollCloses(button(300.5), {top: 300, left: 900}), false); // sub-pixel
  assert.equal(scrollCloses(button(240), {top: 300, left: 900}), true);    // the page really scrolled: the menu would float away from its button
  assert.equal(scrollCloses(button(300, 900, false), {top: 300, left: 900}), true);   // a redraw replaced the button
  assert.equal(scrollCloses(null, null), true);
  assert.match(source, /addEventListener\('scroll', \(\) => \{ if \(!menu\.hidden && scrollCloses\(menuAnchor, menuAt\)\) closeMenu\(\); \}, true\)/);
  assert.match(source, /menuAt = \{top: box\.top, left: box\.left\};/);
});
