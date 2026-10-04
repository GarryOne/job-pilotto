// The sidebar spans the whole window height: when the window is short its last button (theme) must scroll, not be cut off.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');

test('the sidebar scrolls when the window is too short for it', () => {
  const rules = [...css.matchAll(/(?:^|\n)\.sidebar\s*\{([^}]*)\}/g)].map(m => m[1]).join(' ');
  assert.match(rules, /overflow-y:\s*auto/);
  assert.match(rules, /min-height:\s*0/);
});

test('the sidebar shows no scrollbar of its own, and never scrolls sideways', () => {
  const rules = [...css.matchAll(/(?:^|\n)\.sidebar\s*\{([^}]*)\}/g)].map(m => m[1]).join(' ');
  assert.match(rules, /overflow-x:\s*hidden/);
  assert.match(rules, /scrollbar-width:\s*none/);
  assert.match(css, /\.sidebar::-webkit-scrollbar\s*\{\s*display:\s*none/);
});
