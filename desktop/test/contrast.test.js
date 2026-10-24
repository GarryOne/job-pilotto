// Contrast guard (design system, owner 17 Oct 2026: "proper coloring/background contrasts"): every text/background and control-edge pair the
// screens use, read from renderer/tokens.css in both themes, must meet WCAG AA (text 4.5:1, a field's edge 3:1). The page that shows them:
// docs/rules/desktop-ui.md "Design system". A new token pair a screen relies on goes in PAIRS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const media = css.indexOf('@media (prefers-color-scheme: dark)');
const declared = text => Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
const LIGHT = declared(css.slice(0, media)), DARK = {...LIGHT, ...declared(css.slice(media))};

export function resolve(tokens, name, seen = new Set()) {
  const value = tokens[name];
  if (!value || seen.has(name)) throw new Error(`${name} is not a colour token`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolve(tokens, ref[1], new Set([...seen, name]));
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} = ${value}: only #rrggbb or var(--…) can be measured`);
  return value;
}
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [what, foreground, background, minimum]
export const PAIRS = [
  ['text', '--ink', '--surface', 4.5], ['secondary text', '--ink-2', '--surface', 4.5], ['hint', '--muted', '--surface', 4.5], ['field label', '--label', '--surface', 4.5],
  ['hint on a quiet surface', '--muted', '--surface-2', 4.5], ['hint on the page', '--muted', '--bg', 4.5], ['text in a field', '--ink', '--field', 4.5],
  ['a field\'s edge on its card', '--field-line', '--surface', 3], ['a field\'s edge on the field', '--field-line', '--field', 3],
  ['primary button text (amber fill)', '--on-signal', '--signal-solid', 4.5], ['selected edge on its card', '--signal-edge', '--surface', 3], ['selected edge on the page', '--signal-edge', '--bg', 3], ['link text on the page', '--signal', '--bg', 4.5], ['link text on a quiet surface', '--signal', '--surface-2', 4.5], ['link text on the soft tint (selected card)', '--signal', '--signal-soft', 4.5], ['selected edge on the soft tint', '--signal-edge', '--signal-soft', 3], ['keyboard focus ring on the card', '--signal-edge', '--surface', 3], ['keyboard focus ring on the field', '--signal-edge', '--field', 3], ['disabled primary text', '--muted', '--surface-2', 4.5], ['body text on the soft tint', '--ink', '--signal-soft', 4.5], ['warning text beside a selected card', '--warn', '--warn-soft', 4.5], ['link text', '--signal', '--surface', 4.5], ['accent text on soft', '--signal-ink', '--signal-soft', 4.5],
  ['good pill', '--good', '--good-soft', 4.5], ['warn pill', '--warn', '--warn-soft', 4.5], ['bad pill', '--bad', '--bad-soft', 4.5], ['info pill', '--info', '--info-soft', 4.5],
];

test('every text and field-edge token pair meets WCAG AA in light and dark', () => {
  const failing = [];
  for (const [theme, tokens] of [['light', LIGHT], ['dark', DARK]]) {
    for (const [what, fg, bg, min] of PAIRS) {
      const measured = ratio(resolve(tokens, fg), resolve(tokens, bg));
      if (measured < min) failing.push(`${theme}: ${what} (${fg} on ${bg}) is ${measured.toFixed(2)}:1, needs ${min}:1`);
    }
  }
  assert.deepEqual(failing, [], `\n${failing.join('\n')}\nChange the token in renderer/tokens.css (both themes are measured).`);
});

test('the measure is WCAG\'s: black on white is 21:1, a mid grey ~4.5:1', () => {
  assert.equal(Math.round(ratio('#000000', '#ffffff')), 21);
  assert.ok(Math.abs(ratio('#767676', '#ffffff') - 4.54) < 0.01);
});
