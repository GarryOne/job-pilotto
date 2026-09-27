// Job Pilotto desktop app: a local-first cockpit for the job search. Data and keys stay on this Mac.
import {app, BrowserWindow, dialog, ipcMain, safeStorage, shell} from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import * as apply from './lib/apply.js';
import * as notion from './lib/notion.js';
import * as pipeline from './lib/pipeline.js';
import * as server from './lib/server.js';
import * as strategy from './lib/strategy.js';
import {createStorage, safeStorageCrypto} from './lib/storage.js';

const here = path.dirname(new URL(import.meta.url).pathname);
let storage;
let window;

function createWindow() {
  window = new BrowserWindow({
    width: 1180, height: 820, minWidth: 900, minHeight: 640, title: 'Job Pilotto', show: !process.env.JOB_PILOTTO_SMOKE,
    backgroundColor: '#eef3f7',
    webPreferences: {preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false},
  });
  window.loadFile(path.join(here, 'renderer', 'index.html'));
  // Smoke test (JOB_PILOTTO_SMOKE=<png path>): render hidden, save a screenshot, quit.
  if (process.env.JOB_PILOTTO_SMOKE) {
    window.webContents.once('did-finish-load', () => setTimeout(async () => {
      // JOB_PILOTTO_SMOKE_JS: clicks to run first, e.g. to screenshot a later wizard step.
      if (process.env.JOB_PILOTTO_SMOKE_JS) {
        await window.webContents.executeJavaScript(process.env.JOB_PILOTTO_SMOKE_JS);
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      fs.writeFileSync(process.env.JOB_PILOTTO_SMOKE, (await window.webContents.capturePage()).toPNG());
      app.quit();
    }, 1500));
  }
  // Links open in the user's browser, never inside the app.
  window.webContents.setWindowOpenHandler(({url}) => { shell.openExternal(url); return {action: 'deny'}; });
}

const log = line => window?.webContents.send('log', line);

function handlers() {
  ipcMain.handle('state', () => ({
    settings: storage.settings(), secrets: storage.secretsPresent(),
    hasCv: fs.existsSync(storage.path('cv.pdf')), hasProfile: !!storage.readText('profile.md'),
    folder: storage.dir,
    notion: storage.secret('NOTION_TOKEN') ? Object.fromEntries(Object.entries(storage.settings().notionIds || {})
      .map(([env, id]) => [env, notion.pageUrl(id)])) : null,
    templateUrl: notion.TEMPLATE.template_url,
  }));
  // Connect the user's copy of the Job Pilotto template: every database and page found, every column there.
  ipcMain.handle('notionConnect', async (_, token) => {
    try {
      const result = await notion.connect(token.trim());
      if (result.ok) {
        storage.setSecret('NOTION_TOKEN', token.trim());
        storage.saveSettings({notionIds: result.ids});
      }
      return {...result, titles: {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages}};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? 'Notion rejected this secret. Copy the Internal Integration Secret again.' : error.message};
    }
  });
  ipcMain.handle('saveSettings', (_, patch) => storage.saveSettings(patch));
  ipcMain.handle('saveSecret', (_, name, value) => { storage.setSecret(name, value.trim()); return storage.secretsPresent(); });
  ipcMain.handle('checkAnthropic', async (_, key) => {
    try {
      await new Anthropic({apiKey: key.trim()}).models.list({limit: 1}); // free call: is the key valid?
      return {ok: true};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? 'This key was rejected. Copy it again from console.anthropic.com.' : error.message};
    }
  });
  ipcMain.handle('chooseCv', async () => {
    const picked = await dialog.showOpenDialog(window, {title: 'Choose your CV', filters: [{name: 'PDF', extensions: ['pdf']}], properties: ['openFile']});
    if (picked.canceled || !picked.filePaths[0]) return null;
    fs.copyFileSync(picked.filePaths[0], storage.path('cv.pdf'));
    storage.saveSettings({cvName: path.basename(picked.filePaths[0])});
    return path.basename(picked.filePaths[0]);
  });
  ipcMain.handle('draftStrategy', async (_, answers) => {
    storage.saveSettings({questionnaire: answers});
    return strategy.draft(storage, answers, storage.secret('ANTHROPIC_API_KEY'));
  });
  ipcMain.handle('saveStrategy', async (_, draft) => {
    strategy.save(storage, draft);
    // Notion is where the user reads and edits them from now on.
    const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
    if (token && ids.NOTION_PROFILE_PAGE_ID) {
      await notion.writePage(token, ids.NOTION_PROFILE_PAGE_ID, draft.profile_markdown);
      await notion.writePage(token, ids.NOTION_ANSWERS_PAGE_ID, draft.answers_markdown);
    }
    storage.saveSettings({setupDone: true});
    return true;
  });
  ipcMain.handle('profileText', () => ({profile: storage.readText('profile.md'), answers: storage.readText('answers.md')}));
  ipcMain.handle('saveProfileText', (_, {profile, answers}) => {
    storage.writeText('profile.md', profile);
    storage.writeText('answers.md', answers);
    return true;
  });
  ipcMain.handle('jobs', () => pipeline.jobs(storage));
  ipcMain.handle('refresh', () => pipeline.refresh(storage, log));
  ipcMain.handle('setStatus', (_, url, status) => pipeline.setStatus(storage, url, status));
  ipcMain.handle('apply', (_, options) => apply.start(storage, options));
  ipcMain.handle('openExternal', (_, url) => shell.openExternal(url));
  ipcMain.handle('showFolder', (_, name) => shell.openPath(name === 'extension' ? path.join(pipeline.REPO, 'extension') : storage.dir));
  ipcMain.handle('extensionInfo', () => ({url: `http://127.0.0.1:${server.PORT}`, token: server.extensionToken(storage)}));
}

// A separate data folder for tests and demos (JOB_PILOTTO_USER_DATA), so they never touch the real one.
if (process.env.JOB_PILOTTO_USER_DATA) app.setPath('userData', process.env.JOB_PILOTTO_USER_DATA);

app.whenReady().then(() => {
  storage = createStorage(app.getPath('userData'), safeStorageCrypto(safeStorage));
  pipeline.ensureConfig(storage);
  handlers();
  server.start(storage);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
