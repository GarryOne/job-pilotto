// The reset card exports first and keeps no backup folder (owner, 16 Oct 2026): the card, the handler and the e2e step agree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const here = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the reset card offers the export, not a backup folder; Reset waits for the export or for the choice to go without', () => {
  const html = here('../renderer/index.html'), page = here('../renderer/pages/data.js');
  assert.ok(!/reset-backup|Keep a backup/.test(html + page), 'no backup folder option');
  assert.match(html, /id="reset-export"[^>]*>Export everything first \(recommended\)/);
  assert.match(html, /id="reset-export-accounts"/);
  assert.match(html, /id="reset-confirm"[^>]*\bdisabled\b/, 'RESET cannot be typed before the export');
  assert.match(page, /exportProfile\(\{keys: false, accounts: \$\('reset-export-accounts'\)\.checked\}\)/, 'the same export as Settings → Your data');
  assert.match(page, /resetProfile\(\)/, 'the handler takes no backup choice');
});

test('the reset dialog says the accounts go and how they come back', () => {
  const handlers = here('../lib/system-handlers.js');
  assert.match(handlers, /job-site accounts on this computer are deleted/);
  assert.match(handlers, /import the export you saved first \(the accounts only if you ticked them\)/);
  assert.ok(!/backup/.test(handlers.slice(handlers.indexOf("handleImportant('resetProfile'"), handlers.indexOf("ipcMain.handle('lastReset'"))), 'the reset handler never mentions a backup');
});
