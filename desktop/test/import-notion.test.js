// An import whose Profile lives in a Notion workspace it brings no key for says, after the restart, to connect that same workspace (7 Oct 2026: a new
// workspace was connected after an import; the Profile was the blank template and every job scored 2-5).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {notionLeftBehind} from '../lib/reset.js';

const folder = files => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-import-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
};
const settings = JSON.stringify({setupDone: true, notionIds: {NOTION_PROFILE_PAGE_ID: '0d462be8fd8682fa9d2d01a775475db6'}});

test('a Profile page named, no Notion key, no local Profile: the app must say which workspace to connect', () => {
  assert.equal(notionLeftBehind(folder({'settings.json': settings})), true);
});
test('a Notion key came with it, or the Profile is on this Mac, or no Notion at all: nothing to say', () => {
  assert.equal(notionLeftBehind(folder({'settings.json': settings, 'keys.json': JSON.stringify({NOTION_TOKEN: 'ntn_x'})})), false);
  assert.equal(notionLeftBehind(folder({'settings.json': settings, 'profile.md': '# Hard constraints\nHome base | Geneva'})), false);
  assert.equal(notionLeftBehind(folder({'settings.json': JSON.stringify({setupDone: true})})), false);
});
test('the restart says it with a click to Connections', () => {
  const data = fs.readFileSync(new URL('../renderer/pages/data.js', import.meta.url), 'utf8');
  assert.match(data, /done\.notionElsewhere\) toastMessage\(\{title: 'Connect the same Notion workspace'[\s\S]+?target: \{view: 'settings', section: 'connections'\}/);
});

test('the Notion dialog warns while the import note is there, and connecting clears it', () => {
  const dialog = fs.readFileSync(new URL('../renderer/pages/notion-connect.js', import.meta.url), 'utf8');
  assert.match(dialog, /show\(\$\('notion-connect-import'\), !!shared\.state\?\.settings\?\.importedNotion\)/);
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="alert tone-warn" id="notion-connect-import" hidden>[\s\S]+?Pick the workspace your backup used/);
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(resetDone\?\.notionElsewhere\) storage\.saveSettings\(\{importedNotion:/);
  assert.match(main, /if \(storage\.settings\(\)\.importedNotion\) storage\.saveSettings\(\{importedNotion: null\}\);/);
});
