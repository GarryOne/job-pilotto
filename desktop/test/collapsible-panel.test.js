// The collapsible panel: the whole head bar toggles (not only the chevron); CV check uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = f => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');

test('the whole head bar is the toggle, with keyboard and aria', () => {
  const body = read('components.js');
  assert.match(body, /bar\.addEventListener\('click'/);
  assert.match(body, /setAttribute\('role', 'button'\)/);
  assert.match(body, /aria-expanded/);
  assert.match(body, /event\.key !== 'Enter' && event\.key !== ' '/);
});
test('collapsed keeps only the bar', () => {
  assert.match(read('components.css'), /\.panel\.is-collapsed > :not\(\.panel-top\) \{ display: none/);
});
test('every panel that opts in is wired through the shared function', () => {
  assert.match(read('pages/profile.js'), /collapsiblePanel\(\$\('setting-cvcheck'\)\)/);
});
