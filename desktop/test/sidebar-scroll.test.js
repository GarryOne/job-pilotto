// The menu at the smallest window height (owner, 4 Oct 2026): the bottom buttons stay in view, the list between brand and bottom scrolls with a visible scrollbar and takes the wheel itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');

test('the menu list is its own scroll area, between the brand and the bottom buttons', () => {
  const side = html.slice(html.indexOf('<nav class="sidebar">'), html.indexOf('</nav>'));
  const scroll = side.indexOf('class="nav-scroll"'), bottom = side.indexOf('class="sidebar-bottom"');
  assert.ok(scroll > side.indexOf('class="brand"'), 'after the brand');
  assert.ok(side.indexOf('data-view="focus"') > scroll && side.indexOf('data-view="strategy"') > scroll, 'the nav buttons are inside the list');
  assert.ok(side.indexOf('id="notion-links"') > scroll && side.indexOf('id="notion-links"') < bottom);
  assert.ok(bottom > scroll, 'the bottom buttons come after the list, outside it');
  assert.equal((side.slice(scroll, bottom).match(/<div/g) || []).length - (side.slice(scroll, bottom).match(/<\/div>/g) || []).length, 0, 'the list closes before the bottom buttons');
});

test('the list scrolls with a visible scrollbar and takes the wheel (the column around it is a drag area)', () => {
  const rule = css.split('\n').filter(line => /^\.sidebar \.nav-scroll \{|^  scrollbar-width: thin/.test(line)).join(' ');
  assert.match(rule, /overflow-y: auto/);
  assert.match(rule, /-webkit-app-region: no-drag/);
  assert.match(rule, /scrollbar-width: thin/);
  assert.doesNotMatch(rule, /scrollbar-width: none/);
  assert.match(css, /\.sidebar \{ overflow: hidden; \}/);
});
