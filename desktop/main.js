// Job Pilotto desktop app: a local-first cockpit for the job search. Data and keys stay on this Mac.
import {app, BrowserWindow, desktopCapturer, dialog, ipcMain, Notification, powerMonitor, safeStorage, session, shell, systemPreferences} from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import * as apply from './lib/apply.js';
import * as cvlib from './lib/cv.js';
import * as github from './lib/github.js';
import * as interviews from './lib/interviews.js';
import * as calltap from './lib/calltap.js';
import * as notion from './lib/notion.js';
import {nextAt, nextMailAt, startSchedule} from './lib/schedule.js';
import * as telegram from './lib/telegram.js';
import * as pipeline from './lib/pipeline.js';
import * as server from './lib/server.js';
import * as strategy from './lib/strategy.js';
import * as questions from './lib/questions.js';
import * as migrate from './lib/migrate.js';
import * as schema from './lib/schema.js';
import * as reset from './lib/reset.js';
import * as files from './lib/files.js';
import * as backup from './lib/backup.js';
import * as cvChange from './lib/cv-change.js';
import * as notionOAuth from './lib/notion-oauth.js';
import * as contactDetails from './lib/contact.js';
import {createStorage, safeStorageCrypto, SECRET_NAMES} from './lib/storage.js';
import {cleanSecret} from './lib/secrets.js';
import {fileURLToPath} from 'node:url';
import * as telegramCloud from './lib/telegram-cloud.js';

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
    width: 1280, height: 820, minWidth: 1024, minHeight: 640, title: 'Job Pilotto', show: !process.env.JOB_PILOTTO_SMOKE,
    backgroundColor: '#eef3f7',
    webPreferences: {preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false},
  });
  // Demo mode can open another page of the app instead, e.g. the component gallery (npm run gallery).
  const page = DEMO && /^[a-z-]+\.html$/.test(process.env.JOB_PILOTTO_PAGE || '') ? process.env.JOB_PILOTTO_PAGE : 'index.html';
  window.loadFile(path.join(here, 'renderer', page));
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

// A CV page (cv/template.js) printed to PDF by Chromium in a hidden window. Fixed pages (a custom design)
// never grow, so a page whose content doesn't fit is reported instead of silently cut.
async function printPdf(htmlFile) {
  const printer = new BrowserWindow({show: false, width: 794, height: 1123, webPreferences: {sandbox: true, contextIsolation: true, javascript: true}});
  try {
    await printer.loadFile(htmlFile);
    const overflow = await printer.webContents.executeJavaScript(`document.fonts.ready.then(() =>
      [...document.querySelectorAll('.page.fixed')].map((page, i) => {
        const jobs = [...page.querySelectorAll('.job, .section')], last = jobs[jobs.length - 1];
        const banner = page.querySelector('.banner');
        const limit = (banner || page).getBoundingClientRect()[banner ? 'top' : 'bottom'];
        return last && last.getBoundingClientRect().bottom > limit + 1 ? i + 1 : 0;
      }).filter(Boolean))`);
    const pdf = await printer.webContents.printToPDF({pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: {marginType: 'none'}});
    return {pdf, overflow};
  } finally { printer.destroy(); }
}

// The tailored CV's review: the CV with its changes marked, next to what changed and why.
function openTailoredCv(code) {
  const record = cvlib.load(storage, code);
  if (!record) return false;
  const review = new BrowserWindow({width: 1280, height: 920, title: `Tailored CV · ${record.job.company}`,
    webPreferences: {sandbox: true, contextIsolation: true}});
  review.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('file:')) shell.openPath(fileURLToPath(url)); else shell.openExternal(url);
    return {action: 'deny'};
  });
  review.webContents.on('will-navigate', (event, url) => { event.preventDefault(); if (!url.startsWith('file:')) shell.openExternal(url); });
  review.loadFile(cvlib.reviewPage(storage, record));
  return true;
}
// A macOS notification; clicking it brings the app to the front.
// If macOS blocks notifications (common for an app run with npm start: "Electron" is off in System
// Settings), the same message shows as a toast inside the window, with a one-time hint how to allow them.
let notificationsBlocked = false;
function notify(title, body) {
  if (process.env.JOB_PILOTTO_SMOKE) return;
  const toast = hint => window?.webContents.send('toast', {title, body, hint});
  if (!Notification.isSupported() || notificationsBlocked) { toast(false); return; }
  const note = new Notification({title, body, silent: false});
  note.on('click', () => { window?.show(); window?.focus(); });
  note.on('failed', () => { const first = !notificationsBlocked; notificationsBlocked = true; toast(first); });
  note.show();
}

function handlers() {
  ipcMain.handle('state', () => ({
    about,
    settings: storage.settings(), secrets: storage.secretsPresent(),
    hasCv: fs.existsSync(storage.path('cv.pdf')), hasProfile: !!(storage.settings().setupDone && storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID),
    folder: storage.dir,
    notion: storage.secret('NOTION_TOKEN') ? Object.fromEntries(Object.entries(storage.settings().notionIds || {})
      .map(([env, id]) => [env, notion.pageUrl(id)])) : null,
    templateUrl: notion.TEMPLATE.template_url,
    notionTitles: {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages},
  }));
  // Connect the user's copy of the Job Pilotto template: every database and page found, every column there.
  // Connect to the user's Notion with a token (pasted, or from "Connect with Notion"): find the workspace, or
  // build it from the schema in the one page the connection sees (templateRoot: the page Notion just copied).
  async function connectNotion(token, {templateRoot = null} = {}) {
    try {
      const titles = {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages};
      const send = progress => window?.webContents.send('notionProgress', {...progress, titles});
      let result = await notion.connect(token);
      // A new, empty Job Pilotto page (nothing of ours in it yet): find it (Notion can take a few seconds to share
      // it with the connection), then build the whole workspace in it from the schema (the latest version).
      if (!result.ok && !Object.keys(result.ids || {}).length) {
        let root = templateRoot;
        for (let attempt = 0; !root && attempt < 12; attempt++) {
          root = await notion.sharedRoot(token);
          if (!root) { send({waitingPage: true}); await new Promise(resolve => setTimeout(resolve, 5000)); }
        }
        if (root) {
          send({building: true});
          const built = await schema.repair(token, {}, schema.load(), undefined, root);
          result = {ok: built.created.length > 0 && !!built.ids.NOTION_PROFILE_PAGE_ID, ids: built.ids, missing: [], problems: [], built: built.created};
        }
      }
      // Some parts found (a copied template still being shared): wait for the rest, as before.
      else if (!result.ok) result = await notion.connectWaiting(token, {onProgress: send});
      // Missing columns or databases (an older template, or a deleted one): add them from the schema, check again.
      if (!result.ok && result.ids?.NOTION_PROFILE_PAGE_ID) {
        const fixed = await schema.repair(token, result.ids);
        if (fixed.created.length || fixed.columns.length) result = {...await notion.connect(token), repaired: fixed};
      }
      if (result.ok) {
        storage.setSecret('NOTION_TOKEN', token);
        storage.saveSettings({notionIds: result.ids});
        if (!DEMO) migrate.run(storage, log);  // anything an older version kept on this Mac moves in now
      }
      return {...result, titles};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? 'Notion rejected this token. Copy the API token of your Job Pilotto connection again (Developer tools → Connections).' : error.message};
    }
  }
  ipcMain.handle('notionConnect', async (_, pasted) => {
    const {value: token, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    return connectNotion(token);
  });
  // "Connect with Notion": Notion's consent page in the browser, then the same connect as above.
  ipcMain.handle('notionOAuth', async () => {
    const signedIn = await notionOAuth.connect(url => shell.openExternal(url));
    if (!signedIn.ok) return signedIn;
    window?.show();
    window?.focus();
    const root = signedIn.duplicated_template_id ? String(signedIn.duplicated_template_id).replace(/-/g, '') : null;
    return {...await connectNotion(signedIn.access_token, {templateRoot: root}), workspace: signedIn.workspace_name};
  });
  ipcMain.handle('notionOAuthCancel', () => notionOAuth.cancel());
  ipcMain.handle('saveSettings', (_, patch) => storage.saveSettings(patch));
  ipcMain.handle('contact', () => (DEMO ? {} : contactDetails.read(storage)));
  ipcMain.handle('saveContact', (_, contact) => contactDetails.save(storage, contact).then(() => ({ok: true}))
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
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
    const name = cvChange.replace(storage, picked.filePaths[0], path.basename(picked.filePaths[0])).name;
    syncCv();  // this version to the Profile in Notion too
    return name;
  });
  // After setup, a replaced CV: its effects (Strategy → "What changes with this CV"). See lib/cv-change.js.
  ipcMain.handle('cvChange', () => ({...(storage.settings().cvChange || {}), name: storage.settings().cvName,
    comparable: fs.existsSync(storage.path(cvChange.PREVIOUS)), base: !!cvlib.baseCv(storage)}));
  ipcMain.handle('cvReview', async () => {
    try { return {ok: true, ...await cvChange.review(storage, storage.secret('ANTHROPIC_API_KEY'))}; }
    catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('cvApply', async (_, accepted) => {
    try { return {ok: true, ...await cvChange.apply(storage, accepted)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('cvChangeDone', () => { storage.saveSettings({cvChange: null}); return true; });
  ipcMain.handle('draftStrategy', async (_, answers) => {
    storage.saveSettings({questionnaire: answers});
    const kb = Math.round(fs.statSync(storage.path('cv.pdf')).size / 1024);
    const send = progress => window?.webContents.send('draftProgress', progress);
    const sent = `Sent your CV (${kb} KB) and your answers to Claude (${strategy.MODEL})`;
    // Before Claude writes anything it reads the CV (about 25 s): the bar moves by time, up to 10%.
    const started = Date.now();
    let writing = false;
    const reading = setInterval(() => !writing && send({part: 'Claude is reading your CV', notes: [sent, 'Claude is reading your CV…'],
      percent: Math.min(strategy.READING - 1, Math.round((Date.now() - started) / 25000 * strategy.READING))}), 1000);
    send({part: 'Sending your CV to Claude', percent: 0, notes: [sent]});
    let draft;
    try {
      draft = await strategy.draft(storage, answers, storage.secret('ANTHROPIC_API_KEY'), null,
        progress => { writing = true; send({...progress, notes: [sent, 'Claude read your CV', ...progress.notes]}); });
    } finally { clearInterval(reading); }
    send({part: 'Checking the draft', percent: 99, notes: ['Checking the draft (valid settings, nothing missing)…']});
    // Kept so reopening the wizard shows it again instead of paying for a new draft.
    storage.writeText('draft.json', JSON.stringify({answers, draft, cv: cvFingerprint(), at: new Date().toISOString()}));
    return draft;
  });
  // The saved draft, and whether it was made from the CV there is now (a replaced CV makes it out of date).
  const cvFingerprint = () => { try { const stat = fs.statSync(storage.path('cv.pdf')); return `${stat.size}-${Math.round(stat.mtimeMs)}`; } catch { return ''; } };
  ipcMain.handle('cachedDraft', () => {
    try { const cached = JSON.parse(storage.readText('draft.json')); return {...cached, cvChanged: !!cached.cv && cached.cv !== cvFingerprint()}; } catch { return null; }
  });
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
      // Notion is required: the Profile, standard answers and contact details live only there.
      const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
      if (!token || !ids.NOTION_PROFILE_PAGE_ID) return {ok: false, error: 'Connect Notion first: your strategy is saved there.'};
      // Progress for the save window: each step starts, advances (blocks written) and finishes.
      const step = (name, extra = {}) => window?.webContents.send('saveProgress', {step: name, ...extra});
      // Replacing a strategy that was set up before: keep a copy of the current one in Notion first.
      if (storage.settings().setupDone) {
        step('snapshot');
        const when = new Date().toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
        await notion.snapshotStrategy(token, ids, when);
        step('snapshot', {finished: true});
      }
      strategy.save(storage, draft);
      step('local', {finished: true});
      const report = page => (done, total) => step(page, {done, total});
      // Contact details are a section of the Profile page: what's there stays, the CV's non-empty values win.
      const known = await contactDetails.read(storage).catch(() => ({}));
      const merged = {...known, ...Object.fromEntries(Object.entries(draft.contact || {}).filter(([, value]) => value))};
      const profile = draft.profile_markdown.trim() + (Object.keys(merged).length ? `\n\n${contactDetails.markdown(merged)}\n` : '\n');
      step('profile');
      await notion.writePage(token, ids.NOTION_PROFILE_PAGE_ID, profile, undefined, report('profile'));
      step('profile', {finished: true});
      step('answers');
      await notion.writePage(token, ids.NOTION_ANSWERS_PAGE_ID, draft.answers_markdown, undefined, report('answers'));
      step('answers', {finished: true});
      strategy.dropLocalCopies(storage);  // Notion has them now
      step('search');
      await strategy.publishSearchSettings(storage, {run: pipeline.run, ensurePage: notion.ensurePage, writePage: notion.writePage});
      step('search', {finished: true});
      storage.saveSettings({setupDone: true});
      syncCv();  // the CV to the Profile page (Notion keeps every version)
      return {ok: true};
    })().catch(error => ({ok: false, error: `Couldn't write to Notion: ${error.message}`})).finally(() => { saving = null; });
    return saving;
  });
  ipcMain.handle('runs', () => ({runs: pipeline.runs(storage), running: pipeline.running(),
    lastSearchAt: storage.settings().lastSearchAt || null, nextSearchAt: nextAt(storage.settings()),
    nextMailAt: nextMailAt(storage.settings())}));
  ipcMain.handle('checkMail', () => (storage.settings().cloud?.repo
    ? github.cloudDispatch(storage, log)({}, 'mail.yml').then(() => ({ok: true, cloud: true}))
    : pipeline.checkMail(storage, log, 'you').then(({ok, run}) => ({ok, run}))));
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
    const result = await pipeline.jobs(storage);
    for (const job of result.jobs || []) job.tailored = !!job.code && cvlib.exists(storage, job.code);
    return result;
  });
  ipcMain.handle('refresh', async () => {
    if (!storage.settings().cloud?.repo) return pipeline.refresh(storage, log, 'run', 'you');
    await github.cloudDispatch(storage, log)({mode: 'run'});
    return {ok: true, cloud: true};
  });
  // "Keep working while my Mac is off": sign in to GitHub (code approved in the browser), then set up
  // the user's private repo. Also re-run after a key or setting changes ("Update").
  ipcMain.handle('cloudConnect', async (_, chosen = '') => {
    try {
      let token = storage.secret('GITHUB_TOKEN');
      if (!token) {
        const start = await github.startSignIn();
        window?.webContents.send('cloudStep', {code: start.userCode, url: start.url});
        shell.openExternal(start.url);
        token = await github.finishSignIn(start);
        storage.setSecret('GITHUB_TOKEN', token);
      }
      const result = await github.connect(storage, token, {repo: chosen, onStep: text => window?.webContents.send('cloudStep', {text})});
      return {ok: true, ...result};
    } catch (error) {
      if (error.status === 401) storage.setSecret('GITHUB_TOKEN', '');  // revoked: sign in again next time
      return {ok: false, error: error.message, ...(error.needsRepo ? {needsRepo: true, createUrl: github.CREATE_URL, installUrl: github.INSTALL_URL} : {}),
        ...(error.needsChoice ? {needsChoice: true, repos: error.repos} : {})};
    }
  });
  ipcMain.handle('cloudOff', async () => {
    if (storage.settings().telegramCloud) await telegramCloud.turnOff(storage);  // its buttons start runs there
    storage.saveSettings({cloud: null}); restartTelegram(); return true;
  });
  // Telegram buttons while this computer is off: the user's own Cloudflare Worker (lib/telegram-cloud.js).
  ipcMain.handle('telegramCloudOn', async (_, token) => { const result = await telegramCloud.turnOn(storage, token); restartTelegram(); return result; });
  ipcMain.handle('telegramCloudOff', async () => { const result = await telegramCloud.turnOff(storage); restartTelegram(); return result; });
  // Telegram: check the bot token, wait for the user to press Start, then listen for taps and commands.
  ipcMain.handle('telegramConnect', async (_, pasted) => {
    const {value: token, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    // A new bot: the old one's Worker goes (pairing needs getUpdates, which a webhook blocks); turn it on again after.
    if (storage.settings().telegramCloud) await telegramCloud.turnOff(storage);
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
  // Jobs → Applied elsewhere: tracked like /add, but waited for, so the list shows it as Applied right away.
  ipcMain.handle('addApplied', async (_, url, when = '') => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.'};
    if (!storage.secret('NOTION_TOKEN')) return {ok: false, text: 'Connect Notion first: applications are tracked there.'};
    try { return await pipeline.addApplied(storage, url, when, log); } catch (error) { return {ok: false, text: error.message}; }
  });
  // Jobs → Recruiter message: a recruiter lead read by Claude, waited for so the list shows it.
  ipcMain.handle('addLead', async (_, text, talking = false, image = null, target = '') => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.'};
    if (!storage.secret('NOTION_TOKEN')) return {ok: false, text: 'Connect Notion first: recruiter leads are tracked there.'};
    if (!storage.secret('ANTHROPIC_API_KEY')) return {ok: false, text: 'Reading a message or screenshot needs your Anthropic API key (Settings).'};
    // A screenshot goes to a temporary file for the run (then to Notion, on the job's page), and is deleted after.
    const ext = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'}[image?.type];
    const file = ext ? path.join(app.getPath('temp'), `job-pilotto-shot-${Date.now()}${ext}`) : '';
    try {
      if (file) fs.writeFileSync(file, Buffer.from(String(image.data), 'base64'));
      return await pipeline.addLead(storage, String(text || ''), !!talking, log, {file, target: String(target || '')});
    } catch (error) { return {ok: false, text: error.message}; } finally { if (file) fs.rmSync(file, {force: true}); }
  });
  // Interviews: drafts on this Mac (recording, transcribing, editing), saved ones in Notion 🎤 Interviews.
  // Demo mode shows fictional ones (demo/interviews.json) and changes nothing.
  const demoInterviews = () => JSON.parse(fs.readFileSync(path.join(here, 'demo', 'interviews.json'), 'utf8'));
  ipcMain.handle('ivDrafts', () => (DEMO ? [demoInterviews().draft] : interviews.drafts(storage)));
  ipcMain.handle('ivTranscript', (_, id) => (DEMO ? demoInterviews().transcript : interviews.transcript(storage, id)));
  ipcMain.handle('ivSaved', () => (DEMO ? {ok: true, interviews: demoInterviews().saved} : interviews.saved(storage)));
  ipcMain.handle('ivAdd', async () => {
    const picked = await dialog.showOpenDialog(window, {title: 'Choose an interview recording or transcript',
      filters: [{name: 'Recording or transcript', extensions: [...interviews.AUDIO, ...interviews.TEXT]}], properties: ['openFile']});
    if (picked.canceled || !picked.filePaths[0]) return null;
    let draft;
    try { draft = interviews.add(storage, picked.filePaths[0]); } catch (error) { return {error: error.message}; }
    // A transcript file is ready at once: it goes to Notion now, like a finished transcription.
    return draft.status === 'ready' ? (await interviews.toNotion(storage, draft.id).catch(() => null)) || draft : draft;
  });
  ipcMain.handle('ivRecordStart', (_, options) => interviews.startRecording(storage, options));
  ipcMain.handle('ivRecordChunk', (_, id, bytes) => { interviews.appendRecording(storage, id, bytes); return true; });
  ipcMain.handle('ivRecordStop', async (_, id, seconds, extra) => {
    const tap = await calltap.stop(id);
    return interviews.stopRecording(storage, id, seconds, {...extra, ...(tap ? {callFile: 'call.pcm', callStartedAt: tap.startedAt} : {})});
  });
  // The call's audio through AudioTee (Core Audio taps, macOS 14.2+; "System Audio Recording Only" permission).
  const tapReady = () => !DEMO && !!calltap.binary() && Number(process.getSystemVersion().split('.')[0]) >= 14
    && !(process.getSystemVersion().startsWith('14.') && Number(process.getSystemVersion().split('.')[1] || 0) < 2);
  ipcMain.handle('ivTapAvailable', () => tapReady());
  ipcMain.handle('ivTapStart', async (_, id) => {
    try {
      const file = path.join(storage.path('interviews'), String(id).replace(/[^\w-]/g, ''), 'call.pcm');
      let last = 0;
      const {startedAt} = await calltap.start(id, file, level => {
        if (Date.now() - last > 200) { last = Date.now(); window?.webContents.send('ivLevel', {id, level}); }
      });
      return {ok: true, startedAt};
    } catch (error) {
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('ivTranscribe', async (_, id, options) => {
    const meta = await interviews.transcribe(storage, id, options, step => window?.webContents.send('ivProgress', step));
    if (meta.status === 'ready') notify('Transcript ready', `${meta.title}: ${meta.pageId ? 'already in your Notion; ' : ''}name the speakers, pick the job, then Save.`);
    return meta;
  });
  ipcMain.handle('ivSaveDraft', (_, id, patch) => (DEMO ? true : interviews.saveDraft(storage, id, patch)));
  ipcMain.handle('ivDiscard', async (_, id) => (DEMO ? (interviews.discard(storage, id), true) : (await interviews.drop(storage, id)).ok));
  ipcMain.handle('ivSave', (_, id) => interviews.save(storage, id));
  ipcMain.handle('ivLink', (_, pageId, jobUrl) => interviews.link(storage, pageId, jobUrl));
  ipcMain.handle('ivReview', (_, pageId) => interviews.review(storage, pageId));
  ipcMain.handle('ivDelete', (_, pageId) => (DEMO ? {ok: true} : interviews.remove(storage, pageId)));
  // macOS privacy: the recorder needs the microphone, and Screen & System Audio Recording for the call's audio.
  // In development (npm start) macOS may list the terminal that started the app instead of Electron.
  ipcMain.handle('mediaAccess', () => (DEMO ? {microphone: 'granted', screen: 'granted', dev: false} : {microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: mediaAccess('screen'), dev: !app.isPackaged}));
  ipcMain.handle('openPrivacy', (_, kind) => shell.openExternal(process.platform === 'win32' ? 'ms-settings:privacy-microphone'
    : `x-apple.systempreferences:com.apple.preference.security?Privacy_${kind === 'screen' ? 'ScreenCapture' : 'Microphone'}`));
  ipcMain.handle('relaunch', () => { app.relaunch(); app.exit(0); });
  // Danger zone: a last native confirmation, then restart; the folder goes at the next start (lib/reset.js).
  // freshNotion: the Notion workspace is archived first (its page renamed, nothing deleted), so the setup
  // builds a new one; if Notion refuses, nothing is reset.
  ipcMain.handle('resetProfile', async (_, {backup = true, freshNotion = false} = {}) => {
    const answer = dialog.showMessageBoxSync(window, {type: 'warning', buttons: ['Cancel', 'Reset and restart'], defaultId: 0, cancelId: 0,
      message: freshNotion ? 'Reset Job Pilotto and start a fresh Notion workspace?' : 'Reset Job Pilotto on this computer?',
      detail: `Your keys, CV, tailored CVs, recordings, interview drafts, job list and settings on this computer ${backup
        ? 'are moved to a backup folder' : 'are deleted for good'}, and Job Pilotto restarts at the setup. ${freshNotion
        ? 'Your Job Pilotto page in Notion is renamed "… (archived)" and kept as it is; the setup then builds a new workspace in a new empty page.'
        : 'Your Notion workspace, Gmail sign-in and GitHub repo are not changed.'}`});
    if (answer !== 1) return {ok: false};
    let archived = null;
    if (freshNotion) {
      const when = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}).replace('Sept', 'Sep');
      try { archived = await notion.archiveWorkspace(storage.secret('NOTION_TOKEN'), storage.settings().notionIds || {}, when); }
      catch (error) { return {ok: false, error: `Notion: ${error.message}. Nothing was reset.`}; }
    }
    reset.request(storage.dir, {backup, archived});
    app.relaunch();
    app.exit(0);
    return {ok: true};
  });
  ipcMain.handle('lastReset', () => resetDone);
  // What lives only on this Mac: the weekly automatic backup (lib/backup.js), or now.
  ipcMain.handle('backupNow', () => backupNow());
  ipcMain.handle('showBackups', () => { fs.mkdirSync(backup.folder(), {recursive: true}); return shell.openPath(backup.folder()); });
  ipcMain.handle('backupStatus', () => ({at: storage.settings().lastBackupAt || null, file: storage.settings().lastBackupFile || null,
    folder: backup.folder()}));
  // Export: one file with this computer's Job Pilotto data (keys only when asked: they're in plain text there).
  // notion: also a read-only copy of the whole Notion workspace (notion.json), to keep or move elsewhere.
  ipcMain.handle('exportProfile', async (_, {keys = false, notion: withNotion = false} = {}) => {
    const day = new Date().toISOString().slice(0, 10);
    const picked = await dialog.showSaveDialog(window, {title: 'Export your Job Pilotto data',
      defaultPath: path.join(app.getPath('documents'), `Job Pilotto export ${day}.tar.gz`), filters: [{name: 'Job Pilotto export', extensions: ['gz']}]});
    if (picked.canceled || !picked.filePath) return {ok: false};
    const secrets = keys ? Object.fromEntries(SECRET_NAMES.map(name => [name, storage.secret(name)]).filter(([, value]) => value)) : null;
    try {
      const copy = withNotion ? await notion.dumpWorkspace(storage.secret('NOTION_TOKEN'), storage.settings().notionIds || {},
        {onProgress: count => window?.webContents.send('exportProgress', count)}) : null;
      reset.exportTo(storage.dir, picked.filePath, {keys: secrets, notion: copy, version: about.label});
      return {ok: true, file: picked.filePath, notion: copy && {pages: copy.pages, rows: copy.rows}};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // Import: the file replaces this computer's data (which is kept as a backup), at a restart.
  ipcMain.handle('importProfile', async () => {
    const picked = await dialog.showOpenDialog(window, {title: 'Import Job Pilotto data', properties: ['openFile'],
      filters: [{name: 'Job Pilotto export', extensions: ['gz', 'tgz']}]});
    if (picked.canceled || !picked.filePaths[0]) return {ok: false};
    const answer = dialog.showMessageBoxSync(window, {type: 'warning', buttons: ['Cancel', 'Import and restart'], defaultId: 0, cancelId: 0,
      message: 'Replace this computer\'s Job Pilotto data with the export?',
      detail: 'Your current data here is moved to a backup folder first, then Job Pilotto restarts with the imported data. Your Notion workspace is not changed.'});
    if (answer !== 1) return {ok: false};
    try { reset.stageImport(storage.dir, picked.filePaths[0]); } catch (error) { return {ok: false, error: error.message}; }
    app.relaunch();
    app.exit(0);
    return {ok: true};
  });
  ipcMain.handle('ivRecordings', () => {
    fs.mkdirSync(storage.path('recordings'), {recursive: true});
    return shell.openPath(storage.path('recordings'));
  });
  ipcMain.handle('setAutomation', (_, patch) => {
    const allowed = {};
    if ('autoSearch' in patch) allowed.autoSearch = !!patch.autoSearch;
    if ('openAtLogin' in patch) { allowed.openAtLogin = !!patch.openAtLogin; app.setLoginItemSettings({openAtLogin: allowed.openAtLogin}); }
    return storage.saveSettings(allowed);
  });
  ipcMain.handle('setStatus', (_, url, status) => pipeline.setStatus(storage, url, status));
  // A rejected job's menu → Why was I rejected? (also runs by itself after the Gmail check logs a rejection).
  ipcMain.handle('reviewRejection', async (_, url) => {
    if (DEMO) return {ok: true, text: 'Reviewed (demo): nothing was written.'};
    if (!storage.secret('ANTHROPIC_API_KEY')) return {ok: false, text: 'The review needs your Anthropic API key (Settings).'};
    try { return await pipeline.reviewRejection(storage, url, log); } catch (error) { return {ok: false, text: error.message}; }
  });
  ipcMain.handle('apply', async (_, options) => options?.mode === 'agents' && !(await claudeConsent())
    ? {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'} : apply.start(storage, options));
  ipcMain.handle('applyOne', (_, url) => apply.openOne(url));
  ipcMain.handle('applyWithClaude', async (_, url) => (await claudeConsent())
    ? apply.claudeOne(storage, url) : {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'});
  ipcMain.handle('claudeReady', () => apply.claudeReady(storage));
  ipcMain.handle('claudePrereqs', () => apply.claudePrereqs());
  // Gmail and Calendar (read-only): replies and interviews, and sign-up confirmation emails for Apply with Claude.
  // The token lives in the Keychain, where the Python side (src/sources/google.py) reads it.
  ipcMain.handle('googleStatus', async () => {
    const {stdout} = await pipeline.run(storage, ['src.sources.google', 'status']);
    try { return JSON.parse(stdout.trim().split('\n').pop()); } catch { return {connected: false}; }
  });
  ipcMain.handle('googleConnect', async () => {
    const lines = [];
    const {code} = await pipeline.run(storage, ['src.sources.google', 'auth'], line => lines.push(line));
    return code === 0 ? {ok: true} : {ok: false, error: lines.filter(line => !/^Opening|^https?:/.test(line)).slice(-1)[0] || 'Sign-in did not complete'};
  });
  ipcMain.handle('openTabs', () => server.openTabs());
  ipcMain.handle('extensionSeen', () => server.extensionSeen());
  // A failed Notion read is reported (not an empty list), so the section says why instead of disappearing.
  ipcMain.handle('openQuestions', () => (DEMO ? Promise.resolve(storage.settings().openQuestions || []) : questions.list(storage)).then(list => ({ok: true, list}), error => ({ok: false, error: error.message, list: []})));
  ipcMain.handle('answerQuestion', (_, questionKey, answer) => questions.answer(storage, questionKey, answer)
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // Saved keys as dots plus their last 4 characters, so Settings can show which key is stored (never the key).
  ipcMain.handle('secretHints', () => Object.fromEntries(['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY']
    .map(name => [name, storage.secret(name)]).filter(([, value]) => value).map(([name, value]) => [name, `${'•'.repeat(12)}${value.slice(-4)}`])));
  // The application kit: the form's questions (read from the ATS), an answer for each and a cover letter,
  // saved on the job's Notion Applications row (Stage Kit ready). Apply needs one.
  ipcMain.handle('prepareKit', async (_, code, name = 'this job') => {
    // Quietly: the result comes as a notification (and the row's Apply), not as log output.
    const lines = [];
    const {code: exit} = await pipeline.run(storage, pipeline.dailyArgs(storage, {mode: 'prepare', job: code}), line => lines.push(line));
    const ineligible = lines.map(line => line.replace(/<[^>]+>/g, '')).find(line => line.includes('Not eligible:'));
    if (exit !== 0) notify('Kit not prepared', `${name}: ${lines.filter(Boolean).slice(-1)[0] || 'something went wrong'}`);
    else notify('Application kit ready ✓', ineligible ? `${name}. ${ineligible.trim()}` : `${name}. Press Apply to fill the form.`);
    return {ok: exit === 0, ineligible: ineligible || ''};
  });
  // Tailored CV for one job: base CV (imported from the CV PDF the first time) + the posting -> Claude ->
  // checked -> PDF. A fixed-page design that overflows gets one second try with that feedback.
  ipcMain.handle('tailorCv', async (_, code, name = 'this job') => {
    const key = storage.secret('ANTHROPIC_API_KEY');
    if (!key) return {ok: false, error: 'Add your Anthropic API key in Settings first.'};
    try {
      let cost = 0;
      if (!cvlib.baseCv(storage)) {
        if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF) in Settings first.'};
        cost += (await cvlib.importPdf(storage, key)).usd;
      }
      const job = await pipeline.posting(storage, code);
      if (!job.ok) return {ok: false, error: job.error};
      const base = cvlib.baseCv(storage);
      const {profile} = await strategy.profileTexts(storage);
      let feedback = '', result, applied, printed;
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await cvlib.tailor(storage, job, key, {feedback, profile});
        cost += answer.usd;
        result = answer.result;
        applied = cvlib.applyTailoring(base, result, profile);
        printed = await printPdf(cvlib.writeHtml(storage, applied.cv, `${code}.html`));
        if (!printed.overflow.length) break;
        feedback = `Your last version didn't fit on page ${printed.overflow.join(', ')}: make the bullets on that page shorter or drop one, so it fits.`;
        if (attempt === 1) applied.warnings.push(`Page ${printed.overflow.join(', ')} is too full and its end is cut off: tailor again, or shorten it by hand.`);
      }
      const record = {job: {code, title: job.title, company: job.company, url: job.url}, createdAt: new Date().toISOString(),
        model: cvlib.MODEL, usd: Math.round(cost * 100) / 100, changes: result.changes, warnings: applied.warnings, cv: applied.cv, review: applied.review, result};
      cvlib.save(storage, code, record, printed.pdf);
      // Notion too, on the job's Applications row (the PDF isn't only on this Mac); no row yet -> said below.
      let inNotion = false;
      try {
        inNotion = await files.tailoredToApplication(storage.secret('NOTION_TOKEN'), storage.settings().notionIds?.NOTION_APPLICATIONS_DB,
          job.url, cvlib.pdfPath(storage, code), `CV · ${job.company} · ${job.title}.pdf`.replace(/[/\\:]/g, '-'));
      } catch (error) { console.error(`Tailored CV not saved to Notion: ${error.message}`); }
      notify('Tailored CV ready ✓', `${name}: ${result.changes.length} changes${applied.warnings.length ? `, ${applied.warnings.length} to check` : ''}.`
        + (inNotion ? ' Saved in Notion too.' : ' On this Mac only: save the job (☆) to keep it in Notion.'));
      openTailoredCv(code);
      return {ok: true, usd: record.usd};
    } catch (error) {
      notify('CV not tailored', `${name}: ${error.message}`);
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('openTailoredCv', (_, code) => openTailoredCv(code));
  // The base CV the tailoring starts from: import it from the CV PDF (again), see it, or edit its files.
  ipcMain.handle('cvStatus', () => ({base: !!cvlib.baseCv(storage), custom: fs.existsSync(path.join(cvlib.dir(storage), 'style.css'))}));
  ipcMain.handle('importCv', async () => {
    const key = storage.secret('ANTHROPIC_API_KEY');
    if (!key) return {ok: false, error: 'Add your Anthropic API key first.'};
    if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF) first.'};
    try { return {ok: true, usd: (await cvlib.importPdf(storage, key)).usd}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('viewBaseCv', async () => {
    const base = cvlib.baseCv(storage);
    if (!base) return {ok: false, error: 'No base CV yet.'};
    const {pdf, overflow} = await printPdf(cvlib.writeHtml(storage, base, 'base.html'));
    const target = path.join(cvlib.dir(storage), 'base.pdf');
    fs.writeFileSync(target, pdf, {mode: 0o600});
    shell.openPath(target);
    return {ok: true, overflow};
  });
  ipcMain.handle('showCvFolder', () => { fs.mkdirSync(cvlib.dir(storage), {recursive: true}); return shell.openPath(cvlib.dir(storage)); });
  ipcMain.handle('openExternal', (_, url) => shell.openExternal(url));
  // Notion pages open where the user is already signed in: the Notion app when it's installed, else the
  // browser. ⌘-click opens the app's own Notion window instead (its own sign-in, kept between restarts).
  ipcMain.handle('openNotion', (_, url, inWindow) => {
    if (inWindow) return openNotion(url);
    if (app.getApplicationNameForProtocol('notion://')) return shell.openExternal(url.replace(/^https:\/\//, 'notion://'));
    return shell.openExternal(url);
  });
  ipcMain.handle('showFolder', (_, name) => shell.openPath(name === 'extension' ? path.join(pipeline.REPO, 'extension') : storage.dir));
  ipcMain.handle('extensionInfo', () => ({url: `http://127.0.0.1:${server.PORT}`, token: server.extensionToken(storage)}));
}

// A separate data folder for tests and demos (JOB_PILOTTO_USER_DATA), so they never touch the real one.
if (process.env.JOB_PILOTTO_USER_DATA) app.setPath('userData', process.env.JOB_PILOTTO_USER_DATA);

// A reset asked for in Settings → Danger zone: the data folder is moved aside (or deleted) now, before anything
// opens it; the app then starts like the first time (the setup wizard).
let resetDone = null;
// The CV in Notion (once per version) and the weekly backup of Mac-only files: failures are logged, never block.
function syncCv() {
  if (DEMO) return;
  files.syncCv(storage).then(done => done.uploaded && console.log(`CV saved to your Notion Profile (${done.uploaded})`))
    .catch(error => console.error(`CV not saved to Notion: ${error.message}`));
}
function backupNow() {
  try { const done = backup.run(storage, {version: about?.label || ''}); console.log(`Backup saved: ${done.file}`); return {ok: true, ...done}; }
  catch (error) { console.error(`Backup failed: ${error.message}`); return {ok: false, error: error.message}; }
}
try { resetDone = reset.applyPending(app.getPath('userData')); } catch (error) { console.error('Reset failed:', error.message); }

// One copy per data folder: two would fight over the same files, Telegram bot and extension port.
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({type: 'info', message: 'Job Pilotto is already running',
      detail: `Quit the other copy first (${process.platform === 'darwin' ? '⌘Q' : 'close its window'}), then open this one again.`});
    app.quit();
  });
}
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});

// Apply with Claude sessions run without asking before each action (--permission-mode bypassPermissions), so the
// user agrees once, knowing what that means; the answer is kept in settings.
async function claudeConsent() {
  if (storage.settings().claudeConsent) return true;
  const {response} = await dialog.showMessageBox(window, {type: 'warning', buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Let Claude work without asking before each step?',
    detail: 'Apply with Claude opens a Claude Code window per job that browses, signs up on the employer\'s site and fills the form ' +
      'without asking you to approve each action, so it can work on its own. It never clicks Submit: you review and submit yourself. ' +
      'Any other command it decides to run also runs without asking, so watch its window while it works.\n\n' +
      'It uses your own Claude account and plan. You can turn this off in Settings.'});
  if (response !== 0) return false;
  storage.saveSettings({claudeConsent: new Date().toISOString()});
  return true;
}

// Screen capture needs a permission only on the Mac; Windows lets any app capture the screen and its audio.
function mediaAccess(type) {
  return process.platform === 'darwin' || type !== 'screen' ? systemPreferences.getMediaAccessStatus(type) : 'granted';
}

// The interview recorder asks for the screen's audio (the call). Chromium captures system audio on macOS 13+
// through ScreenCaptureKit behind these switches; without them (or without Screen Recording permission)
// the recorder falls back to the microphone alone.
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
// Electron's desktopCapturer rejects an internal promise ("Failed to get sources") when macOS hasn't allowed
// screen capture, even though the display-media handler catches it; that one is expected (the recorder shows
// the permission panel), so it isn't logged. Every other unhandled rejection still is.
process.on('unhandledRejection', reason => {
  if (String(reason?.message || reason) === 'Failed to get sources.') return;
  console.error('Unhandled rejection:', reason);
});

if (firstCopy) app.whenReady().then(() => {
  app.setAboutPanelOptions({applicationName: 'Job Pilotto', applicationVersion: app.getVersion(),
    version: buildInfo ? `build ${buildInfo.build} · ${buildInfo.commit}` : 'development', copyright: '© 2026 Job Pilotto'});
  if (!app.isPackaged) app.dock?.setIcon(path.join(here, 'assets', 'icon.png'));
  storage = createStorage(app.getPath('userData'), DEMO ? {encrypt: value => value, decrypt: value => value} : safeStorageCrypto(safeStorage));
  reset.adoptKeys(storage);  // keys that came with an import: stored encrypted, plain file deleted
  pipeline.ensureConfig(storage);
  handlers();
  // Without Screen Recording permission there's no source (desktopCapturer rejects "Failed to get sources",
  // logged by Electron as an unhandled rejection), and Electron throws when a video request is answered
  // without video. So: when macOS says denied, refuse without asking for sources (not-determined still asks,
  // so macOS shows its prompt once); catch the rest. The recorder then shows the permission panel.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const answer = streams => { try { callback(streams); } catch {} };
    if (['denied', 'restricted'].includes(mediaAccess('screen'))) { answer({}); return; }
    desktopCapturer.getSources({types: ['screen']})
      .then(sources => answer(sources[0] ? {video: sources[0], audio: 'loopback'} : {}))
      .catch(() => answer({}));
  });
  if (!DEMO) {
    server.setNotifier(notify);
  server.start(storage, error => log(error.code === 'EADDRINUSE'
      ? `Chrome extension connection is off: port ${server.PORT} is used by another program.`
      : `Chrome extension connection failed: ${error.message}`));
  }
  createWindow();
  if (!DEMO) {
    // User data left on this Mac -> Notion (source of truth), once. It runs while the window loads, so the
    // window reads again what moved (e.g. open questions read before they reached Notion looked like none).
    migrate.run(storage, log).then(moved => { if (moved.length) window?.webContents.send('moved', moved); });
    syncCv();
    const backupIfDue = () => { if (storage.settings().setupDone && backup.due(storage.settings())) backupNow(); };
    backupIfDue();
    setInterval(backupIfDue, 6 * 3600 * 1000);
    restartTelegram();
    // On the chosen schedule while the app is open (the digest goes to Telegram when there's something new).
    // Searches: a notification a minute before one starts, and one with the result when it's done.
    // Gmail checks: a notification only when they recorded something (a reply, rejection, interview…).
    startSchedule(storage, {
      search: async () => {
        const {ok, run} = await pipeline.refresh(storage, log, 'scheduled', 'schedule');
        notify(ok ? 'Scheduled search done' : 'Scheduled search had problems',
          ok ? (run.new ? `${run.new} new job${run.new === 1 ? '' : 's'} found.` : 'No new jobs this time.')
            : 'Open Job Pilotto and click the activity bar to see what happened.');
      },
      mail: async () => {
        const {ok, run} = await pipeline.checkMail(storage, log, 'schedule');
        if (!ok) notify('Gmail check had problems', 'Open Job Pilotto and click the activity bar to see what happened.');
        else if (run.updates?.length) notify(`Gmail: ${run.updates.length} application update${run.updates.length === 1 ? '' : 's'}`,
          run.updates.slice(0, 3).join('\n'));
      },
    }, powerMonitor, {soon: () => notify('Job search starting in 1 minute', 'Your scheduled search for new jobs is about to run.')});
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
