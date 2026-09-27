// Job Pilotto desktop app: a local-first cockpit for the job search. Data and keys stay on this Mac.
import {app, BrowserWindow, dialog, ipcMain, powerMonitor, safeStorage, shell} from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import * as apply from './lib/apply.js';
import * as github from './lib/github.js';
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
// Demo mode (JOB_PILOTTO_DEMO=1, with JOB_PILOTTO_USER_DATA pointing at a copy of demo/): fictional
// profile and jobs for screenshots (scripts/screenshots.mjs). Nothing is contacted: no Python, Telegram,
// GitHub or local server, and the keys in demo/secrets.json are placeholders stored unencrypted.
const DEMO = !!process.env.JOB_PILOTTO_DEMO;
// Version shown in the About box and the sidebar. build-info.json is written by the packaged build
// (scripts/stage.mjs --app); without it this is a development copy (npm start).
const buildInfo = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'build-info.json'), 'utf8')); } catch { return null; } })();
const about = {version: app.getVersion(), build: buildInfo?.build || null, commit: buildInfo?.commit || null,
  label: DEMO ? app.getVersion() : buildInfo ? `${app.getVersion()} (build ${buildInfo.build}, ${buildInfo.commit})` : `${app.getVersion()} (development)`};
let storage;
let window;
let polling = null;

function restartTelegram() {
  polling?.stop();
  polling = telegram.startPolling(storage, log);
}

// Notion inside the app: its own window (Notion refuses to be shown in an iframe). The session is kept
// (partition persist:notion), so the user signs in to Notion once; links to other sites open in the browser.
let notionWindow = null;
function openNotion(url) {
  if (!/^https:\/\/(www\.)?notion\.(so|site)\//.test(url)) return shell.openExternal(url);
  if (!notionWindow || notionWindow.isDestroyed()) {
    notionWindow = new BrowserWindow({width: 1280, height: 860, title: 'Notion · Job Pilotto',
      webPreferences: {partition: 'persist:notion', contextIsolation: true, sandbox: true}});
    const outside = target => !/^https:\/\/([a-z0-9-]+\.)*notion\.(so|site|com)\//.test(target);
    notionWindow.webContents.setWindowOpenHandler(({url: target}) => {
      if (outside(target)) { shell.openExternal(target); return {action: 'deny'}; }
      notionWindow.loadURL(target);
      return {action: 'deny'};
    });
  }
  notionWindow.loadURL(url);
  notionWindow.show();
  notionWindow.focus();
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
    about,
    settings: storage.settings(), secrets: storage.secretsPresent(),
    hasCv: fs.existsSync(storage.path('cv.pdf')), hasProfile: !!storage.readText('profile.md'),
    folder: storage.dir,
    notion: storage.secret('NOTION_TOKEN') ? Object.fromEntries(Object.entries(storage.settings().notionIds || {})
      .map(([env, id]) => [env, notion.pageUrl(id)])) : null,
    templateUrl: notion.TEMPLATE.template_url,
    notionTitles: {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages},
  }));
  // Connect the user's copy of the Job Pilotto template: every database and page found, every column there.
  ipcMain.handle('notionConnect', async (_, pasted) => {
    const {value: token, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    try {
      const titles = {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages};
      const result = await notion.connectWaiting(token, {onProgress: progress => window?.webContents.send('notionProgress', {...progress, titles})});
      if (result.ok) {
        storage.setSecret('NOTION_TOKEN', token);
        storage.saveSettings({notionIds: result.ids});
      }
      return {...result, titles: {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages}};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? 'Notion rejected this token. Copy the API token of your Job Pilotto connection again (Developer tools → Connections).' : error.message};
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
    const draft = await strategy.draft(storage, answers, storage.secret('ANTHROPIC_API_KEY'), null,
      progress => window?.webContents.send('draftProgress', progress));
    // Kept so reopening the wizard shows it again instead of paying for a new draft.
    storage.writeText('draft.json', JSON.stringify({answers, draft, at: new Date().toISOString()}));
    return draft;
  });
  ipcMain.handle('cachedDraft', () => { try { return JSON.parse(storage.readText('draft.json')); } catch { return null; } });
  ipcMain.handle('cacheDraftEdits', (_, edits) => {
    try {
      const cached = JSON.parse(storage.readText('draft.json'));
      storage.writeText('draft.json', JSON.stringify({...cached, draft: {...cached.draft, ...edits}}));
    } catch {}
    return true;
  });
  // One save at a time: a second click while Notion is being written joins the running save.
  let saving = null;
  ipcMain.handle('saveStrategy', (_, draft) => {
    saving ||= (async () => {
      strategy.save(storage, draft);
      // Notion is where the user reads and edits them from now on.
      const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
      if (token && ids.NOTION_PROFILE_PAGE_ID) {
        const report = page => (done, total) => window?.webContents.send('saveProgress', {page, done, total});
        await notion.writePage(token, ids.NOTION_PROFILE_PAGE_ID, draft.profile_markdown, undefined, report('Profile'));
        await notion.writePage(token, ids.NOTION_ANSWERS_PAGE_ID, draft.answers_markdown, undefined, report('standard answers'));
      }
      storage.saveSettings({setupDone: true});
      return {ok: true};
    })().catch(error => ({ok: false, error: `Couldn't write to Notion: ${error.message}`})).finally(() => { saving = null; });
    return saving;
  });
  ipcMain.handle('profileText', () => ({profile: storage.readText('profile.md'), answers: storage.readText('answers.md')}));
  ipcMain.handle('saveProfileText', (_, {profile, answers}) => {
    storage.writeText('profile.md', profile);
    storage.writeText('answers.md', answers);
    return true;
  });
  ipcMain.handle('runs', () => ({runs: pipeline.runs(storage), running: pipeline.running(),
    lastSearchAt: storage.settings().lastSearchAt || null}));
  // Right after setup: the first search, so the Jobs screen fills while the user watches.
  ipcMain.handle('firstSearch', () => (storage.settings().lastSearchAt || pipeline.running() ? {ok: true, skipped: true}
    : pipeline.refresh(storage, log, 'run', 'first')));
  ipcMain.handle('jobs', async () => {
    if (DEMO) return JSON.parse(fs.readFileSync(path.join(here, 'demo', 'jobs.json'), 'utf8'));
    // Searches run in the cloud: show the latest cloud run's jobs (checked at most every 5 minutes).
    const cloud = storage.settings().cloud;
    if (cloud?.repo && Date.now() - Date.parse(cloud.checkedAt || 0) > 5 * 60 * 1000) {
      storage.saveSettings({cloud: {...cloud, checkedAt: new Date().toISOString()}});
      await github.syncDatabase(storage).catch(error => log(`Cloud job list: ${error.message}`));
    }
    return pipeline.jobs(storage);
  });
  ipcMain.handle('refresh', async () => {
    if (!storage.settings().cloud?.repo) return pipeline.refresh(storage, log, 'run', 'you');
    await github.cloudDispatch(storage, log)({mode: 'run'});
    return {ok: true, cloud: true};
  });
  // "Keep working while my Mac is off": sign in to GitHub (code approved in the browser), then set up
  // the user's private repo. Also re-run after a key or setting changes ("Update").
  ipcMain.handle('cloudConnect', async () => {
    try {
      let token = storage.secret('GITHUB_TOKEN');
      if (!token) {
        const start = await github.startSignIn();
        window?.webContents.send('cloudStep', {code: start.userCode, url: start.url});
        shell.openExternal(start.url);
        token = await github.finishSignIn(start);
        storage.setSecret('GITHUB_TOKEN', token);
      }
      const result = await github.connect(storage, token, {onStep: text => window?.webContents.send('cloudStep', {text})});
      return {ok: true, ...result};
    } catch (error) {
      if (error.status === 401) storage.setSecret('GITHUB_TOKEN', '');  // revoked: sign in again next time
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('cloudOff', () => { storage.saveSettings({cloud: null}); restartTelegram(); return true; });
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
  ipcMain.handle('applyOne', (_, url) => apply.openOne(url));
  ipcMain.handle('openExternal', (_, url) => shell.openExternal(url));
  ipcMain.handle('openNotion', (_, url, inBrowser) => (inBrowser ? shell.openExternal(url) : openNotion(url)));
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
  app.setAboutPanelOptions({applicationName: 'Job Pilotto', applicationVersion: app.getVersion(),
    version: buildInfo ? `build ${buildInfo.build} · ${buildInfo.commit}` : 'development', copyright: '© 2026 Job Pilotto'});
  if (!app.isPackaged) app.dock?.setIcon(path.join(here, 'assets', 'icon.png'));
  storage = createStorage(app.getPath('userData'), DEMO ? {encrypt: value => value, decrypt: value => value} : safeStorageCrypto(safeStorage));
  pipeline.ensureConfig(storage);
  handlers();
  if (!DEMO) {
    server.start(storage, error => log(error.code === 'EADDRINUSE'
      ? `Chrome extension connection is off: port ${server.PORT} is used by another program.`
      : `Chrome extension connection failed: ${error.message}`));
  }
  createWindow();
  if (!DEMO) {
    restartTelegram();
    // On the chosen schedule while the app is open (the digest goes to Telegram when there's something new).
    startSchedule(storage, () => pipeline.refresh(storage, log, 'scheduled', 'schedule'), powerMonitor);
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
