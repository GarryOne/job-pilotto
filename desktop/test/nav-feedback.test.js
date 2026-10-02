// "Send feedback" is a button of the menu but not a page: its click must not go through openView(undefined), which hid every page and left a
// blank window behind the thank-you toast (a friend's first feedback, 2 Oct 2026). Checked in the source, since the window needs Electron.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('the menu\'s click handler ignores buttons that have no page (data-view)', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf("document.querySelectorAll('.nav').forEach(nav => {\n    nav.title"));
  assert.ok(handler.indexOf('if (!nav.dataset.view) return;') > 0, 'the guard exists');
  assert.ok(handler.indexOf('if (!nav.dataset.view) return;') < handler.indexOf('openView(nav.dataset.view)'), 'and comes before the page is opened');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button class="nav" id="nav-feedback"[^>]*>/);                       // the button this is about has no data-view
  assert.ok(!/id="nav-feedback"[^>]*data-view/.test(html));
});
