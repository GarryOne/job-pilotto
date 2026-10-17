// Employers → Add from a page: the dialog's call reaches the main process, the button is in ⌘K, and the scout task passes the pasted file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('Add from a page is wired from the window to the scout', () => {
  assert.match(read('../preload.cjs'), /employersFromPage: call\('employersFromPage'\)/);
  assert.match(read('../lib/employers-handlers.js'), /ipcMain\.handle\('employersFromPage'/);
  assert.match(read('../main.js'), /scoutFromPage: file => pipeline\.scout\(storage, log, 'you', null, \{paste: file\}\)/);
  assert.match(read('../renderer/pages/employers-paste.js'), /window\.pilot\.employersFromPage\(/);
  assert.match(read('../renderer/pages/employers.js'), /addPasteButton\(\)/);
});

test('the ⌘K palette offers Add from a page', () => {
  assert.match(read('../renderer/pages/nav.js'), /button\('employers', 'emp-paste',/);
  assert.match(read('../renderer/pages/employers-paste.js'), /PASTE_ID = 'emp-paste'/);
});

test('the scout task adds --paste-file only for a pasted page', async () => {
  const tasks = read('../lib/pipeline-tasks.js');
  assert.match(tasks, /\.\.\.\(paste \? \['--paste-file', paste\] : \[\]\)/);
});
