// The "Encrypted" popover sits right beside its row (centred on it, a small gap, an arrow), and a mouse close never paints a focus ring on the row.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const store = fs.readFileSync(path.join(root, 'pages', 'store-parts.js'), 'utf8');
const rule = selector => css.match(new RegExp(`^${selector.replace(/[.[\]()]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';

test('the privacy popover is anchored to its row: token gap, vertically centred, an arrow, no fixed 40px offset', () => {
  const pop = rule('.privacy-pop');
  assert.match(pop, /top: 50%/);
  assert.match(pop, /translateY\(calc\(-50% \+ var\(--pop-shift\)\)\)/);
  assert.match(pop, /left: calc\(100% \+ var\(--sp-\d\)( \+ var\(--sp-\d\))?\)/, 'a spacing token from the rail edge');
  assert.doesNotMatch(pop, /bottom:|\d+px\)/, 'no hand-written pixel offset');
  assert.match(rule('.privacy-pop::before'), /rotate\(45deg\)/, 'the arrow');
});

test('no popover or tooltip card in the sheet sits a fixed px gap past its anchor', () => {
  const offenders = [...css.matchAll(/^([^{}\n]*(?:-pop|tip)[^{}\n]*) \{([^}]*)\}/gm)].filter(m => /left: calc\(100% \+ \d+px\)/.test(m[2]));
  assert.deepEqual(offenders.map(m => m[1]), []);
});

test('closing the popover with the mouse does not draw a focus ring; Esc and the keyboard do', () => {
  assert.match(store, /focus\(\{focusVisible: e\.detail === 0\}\)/);
  assert.match(store, /Escape[\s\S]*focus\(\{focusVisible: true\}\)/);
  assert.match(rule('.steps-privacy:focus-visible'), /outline: none/);
  assert.match(rule('.steps-privacy:focus-visible'), /background: var\(--rail-hover\)/);
});
