// The Recent activity panel and its run survive a reload (⌘R): what pages/activity.js keeps, and pages/startup.js reads back.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';

test('the open panel is kept with its run (or the running task), and a closed one is not brought back (owner, 8 Oct 2026)', async () => {
  const source = fs.readFileSync(new URL('../renderer/pages/activity.js', import.meta.url), 'utf8');
  const panelMemory = new Function(`return ${/export const panelMemory = (.+);/.exec(source)[1]}`)();
  assert.equal(panelMemory(true, 1790622000000), '1790622000000');
  assert.equal(panelMemory(true, null), 'live', 'the running task, not a past run');
  assert.equal(panelMemory(false, 1790622000000), '', 'closed: nothing to bring back');
  const startup = fs.readFileSync(new URL('../renderer/pages/startup.js', import.meta.url), 'utf8');
  assert.match(startup, /remembered\(PANEL_KEY\)[\s\S]{0,200}openActivity\(true\)/, 'start-up opens it again from what was kept');
});
