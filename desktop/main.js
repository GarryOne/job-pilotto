// Job Pilotto desktop app: a local-first cockpit for the job search. Data and keys stay on this Mac.
import {app, BrowserWindow, dialog, ipcMain, powerMonitor, safeStorage, shell} from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import * as apply from './lib/apply.js';
import * as notion from './lib/notion.js';
import {startSchedule} from './lib/schedule.js';
import * as telegram from './lib/telegram.js';
import * as pipeline from './lib/pipeline.js';
import * as server from './lib/server.js';
import * as strategy from './lib/strategy.js';
import {createStorage, safeStorageCrypto} from './lib/storage.js';
import {cleanSecret} from './lib/secrets.js';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let storage;
let window;
let polling = null;

function restartTelegram() {
  polling?.stop();
  polling = telegram.startPolling(storage, log);
}

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
  ipcMain.handle('notionConnect', async (_, pasted) => {
    const {value: token, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    try {
      const result = await notion.connect(token);
      if (result.ok) {
        storage.setSecret('NOTION_TOKEN', token);
        storage.saveSettings({notionIds: result.ids});
      }
      return {...result, titles: {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages}};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? 'Notion rejected this secret. Copy the Internal Integration Secret again.' : error.message};
    }
  });
  ipcMain.handle('saveSettings', (_, patch) => storage.saveSettings(patch));
  ipcMain.handle('saveSecret', (_, name, pasted) => {
    const {value, error} = cleanSecret(pasted);
    if (error) throw new Error(error);
    storage.setSecret(name, value);
    return storage.secretsPresent();
  });
  ipcMain.handle('checkAnthropic', async (_, pasted) => {
    const {value: key, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    try {
      await new Anthropic({apiKey: key}).models.list({limit: 1}); // free call: is the key valid?
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
  ipcMain.handle('refresh', () => pipeline.refresh(storage, log, 'run'));
  // Telegram: check the bot token, wait for the user to press Start, then listen for taps and commands.
  ipcMain.handle('telegramConnect', async (_, pasted) => {
    const {value: token, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    try {
      const bot = await telegram.api(token, 'getMe');
      window?.webContents.send('telegramWaiting', bot.username);
      const {chatId} = await telegram.pair(token);
      storage.setSecret('TELEGRAM_BOT_TOKEN', token);
      storage.saveSettings({telegramChatId: chatId, telegramBot: bot.username, telegramOffset: null});
      restartTelegram();
      return {ok: true, username: bot.username};
    } catch (error) {
      return {ok: false, error: error.code === 401 ? 'Telegram rejected this token. Copy it again from @BotFather.' : error.message};
    }
  });
  // Every Telegram command, from the app (the answer also goes to Telegram when connected).
  const COMMANDS = ['run', 'today', 'applied', 'saved', 'insight', 'weekly', 'mail', 'scout', 'status', 'add', 'help'];
  ipcMain.handle('command', async (_, name, arg = '') => {
    if (!COMMANDS.includes(name)) return {text: 'Unknown command'};
    try { return await telegram.runCommand(storage, name, arg, log); } catch (error) { return {text: `⚠️ ${error.message}`}; }
  });
  ipcMain.handle('chooseTranscript', async () => {
    const picked = await dialog.showOpenDialog(window, {title: 'Choose the interview transcript',
      filters: [{name: 'Transcript', extensions: ['txt', 'md', 'srt', 'vtt', 'text']}], properties: ['openFile']});
    return picked.canceled ? null : picked.filePaths[0];
  });
  ipcMain.handle('reviewInterview', (_, input) => { telegram.reviewInterview(storage, input, log); return true; });
  ipcMain.handle('setAutomation', (_, patch) => {
    const allowed = {};
    if ('autoSearch' in patch) allowed.autoSearch = !!patch.autoSearch;
    if ('openAtLogin' in patch) { allowed.openAtLogin = !!patch.openAtLogin; app.setLoginItemSettings({openAtLogin: allowed.openAtLogin}); }
    return storage.saveSettings(allowed);
  });
  ipcMain.handle('setStatus', (_, url, status) => pipeline.setStatus(storage, url, status));
  ipcMain.handle('apply', (_, options) => apply.start(storage, options));
  ipcMain.handle('openExternal', (_, url) => shell.openExternal(url));
  ipcMain.handle('showFolder', (_, name) => shell.openPath(name === 'extension' ? path.join(pipeline.REPO, 'extension') : storage.dir));
  ipcMain.handle('extensionInfo', () => ({url: `http://127.0.0.1:${server.PORT}`, token: server.extensionToken(storage)}));
}

// A separate data folder for tests and demos (JOB_PILOTTO_USER_DATA), so they never touch the real one.
if (process.env.JOB_PILOTTO_USER_DATA) app.setPath('userData', process.env.JOB_PILOTTO_USER_DATA);

// One copy per data folder: two would fight over the same files, Telegram bot and extension port.
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({type: 'info', message: 'Job Pilotto is already running',
      detail: 'Quit the other copy first (⌘Q), then open this one again.'});
    app.quit();
  });
}
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});

if (firstCopy) app.whenReady().then(() => {
  storage = createStorage(app.getPath('userData'), safeStorageCrypto(safeStorage));
  pipeline.ensureConfig(storage);
  handlers();
  server.start(storage, error => log(error.code === 'EADDRINUSE'
    ? `Chrome extension connection is off: port ${server.PORT} is used by another program.`
    : `Chrome extension connection failed: ${error.message}`));
  createWindow();
  restartTelegram();
  // Every 4 hours while the app is open (the digest goes to Telegram when there's something new).
  startSchedule(storage, () => pipeline.refresh(storage, log, 'scheduled'), powerMonitor);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
