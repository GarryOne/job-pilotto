// Work that quitting must not cut off half-way (lib/critical.js): the register, the quit dialog's words, and that every handler doing such work is
// registered (6 Oct 2026: the app closed during an export without asking).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as critical from '../lib/critical.js';
import * as quitDialog from '../lib/quit-dialog.js';

test('work is listed while it runs, once a label, and whenDone waits for the last one', async () => {
  let finish;
  const first = critical.during('Exporting your data', () => new Promise(resolve => { finish = resolve; }));
  const second = critical.during('Exporting your data', async () => 'two');
  assert.deepEqual(critical.labels(), ['Exporting your data']);
  assert.equal(await second, 'two');
  let done = false;
  const waiting = critical.whenDone().then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(done, false, 'still exporting');
  finish('one');
  assert.equal(await first, 'one');
  await waiting;
  assert.deepEqual(critical.labels(), []);
  await assert.rejects(critical.during('Saving your CV', async () => { throw new Error('Notion refused'); }), /Notion refused/);
  assert.deepEqual(critical.labels(), [], 'a failure leaves the list too');
});

test('the quit dialog names the work and offers to wait for it', () => {
  const alone = quitDialog.working({important: ['Exporting your data'], taskName: () => '', label: () => ''});
  assert.match(alone.detail, /Exporting your data: quitting now can leave it half done/);
  assert.match(alone.detail, /closes by itself once it finishes/);
  assert.doesNotMatch(alone.detail, /jobs you started run again/);
  assert.deepEqual(alone.buttons, ['Quit when done', 'Quit now', 'Cancel']);
  const mixed = quitDialog.working({important: ['Connecting Notion'], busy: {kind: 'search'}, taskName: () => 'Jobs check', label: () => ''});
  assert.match(mixed.detail, /Connecting Notion/);
  assert.match(mixed.detail, /Jobs check is running/);
});

test('every handler that archives, copies or moves data, or sets up a service, is registered as important', () => {
  // The class: an IPC handler whose body does one of these is a handleImportant(…), never a bare ipcMain.handle.
  const UNRECOVERABLE = /archiveWorkspace|dumpWorkspace|migrate\.run|reset\.(request|exportTo)|telegramCloud\.turn|github\.(connect|setup|enable|turnOff|create)|turnCloudOff\(|notion\.(build|connect)\w*\(/;
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const blocks = main.split(/\n(?=\s*(?:ipcMain\.handle|handleImportant)\()/).slice(1);
  // A handler ends at its first "  });" (a one-line one on its own line): helpers written after it are not part of it.
  const own = block => { const lines = block.split('\n'); const end = /\}\);\s*$/.test(lines[0]) ? 0 : lines.findIndex(line => /^ {2}\}\);/.test(line)); return lines.slice(0, end + 1).join('\n'); };
  const bare = blocks.filter(block => /^\s*ipcMain\.handle\(/.test(block)).map(own)
    .filter(block => UNRECOVERABLE.test(block)).map(block => block.match(/ipcMain\.handle\('(\w+)'/)?.[1]);
  assert.deepEqual(bare, []);
  assert.ok(blocks.some(block => /^\s*handleImportant\('exportProfile'/.test(block)));
});
