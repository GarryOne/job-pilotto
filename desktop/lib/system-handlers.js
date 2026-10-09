// The system IPC (moved out of main.js, 8 Oct 2026): the microphone and screen permissions, relaunching the app, resetting the profile, backups
// (now, folder, status) and exporting or importing the whole profile. main.js passes in the services they share. Guards: the reset, backup and
// import tests in desktop/test.
import * as backup from './backup.js';
import * as contactDetails from './contact.js';
import * as notion from './notion.js';   // Notion-only: archives the Notion workspace on a reset with a fresh workspace
import * as notionGate from './notion-gate.js';
import * as reset from './reset.js';
import fs from 'node:fs';
import path from 'node:path';
import {SECRET_NAMES} from './storage.js';
import {log as appLog} from './log.js';

export function registerSystemHandlers(ctx) {
  const {DEMO, about, app, backupNow, dialog, handleImportant, ipcMain, mediaAccess, getResetDone, restartApp, shell, storage, systemPreferences, getWindow} = ctx;
  let resetTold = false;   // the window is told once about a reset or import that was applied at start
  // macOS privacy: the recorder needs the microphone, and Screen & System Audio Recording for the call's audio.
  // In development (npm start) macOS may list the terminal that started the app instead of Electron.
  ipcMain.handle('mediaAccess', () => (DEMO ? {microphone: 'granted', screen: 'granted', dev: false} : {microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: mediaAccess('screen'), dev: !app.isPackaged}));
  ipcMain.handle('openPrivacy', (_, kind) => shell.openExternal(process.platform === 'win32' ? 'ms-settings:privacy-microphone'
    : `x-apple.systempreferences:com.apple.preference.security?Privacy_${kind === 'screen' ? 'ScreenCapture' : 'Microphone'}`));
  ipcMain.handle('relaunch', () => restartApp('asked by the window (permission or update toast)'));
  // Danger zone: a last native confirmation, then restart; the folder goes at the next start (lib/reset.js).
  // freshNotion: the Notion workspace is archived first (its page renamed, nothing deleted), so the setup
  // builds a new one; if Notion refuses, nothing is reset.
  handleImportant('resetProfile', 'Resetting this computer', async (_, {backup = true, freshNotion = false} = {}) => {
    const answer = dialog.showMessageBoxSync(getWindow(), {type: 'warning', buttons: ['Cancel', 'Reset and restart'], defaultId: 0, cancelId: 0,
      message: freshNotion ? 'Reset Job Pilotto and start a fresh Notion workspace?' : 'Reset Job Pilotto on this computer?',
      detail: `Your keys, CV, tailored CVs, recordings, interview drafts, job list and settings on this computer ${backup
        ? 'are moved to a backup folder' : 'are deleted for good'}, and Job Pilotto restarts at the setup. ${freshNotion
        ? 'Your Job Pilotto page in Notion is renamed "… (archived)" and kept as it is; the setup then builds a new workspace in a new empty page.'
        : 'Your Notion workspace, Gmail sign-in and GitHub repo are not changed.'}`});
    if (answer !== 1) return {ok: false};
    let archived = null;
    if (freshNotion && notionGate.notionInUse(storage)) {   // a Notion that isn't the store holds none of this data: left alone
      const when = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}).replace('Sept', 'Sep');
      try { archived = await notion.archiveWorkspace(storage.secret('NOTION_TOKEN'), storage.settings().notionIds || {}, when); }
      catch (error) { return {ok: false, error: `Notion: ${error.message}. Nothing was reset.`}; }
    }
    reset.request(storage.dir, {backup, archived});
    restartApp('reset');
    return {ok: true};
  });
  // Told once per app start: a window reload (⌘R) asks again, and must not re-show "Data imported ✓" for an import done long ago.
  ipcMain.handle('lastReset', () => { const done = resetTold ? null : getResetDone(); resetTold = true; return done; });
  // What lives only on this Mac: the weekly automatic backup (lib/backup.js), or now.
  ipcMain.handle('backupNow', () => backupNow());
  ipcMain.handle('showBackups', () => { fs.mkdirSync(backup.folder(), {recursive: true}); return shell.openPath(backup.folder()); });
  ipcMain.handle('backupStatus', () => ({at: storage.settings().lastBackupAt || null, file: storage.settings().lastBackupFile || null,
    folder: backup.folder()}));
  // Export: one file with this computer's Job Pilotto data (keys only when asked: they're in plain text there).
  // notion: also a read-only copy of the whole Notion workspace (notion.json), to keep or move elsewhere.
  handleImportant('exportProfile', 'Exporting your data', async (_, {keys = false} = {}) => {
    // Whose data and when: the name from the Profile's contact details (3 s at most: never hold the dialog on Notion), the first role searched for.
    const contact = await Promise.race([contactDetails.read(storage).catch(() => ({})), new Promise(done => setTimeout(() => done({}), 3000))]);
    const role = (() => { try { return JSON.parse(storage.readText('config/search.json') || '{}').jobs_board_search_queries?.[0] || ''; } catch { return ''; } })();
    const name = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    const picked = await dialog.showSaveDialog(getWindow(), {title: 'Export your Job Pilotto data',
      defaultPath: path.join(app.getPath('documents'), reset.exportName({name, role})), filters: [{name: 'Job Pilotto export', extensions: ['gz']}]});
    if (picked.canceled || !picked.filePath) return {ok: false};
    const secrets = keys ? Object.fromEntries(SECRET_NAMES.map(name => [name, storage.secret(name)]).filter(([, value]) => value)) : null;
    // This Mac's data only: Notion data stays in Notion, with Notion's own history, Duplicate, Export and Move (owner, 8 Oct 2026).
    try {
      reset.exportTo(storage.dir, picked.filePath, {keys: secrets, version: about.label});
      appLog('data', 'exported', {keys: !!secrets});
      return {ok: true, file: picked.filePath};
    } catch (error) {
      appLog('data', `export failed: ${error.message}`);
      return {ok: false, error: error.message};
    }
  });
  // Import: the file replaces this computer's data (which is kept as a backup), at a restart.
  ipcMain.handle('importProfile', async () => {
    const picked = await dialog.showOpenDialog(getWindow(), {title: 'Import Job Pilotto data', properties: ['openFile'],
      filters: [{name: 'Job Pilotto export', extensions: ['gz', 'tgz']}]});
    if (picked.canceled || !picked.filePaths[0]) return {ok: false};
    const answer = dialog.showMessageBoxSync(getWindow(), {type: 'warning', buttons: ['Cancel', 'Import and restart'], defaultId: 0, cancelId: 0,
      message: 'Replace this computer\'s Job Pilotto data with the export?',
      detail: 'Your current data here is moved to a backup folder first, then Job Pilotto restarts with the imported data. Your Notion workspace is not changed.'});
    if (answer !== 1) return {ok: false};
    try { reset.stageImport(storage.dir, picked.filePaths[0]); } catch (error) { return {ok: false, error: error.message}; }
    restartApp('import');
    return {ok: true};
  });
}
