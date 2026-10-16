// The reset card exports first and keeps no backup folder (owner, 16 Oct 2026): the card, the handler and the e2e step agree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const here = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the reset card is two steps: save a copy, then reset; Reset waits for step 1 to be done or skipped', () => {
  const html = here('../renderer/index.html'), page = here('../renderer/pages/data.js');
  assert.ok(!/reset-backup|Keep a backup/.test(html + page), 'no backup folder option');
  assert.match(html, /1 · Save a copy \(recommended\)/);
  assert.match(html, /2 · Reset/);
  assert.match(html, /id="reset-export"/);
  assert.match(html, /id="reset-skip-export"/);
  assert.match(html, /id="reset-export-accounts"/);
  assert.match(html, /id="reset-confirm"[^>]*placeholder="RESET"[^>]*\bdisabled\b/, 'RESET cannot be typed before step 1');
  assert.match(page, /exportProfile\(\{keys: false, accounts: \$\('reset-export-accounts'\)\.checked\}\)/, 'the same export as Settings → Your data');
  assert.match(page, /resetProfile\(\)/, 'the handler takes no backup choice');
});

test('the card lists what is removed, kept and reconnected, each once, and says once that importing the file brings everything back', () => {
  const html = here('../renderer/index.html');
  const card = html.slice(html.indexOf('id="setting-reset"'), html.indexOf('data-settings-page="credentials"'));
  for (const heading of ['Removed from this Mac', 'Kept', 'Reconnect after']) assert.equal(card.split(heading).length - 1, 1, heading);
  assert.equal(card.split('job-site accounts').length - 1, 2, 'this profile\'s accounts: once removed, once in the export choice');
  assert.equal((card.match(/Importing the saved file brings everything back/g) || []).length, 1);
  assert.match(card, /Your Notion and GitHub are not touched/);
});

test('the reset dialog says the accounts go and how they come back', () => {
  const handlers = here('../lib/system-handlers.js');
  assert.match(handlers, /job-site accounts on this computer are deleted/);
  assert.match(handlers, /import the export you saved first \(the accounts only if you ticked them\)/);
  assert.ok(!/backup/.test(handlers.slice(handlers.indexOf("handleImportant('resetProfile'"), handlers.indexOf("ipcMain.handle('lastReset'"))), 'the reset handler never mentions a backup');
});
