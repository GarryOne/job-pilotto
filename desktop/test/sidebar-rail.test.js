// The menu as an icon rail: automatic in a narrow window, or collapsed with the button (renderer/sidebar-rail.js).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {NARROW, railed, toggleShown} from '../renderer/sidebar-rail.js';

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');

test('a narrow window is always a rail; a wide one follows the choice; the button only shows where there is room', () => {
  assert.equal(NARROW, 1180);
  assert.deepEqual([1024, 1179].map(width => railed(width, false)), [true, true]);
  assert.deepEqual([1180, 1600].map(width => railed(width, false)), [false, false]);
  assert.deepEqual([1180, 1600].map(width => railed(width, true)), [true, true]);
  assert.deepEqual([1179, 1180].map(toggleShown), [false, true]);
});

test('the rail layout is one set of rules on .app.rail, not a second copy under a media query', () => {
  const css = read('style.css');
  assert.doesNotMatch(css, /@media \(max-width: 1179px\)\s*\{[^}]*\.(sidebar|nav|palette-hint|allowance-chip|nav-update|nav-sessions)\b/);
  for (const rule of ['.app.rail { grid-template-columns: 72px', '.app.rail .sidebar .brand', '.app.rail .nav {', '.app.rail .dev-tag { display: none; }']) {
    assert.ok(css.includes(rule), rule);
  }
});

test('the button is in the menu, and the app starts the module', () => {
  assert.match(read('index.html'), /id="rail-toggle"[^>]*>.*data-icon="collapse"/);
  assert.match(read('app.js'), /import \{init as sidebarRail\} from '\.\/sidebar-rail\.js';[\s\S]*sidebarRail\(\);/);
});

test('the Notion pages stay out of the menu, rail or not: they are in the command palette', () => {
  const css = read('style.css');
  assert.match(css, /^\.notion-links \{ display: none; \}$/m);
  assert.doesNotMatch(css, /\.app\.rail \.notion-link/);
});

test('the rail keeps every item of the menu, text removed: search and the plan bar stay as icons', () => {
  const css = read('style.css'), html = read('index.html');
  assert.match(html, /id="palette-hint"[^>]*><i data-icon="search">/);
  assert.match(css, /\.app\.rail \.palette-hint \{ display: flex;/);
  assert.match(css, /\.app\.rail \.allowance-chip-plan, \.app\.rail \.allowance-chip-text \{ display: none; \}/);
  assert.doesNotMatch(css, /\.app\.rail \.(palette-hint|allowance-chip) \{ display: none; \}/);
});
