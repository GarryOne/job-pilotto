// "Scored with other places" (owner, 17 Oct 2026: "mark existing scores as based on previous preferences and offer an explicit refresh for active jobs",
// "show the cost only if it's calculated"): the row exists only when the engine counts some, the refresh starts only from the dialog's own button, the dialog
// says the cost is not calculated and that applications are left alone, and the IPC reaches the engine's command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const screen = read('renderer/pages/locations-refresh.js');

test('the refresh starts only from the dialog, never by itself', () => {
  assert.equal((screen.match(/window\.pilot\.refreshLocations\(\)/g) || []).length, 1);
  assert.match(screen, /if \(dialog\.returnValue !== 'go' \|\| busy\) return;/);
  assert.match(screen, /go\.addEventListener\('click', \(\) => confirmRefresh\(count, reload\)\)/);
  assert.match(read('renderer/pages/strategy-suggestions.js'), /if \(otherPlaces\) items\.push\(refreshRow\(otherPlaces, improveRow, drawImprove\)\)/);
});

test('the dialog gives no invented cost and says who is left alone', () => {
  assert.match(screen, /Cost: not calculated/);
  assert.doesNotMatch(screen, /\$\d|~\$/);
  assert.match(screen, /Applied, rejected and archived jobs are left as they are/);
  assert.match(screen, /Based on previous preferences/);
});

test('the IPC reaches the engine command (tests/test_score_locations.py checks the engine has it)', () => {
  assert.match(read('lib/job-actions-handlers.js'), /ipcMain\.handle\('refreshLocations'[\s\S]*?'src\.desktop', 'refresh-locations'/);
  assert.match(read('preload.cjs'), /refreshLocations: call\('refreshLocations'\)/);
});
