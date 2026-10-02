// The DEV tag's brand rule must not undo the icon rail's hidden brand name (sidebar spill, issue #49).
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');

test('in the icon rail the DEV brand shows neither name nor tag', () => {
  const devRule = css.indexOf('.brand:has(.dev-tag) {');
  const rail = css.indexOf('@media (max-width: 1179px) {\n  .sidebar .brand:has(.dev-tag)', devRule);
  assert.ok(devRule > 0 && rail > devRule, 'a rail override must follow the DEV rule');
  const block = css.slice(rail, css.indexOf('\n}', rail));
  assert.match(block, /\.sidebar \.brand:has\(\.dev-tag\)\s*\{[^}]*font-size:\s*0/);
  assert.match(block, /\.sidebar \.dev-tag\s*\{[^}]*display:\s*none/);
});
