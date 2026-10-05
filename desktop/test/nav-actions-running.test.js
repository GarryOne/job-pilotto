// The menu's Actions row shows a spinner (not a count) while a task runs, on every screen: it is drawn by renderActionsPage,
// which renderActivity calls whichever page is open. Checked in the source, since the window needs Electron.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

test('Actions has a hidden running spinner in the menu, shown from the running task and named in its tooltip', () => {
  assert.match(read('index.html'), /data-view="actions">[^\n]*<span class="spinner nav-running" id="nav-actions-running"[^>]*hidden><\/span>/);
  const page = read('pages/runs-page.js');
  assert.match(page, /dot\.hidden = !running;/);
  assert.match(page, /dot\.title = running \? `\$\{TASK_TITLE\[kindOf\(running\)\]/);
  assert.ok(page.indexOf("nav-actions-running") < page.indexOf('if (running) {'), 'set before the banner work, so it never depends on the Actions page being open');
});
