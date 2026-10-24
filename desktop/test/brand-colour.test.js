// One amber brand guard (owner, 24 Oct 2026): the brand accent is the website's amber, set in renderer/tokens.css and the extension panel's own tokens. Any orange
// (hue 12-32°, saturated) written into a renderer or extension file fails here, so the old orange cannot come back as a one-off value.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['node_modules', 'icons', 'assets', 'vendor']);
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => SKIP.has(entry.name) ? [] : entry.isDirectory() ? files(path.join(dir, entry.name))
    : /\.(css|js|mjs|html)$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
export function isOrange(hex) {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return false;
  const hue = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const lightness = (max + min) / 2, saturation = d / (1 - Math.abs(2 * lightness - 1));
  return ((hue + 360) % 360) >= 12 && ((hue + 360) % 360) <= 32 && saturation > 0.7 && lightness > 0.3 && lightness < 0.7;
}
export function oranges(text) {
  return [...text.matchAll(/#[0-9a-f]{6}\b/gi)].map(match => match[0]).filter(isOrange);
}

test('no orange is hard-coded in the app or the extension: the brand is amber, through tokens', () => {
  const found = [];
  for (const dir of ['desktop/renderer', 'extension']) {
    for (const file of files(path.join(root, dir))) {
      oranges(fs.readFileSync(file, 'utf8')).forEach(hex => found.push(`${path.relative(root, file)}: ${hex}`));
    }
  }
  assert.deepEqual(found, [], `\n${found.join('\n')}\nUse the amber tokens (--signal-solid, --signal, --signal-edge; the panel's --signal) instead.`);
});

test('the guard knows orange from the brand amber and the status colours', () => {
  assert.equal(isOrange('#d9540b'), true);
  assert.equal(isOrange('#e8661b'), true);
  assert.equal(isOrange('#ffb224'), false);
  assert.equal(isOrange('#8a5700'), false);
  assert.equal(isOrange('#b3261e'), false);
});
