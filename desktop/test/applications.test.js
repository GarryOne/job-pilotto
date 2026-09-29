import test from 'node:test';
import assert from 'node:assert/strict';
import {offerMove, shouldOffer} from '../lib/applications.js';

test('asks only for packaged Mac builds outside Applications', () => {
  assert.equal(shouldOffer({platform: 'darwin', packaged: true, inApplications: false}), true);
  assert.equal(shouldOffer({platform: 'darwin', packaged: true, inApplications: true}), false);
  assert.equal(shouldOffer({platform: 'darwin', packaged: false, inApplications: false}), false);
  assert.equal(shouldOffer({platform: 'win32', packaged: true, inApplications: false}), false);
});

function fakes(answers, {inApplications = false, moveThrows = false} = {}) {
  const asked = [];
  const moved = [];
  const app = {isPackaged: true, isInApplicationsFolder: () => inApplications,
    moveToApplicationsFolder: options => { if (moveThrows) throw new Error('read-only'); moved.push(options); return true; }};
  const dialog = {showMessageBoxSync: box => { asked.push(box.message); return answers.shift() ?? 1; }};
  return {app, dialog, asked, moved};
}

test('moves when the user agrees, replaces an older copy only after asking', () => {
  const {app, dialog, asked, moved} = fakes([0, 0]);
  assert.equal(offerMove({app, dialog, platform: 'darwin'}), true);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].conflictHandler('exists'), true);
  assert.equal(moved[0].conflictHandler('existsAndRunning'), false);
  assert.deepEqual(asked, ['Move Job Pilotto to Applications?', 'Replace the Job Pilotto in Applications?']);
});

test('"Not now" and already in Applications leave it where it is', () => {
  const declined = fakes([1]);
  assert.equal(offerMove({app: declined.app, dialog: declined.dialog, platform: 'darwin'}), false);
  assert.equal(declined.moved.length, 0);
  const placed = fakes([], {inApplications: true});
  assert.equal(offerMove({app: placed.app, dialog: placed.dialog, platform: 'darwin'}), false);
  assert.deepEqual(placed.asked, []);
});

test('a failed move says how to do it by hand', () => {
  const {app, dialog, asked} = fakes([0], {moveThrows: true});
  assert.equal(offerMove({app, dialog, platform: 'darwin'}), false);
  assert.equal(asked[1], 'Job Pilotto couldn\'t move itself');
});

test('Windows never touches the Mac-only Electron calls', () => {
  const app = {isPackaged: true};  // no isInApplicationsFolder / moveToApplicationsFolder, as on Windows
  const dialog = {showMessageBoxSync: () => assert.fail('asked on Windows')};
  assert.equal(offerMove({app, dialog, platform: 'win32'}), false);
});
