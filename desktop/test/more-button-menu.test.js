// The ⋯ menu must reset every expanded ⋯ button, not just the first, so a press always toggles aria-expanded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('closeMenu resets all expanded ⋯ buttons', () => {
  const source = fs.readFileSync(new URL('../renderer/components.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function closeMenu'), source.indexOf('export function openMenu'));
  assert.match(body, /querySelectorAll\('\.ui-more\[aria-expanded="true"\]'\)/);
});
