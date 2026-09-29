// Job Pilotto desktop app: a local-first cockpit for the job search. Data and keys stay on this Mac.
import {app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, Notification, powerMonitor, safeStorage, session, shell, systemPreferences} from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import * as apply from './lib/apply.js';
import * as cvlib from './lib/cv.js';
import * as github from './lib/github.js';
import {googleSecrets} from './lib/google-keys.js';
import * as runHistory from './lib/run-history.js';
import * as interviews from './lib/interviews.js';
import * as calltap from './lib/calltap.js';
import * as notion from './lib/notion.js';
import {cloudNextAt, nextAt, nextMailAt, startSchedule} from './lib/schedule.js';
import * as telegram from './lib/telegram.js';
import * as pipeline from './lib/pipeline.js';
import * as server from './lib/server.js';
import * as terminals from './lib/terminals.js';
import * as quitDialog from './lib/quit-dialog.js';
import * as review from './lib/review.js';
import * as sessionRuns from './lib/session-runs.js';
import {closeFormTab, listTabs, openFormTab, withOpenForm} from './lib/form-tab.js';
import * as strategy from './lib/strategy.js';
import * as questions from './lib/questions.js';
import {log as appLog, logTo} from './lib/log.js';
import * as viewCache from './lib/view-cache.js';
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

// Recent activity: Notion ⏱️ Search runs rows (run-history.js), refreshed every 15 s, and the jobs just sent to
// GitHub that haven't opened their row yet.
let notionRuns = null;
let pendingCloud = [];
const cloud = () => !!storage?.settings().cloud?.repo;

const here = path.dirname(fileURLToPath(import.meta.url));
// Demo mode (JOB_PILOTTO_DEMO=1, with JOB_PILOTTO_USER_DATA pointing at a copy of demo/): fictional
// profile and jobs for screenshots (scripts/screenshots.mjs). Nothing is contacted: no Python, Telegram,
// GitHub or local server, and the keys in demo/secrets.json are placeholders stored unencrypted.
const DEMO = !!process.env.JOB_PILOTTO_DEMO;
// Always on also gives the repo the Google sign-in (kept in the Keychain by the Python side, not the app's store).
github.setExtraSecrets(() => (DEMO ? {} : googleSecrets()));
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

// Theme (Settings → Appearance): 'system', 'light' or 'dark'. Electron's theme source makes the window's
// prefers-color-scheme follow it, so tokens.css switches; the window's own background matches (no flash).
// JOB_PILOTTO_THEME=light|dark forces one (screenshots of the dark screens in demo mode).
function applyTheme(value) {
  const theme = ['light', 'dark'].includes(value) ? value : 'system';
  nativeTheme.themeSource = theme;
  if (window && !window.isDestroyed()) window.setBackgroundColor(windowBackground());
  return theme;
}
function windowBackground() { return nativeTheme.shouldUseDarkColors ? '#0b1016' : '#eef3f7'; }

function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 640, title: 'Job Pilotto', show: !process.env.JOB_PILOTTO_SMOKE,
    backgroundColor: windowBackground(),
    webPreferences: {preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false},
  });
  // Demo mode can open another page of the app instead, e.g. the component gallery (npm run gallery).
  const page = DEMO && /^[a-z-]+\.html$/.test(process.env.JOB_PILOTTO_PAGE || '') ? process.env.JOB_PILOTTO_PAGE : 'index.html';
  window.loadFile(path.join(here, 'renderer', page));
  // Closed on the Mac, the app keeps running: forget the destroyed window so nothing calls into it.
  const opened = window;
  opened.on('closed', () => { if (window === opened) window = null; });
  // Smoke test of the in-app terminal (JOB_PILOTTO_PTY_SMOKE=<file>): a real pseudo-terminal runs a shell command;
  // its output (or the error) goes to the file. The Windows build checks it in the installed app.
  if (process.env.JOB_PILOTTO_PTY_SMOKE) {
    const out = process.env.JOB_PILOTTO_PTY_SMOKE;
    const [file, args] = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'echo pty-ok']] : ['/bin/sh', ['-c', 'echo pty-ok']];
    terminals.start({id: 'smoke', url: 'https://smoke', file, args, cwd: app.getPath('home'), env: process.env})
      .then(() => setTimeout(() => fs.writeFileSync(out, terminals.output('smoke') || 'no output'), 3000))
      .catch(error => fs.writeFileSync(out, `error: ${error.message}`));
  }
  // Smoke test (JOB_PILOTTO_SMOKE=<png path>): render hidden, save a screenshot, quit.
  if (process.env.JOB_PILOTTO_SMOKE) {
    window.webContents.once('did-finish-load', () => setTimeout(async () => {
      // JOB_PILOTTO_SMOKE_JS: clicks to run first, e.g. to screenshot a later wizard step.
      if (process.env.JOB_PILOTTO_SMOKE_JS) {
        await window.webContents.executeJavaScript(process.env.JOB_PILOTTO_SMOKE_JS);
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      // JOB_PILOTTO_SMOKE_RELOAD_JS: reload the window (⌘R), then run these steps (a bug that shows only after a reload).
      if (process.env.JOB_PILOTTO_SMOKE_RELOAD_JS) {
        await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.webContents.reload(); });
        await new Promise(resolve => setTimeout(resolve, 1500));
        await window.webContents.executeJavaScript(process.env.JOB_PILOTTO_SMOKE_RELOAD_JS);
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      // JOB_PILOTTO_SMOKE_EVAL: an expression evaluated in the window (window.__jp has its state); the result goes as
      // JSON to <JOB_PILOTTO_SMOKE>.json. Reading state is faster and exacter than looking at a picture.
      if (process.env.JOB_PILOTTO_SMOKE_EVAL) {
        const value = await window.webContents.executeJavaScript(`(async () => JSON.stringify(await (${process.env.JOB_PILOTTO_SMOKE_EVAL}), null, 2))()`)
          .catch(error => JSON.stringify({error: String(error.message || error)}));
        fs.writeFileSync(`${process.env.JOB_PILOTTO_SMOKE}.json`, value ?? 'null');
      }
      if (process.env.JOB_PILOTTO_SMOKE_NO_PICTURE) { app.quit(); return; }
      // JOB_PILOTTO_SMOKE_SELECTOR: only that element (and a small margin), e.g. for the website's close-ups.
      const selector = process.env.JOB_PILOTTO_SMOKE_SELECTOR;
      const rect = selector ? await window.webContents.executeJavaScript(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null;
        node.scrollIntoView({block: 'nearest'}); const r = node.getBoundingClientRect(), m = ${Number(process.env.JOB_PILOTTO_SMOKE_MARGIN ?? 12)};
        if (!r.width || !r.height) return null;
        return {x: Math.max(0, Math.floor(r.left - m)), y: Math.max(0, Math.floor(r.top - m)),
          width: Math.min(innerWidth, Math.ceil(r.width + 2 * m)), height: Math.min(innerHeight - Math.max(0, r.top - m), Math.ceil(r.height + 2 * m))};
      })()`) : null;
      if (selector && !rect) { console.error(`smoke: no element matches ${selector}`); app.quit(); return; }
      fs.writeFileSync(process.env.JOB_PILOTTO_SMOKE, (await (rect ? window.webContents.capturePage(rect) : window.webContents.capturePage())).toPNG());
      app.quit();
    }, 1500));
  }
  // Links open in the user's browser, never inside the app.
  window.webContents.setWindowOpenHandler(({url}) => { shell.openExternal(url); return {action: 'deny'}; });
}

// Every message to the window goes through here: a closed or crashed window is skipped, never a crash.
function toWindow(...args) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(...args);
}
const log = line => toWindow('log', line);

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
  const toast = hint => toWindow('toast', {title, body, hint});
  if (!Notification.isSupported() || notificationsBlocked) { toast(false); return; }
  const note = new Notification({title, body, silent: false});
  note.on('click', () => { window?.show(); window?.focus(); });
  note.on('failed', () => { const first = !notificationsBlocked; notificationsBlocked = true; toast(first); });
  note.show();
}

// Recent activity: Notion's run history merged with this Mac's own runs and the jobs just sent to GitHub.
function activity() {
  pendingCloud = pendingCloud.filter(job => Date.now() - job.id < 10 * 60000);
  const local = pipeline.runs(storage);
  const {runs, live, waiting} = notionRuns ? runHistory.merge(notionRuns, local, pendingCloud) : {runs: local, live: pendingCloud[0] || null, waiting: pendingCloud};
  pendingCloud = waiting;
  const settings = storage.settings();
  const cloud = cloudNextAt(settings);  // Always on: GitHub's schedule (the Mac's own is off then)
  return {runs, running: pipeline.running() || live, queued: pipeline.queued(), lastSearchAt: settings.lastSearchAt || null,
    nextSearchAt: nextAt(settings) ?? cloud.search, nextMailAt: nextMailAt(settings) ?? cloud.mail, nextScoutAt: cloud.scout,
    cloud: !!settings.cloud?.repo, historyLoaded: !!notionRuns};  // false until the run history was read from Notion
}

// While the app is open, every finished job is a notification, wherever it ran (this Mac, GitHub, a Telegram
// button): once per run. With the window in front the app shows it itself (its own pop-up), so no double.
const announced = new Set();
let announcing = false;
function announceRuns() {
  const {runs} = activity();
  if (!announcing) { runs.forEach(run => announced.add(run.id)); announcing = true; return; }  // history, not news
  for (const run of runs) {
    if (announced.has(run.id)) continue;
    announced.add(run.id);
    if (Date.now() - Date.parse(run.endedAt || run.startedAt) > 5 * 60000) continue;
    if (window?.isFocused()) continue;
    if (run.kind === 'prepare' && run.where === 'mac') continue;  // prepareKit gives its own ("Press Apply…")
    const note = runHistory.notice(run);
    if (note) notify(note.title, note.body);
  }
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
      const send = progress => toWindow('notionProgress', {...progress, titles});
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
  ipcMain.handle('saveContact', (_, contact) => contactDetails.save(storage, contact).then(saved => { server.contactSaved(storage, saved || contact); return {ok: true}; })
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
    const send = progress => toWindow('draftProgress', progress);
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
  // Rebuild from CV (setup done before): what the draft changes, grouped, with each group's impact and AI cost.
  ipcMain.handle('rebuildImpact', async (_, draft) => {
    try {
      const readJson = name => { try { return JSON.parse(storage.readText(`config/${name}`) || '{}'); } catch { return {}; } };
      const [{profile, answers}, facts] = await Promise.all([strategy.profileTexts(storage),
        pipeline.run(storage, ['src.desktop', 'strategy']).then(({stdout}) => JSON.parse(stdout.trim().split('\n').pop())).catch(() => ({counts: {}}))]);
      const groups = strategy.rebuildGroups({search: readJson('search.json'), preferences: readJson('preferences.json'), profile, answers},
        draft, {scored: facts.scored || 0, kits: facts.counts?.kits || 0});
      return {ok: true, groups};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // parts: the review's accepted groups (search, filters, profile, answers); null = everything (first setup).
  ipcMain.handle('saveStrategy', (_, draft, parts = null) => {
    const take = part => !parts || parts.includes(part);
    saving ||= (async () => {
      // Notion is required: the Profile, standard answers and contact details live only there.
      const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
      if (!token || !ids.NOTION_PROFILE_PAGE_ID) return {ok: false, error: 'Connect Notion first: your strategy is saved there.'};
      // Progress for the save window: each step starts, advances (blocks written) and finishes.
      const step = (name, extra = {}) => toWindow('saveProgress', {step: name, ...extra});
      // Replacing a strategy that was set up before: keep a copy of the current one in Notion first.
      if (storage.settings().setupDone) {
        step('snapshot');
        const when = new Date().toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
        await notion.snapshotStrategy(token, ids, when);
        step('snapshot', {finished: true});
      }
      // The daily target asked in the wizard goes on ⚙️ Search settings with the rest.
      const perDay = storage.settings().questionnaire?.applications_per_day;
      strategy.save(storage, {search: take('search') ? draft.search : null,
        preferences: !parts ? {...draft.preferences, daily_applications_target: strategy.clampTarget(perDay)} : take('filters') ? draft.preferences : null});
      step('local', {finished: true});
      const report = page => (done, total) => step(page, {done, total});
      // Contact details are a section of the Profile page: what's there stays, the CV's non-empty values win.
      const known = await contactDetails.read(storage).catch(() => ({}));
      const merged = {...known, ...Object.fromEntries(Object.entries(draft.contact || {}).filter(([, value]) => value))};
      const profile = draft.profile_markdown.trim() + (Object.keys(merged).length ? `\n\n${contactDetails.markdown(merged)}\n` : '\n');
      step('profile');
      if (take('profile')) await notion.writePage(token, ids.NOTION_PROFILE_PAGE_ID, profile, undefined, report('profile'));
      step('profile', {finished: true});
      step('answers');
      if (take('answers')) await notion.writePage(token, ids.NOTION_ANSWERS_PAGE_ID, draft.answers_markdown, undefined, report('answers'));
      step('answers', {finished: true});
      strategy.dropLocalCopies(storage);  // Notion has them now
      step('search');
      if (take('search') || take('filters')) await strategy.publishSearchSettings(storage, {run: pipeline.run, ensurePage: notion.ensurePage, writePage: notion.writePage});
      step('search', {finished: true});
      storage.saveSettings({setupDone: true});
      syncCv();  // the CV to the Profile page (Notion keeps every version)
      return {ok: true};
    })().catch(error => ({ok: false, error: `Couldn't write to Notion: ${error.message}`})).finally(() => { saving = null; });
    return saving;
  });
  ipcMain.handle('runs', () => activity());
  ipcMain.handle('runDetail', (_, pageId) => runHistory.detail(storage, pageId).catch(error => ({message: null, log: [`Not read from Notion: ${error.message}`]})));

  ipcMain.handle('checkMail', () => (storage.settings().cloud?.repo
    ? github.cloudDispatch(storage, log)({}, 'mail.yml').then(() => ({ok: true, cloud: true}))
    : pipeline.checkMail(storage, log, 'you').then(({ok, run}) => ({ok, run}))));
  // Right after setup: the first search, so the Jobs screen fills while the user watches.
  ipcMain.handle('firstSearch', () => (storage.settings().lastSearchAt || pipeline.running() ? {ok: true, skipped: true}
    : cloud() ? github.cloudDispatch(storage, log)({mode: 'run'}).then(() => ({ok: true, cloud: true}))  // background jobs run in one place
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
    return viewCache.remember(storage, 'jobs', result);
  });
  // The last good Jobs / Focus / Strategy read, shown at once while the fresh one loads (lib/view-cache.js).
  ipcMain.handle('cached', (_, name) => (DEMO ? null : viewCache.recall(storage, name)));
  ipcMain.handle('refresh', async () => {
    if (!storage.settings().cloud?.repo) return pipeline.refresh(storage, log, 'run', 'you');
    await github.cloudDispatch(storage, log)({mode: 'run'});
    return {ok: true, cloud: true};
  });
  // Always on: sign in to GitHub (code approved in the browser), then set up
  // the user's private repo. Also re-run after a key or setting changes ("Update").
  ipcMain.handle('cloudConnect', async (_, chosen = '') => {
    if (DEMO) return {ok: true, repo: storage.settings().cloud?.repo || 'alexmorgan/job-pilotto-private', existing: null,
      secrets: ['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], variables: []};  // never the real GitHub
    try {
      let token = storage.secret('GITHUB_TOKEN');
      if (!token) {
        const start = await github.startSignIn();
        toWindow('cloudStep', {code: start.userCode, url: start.url});
        shell.openExternal(start.url);
        token = await github.finishSignIn(start);
        storage.setSecret('GITHUB_TOKEN', token);
      }
      const result = await github.connect(storage, token, {repo: chosen, onStep: text => toWindow('cloudStep', {text})});
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
  // Telegram buttons, always on: the user's own Cloudflare Worker (lib/telegram-cloud.js).
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
      toWindow('telegramWaiting', bot.username);
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
  const COMMANDS = ['check', 'employers', 'run', 'today', 'applied', 'saved', 'insight', 'weekly', 'mail', 'scout', 'status', 'add', 'help'];
  ipcMain.handle('command', async (_, name, arg = '') => {
    if (!COMMANDS.includes(name)) return {text: 'Unknown command'};
    try { return await telegram.runCommand(storage, name, arg, log); } catch (error) { return {text: `⚠️ ${error.message}`}; }
  });
  // Jobs → Applied elsewhere: tracked like /add, but waited for, so the list shows it as Applied right away.
  ipcMain.handle('addApplied', async (_, url, when = '', details = {}) => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.'};
    if (!storage.secret('NOTION_TOKEN')) return {ok: false, text: 'Connect Notion first: applications are tracked there.'};
    try { return await pipeline.addApplied(storage, url, when, log, details || {}); } catch (error) { return {ok: false, text: error.message}; }
  });
  // Settings → Application profile → Standard answers (read from Notion) and the Strategy page's data.
  ipcMain.handle('standardAnswers', async () => {
    try { return {ok: true, groups: await questions.standardAnswers(storage)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('rescorePrevious', async () => {
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'rescore-previous']);
    return code === 0 ? {ok: true, ...JSON.parse(stdout.trim().split('\n').pop())} : {ok: false, error: 'Could not queue them (see the activity log)'};
  });
  ipcMain.handle('strategyData', async () => {
    // Demo mode: JOB_PILOTTO_DEMO_STRATEGY_DELAY ms first, to see (and screenshot) the loading state.
    if (DEMO && process.env.JOB_PILOTTO_DEMO_STRATEGY_DELAY) await new Promise(resolve => setTimeout(resolve, Number(process.env.JOB_PILOTTO_DEMO_STRATEGY_DELAY)));
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'strategy']);
    if (code !== 0) return {ok: false, error: 'Could not read your strategy (see the activity log)'};
    return viewCache.remember(storage, 'strategy', {ok: true, ...JSON.parse(stdout.trim().split('\n').pop())});
  });
  // Jobs → Log job activity → Paste image: the clipboard's image as PNG, or null.
  ipcMain.handle('clipboardImage', () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : {name: 'pasted-screenshot.png', type: 'image/png', data: image.toPNG().toString('base64')};
  });
  // Jobs → Recruiter message: a recruiter lead read by Claude, waited for so the list shows it.
  ipcMain.handle('addLead', async (_, text, talking = false, image = null, target = '') => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.'};
    if (!storage.secret('NOTION_TOKEN')) return {ok: false, text: 'Connect Notion first: recruiter leads are tracked there.'};
    if (!storage.secret('ANTHROPIC_API_KEY')) return {ok: false, text: 'Reading a message or screenshot needs your Anthropic API key (Settings).'};
    // Screenshots (up to 5) go to temporary files for the run (then to Notion, on the job's page), deleted after.
    const exts = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'};
    const shots = (Array.isArray(image) ? image : image ? [image] : []).filter(shot => exts[shot?.type]).slice(0, 5);
    const files = shots.map((shot, i) => path.join(app.getPath('temp'), `job-pilotto-shot-${Date.now()}-${i}${exts[shot.type]}`));
    try {
      shots.forEach((shot, i) => fs.writeFileSync(files[i], Buffer.from(String(shot.data), 'base64')));
      // Each step the engine reports ("⏳ …") shows in the Log box while it works.
      const onLine = line => { log(line); if (/^⏳/.test(line)) toWindow('leadStep', line.replace(/^⏳\s*/, '')); };
      return await pipeline.addLead(storage, String(text || ''), !!talking, onLine, {file: files.join(','), target: String(target || '')});
    } catch (error) { return {ok: false, text: error.message}; } finally { files.forEach(file => fs.rmSync(file, {force: true})); }
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
        if (Date.now() - last > 200) { last = Date.now(); toWindow('ivLevel', {id, level}); }
      });
      return {ok: true, startedAt};
    } catch (error) {
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('ivTranscribe', async (_, id, options) => {
    const meta = await interviews.transcribe(storage, id, options, step => toWindow('ivProgress', step));
    if (meta.status === 'ready') notify('Transcript ready', `${meta.title}: ${meta.pageId ? 'already in your Notion; ' : ''}name the speakers, pick the job, then Save.`);
    return meta;
  });
  ipcMain.handle('ivSaveDraft', (_, id, patch) => (DEMO ? true : interviews.saveDraft(storage, id, patch)));
  ipcMain.handle('ivDiscard', async (_, id) => (DEMO ? (interviews.discard(storage, id), true) : (await interviews.drop(storage, id)).ok));
  ipcMain.handle('ivSave', (_, id) => interviews.save(storage, id));
  ipcMain.handle('ivLink', (_, pageId, jobUrl) => interviews.link(storage, pageId, jobUrl));
  ipcMain.handle('ivReview', (_, pageId) => (cloud()
    ? github.cloudDispatch(storage, log)({mode: 'interview', interview: pageId}).then(() => ({ok: true, cloud: true,
      summary: 'Reviewing on GitHub: it shows in Recent activity, and the review lands on the interview in Notion.'}))
    : interviews.review(storage, pageId)));
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
        {onProgress: count => toWindow('exportProgress', count)}) : null;
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
  ipcMain.handle('setTheme', (_, value) => { const theme = applyTheme(value); storage.saveSettings({theme}); return theme; });
  ipcMain.handle('setAutomation', (_, patch) => {
    const allowed = {};
    if ('autoSearch' in patch) allowed.autoSearch = !!patch.autoSearch;
    if ('openAtLogin' in patch) { allowed.openAtLogin = !!patch.openAtLogin; app.setLoginItemSettings({openAtLogin: allowed.openAtLogin}); }
    return storage.saveSettings(allowed);
  });
  ipcMain.handle('setStatus', (_, url, status) => pipeline.setStatus(storage, url, status));
  // Focus: what to do next (Notion, no AI); Done on a reply logs a "Replied" event.
  // Demo mode: the fictional list in demo/focus.json (JOB_PILOTTO_DEMO_FOCUS_DELAY ms first, to see the loading state).
  ipcMain.handle('focus', async () => {
    if (!DEMO) return viewCache.remember(storage, 'focus', await pipeline.focus(storage));
    await new Promise(resolve => setTimeout(resolve, Number(process.env.JOB_PILOTTO_DEMO_FOCUS_DELAY) || 0));
    return {ok: true, focus: JSON.parse(fs.readFileSync(path.join(here, 'demo', 'focus.json'), 'utf8'))};
  });
  // The daily applications target lives on ⚙️ Search settings in Notion (Focus, Settings and the wizard set it).
  ipcMain.handle('dailyTarget', () => ({target: strategy.dailyTarget(storage), reminders: storage.settings().focusReminders !== false}));
  ipcMain.handle('setDailyTarget', async (_, value) => {
    if (DEMO) return {ok: true, target: strategy.clampTarget(value)};
    try {
      return {ok: true, target: await strategy.setDailyTarget(storage, value, {run: pipeline.run, ensurePage: notion.ensurePage, writePage: notion.writePage})};
    } catch (error) { return {ok: false, error: `Notion: ${error.message}. The target wasn't changed.`}; }
  });
  // Demo mode: a fictional history.
  const demoHistory = () => {
    const at = (days, hour) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 11) + `${String(hour).padStart(2, '0')}:10:00Z`;
    return {ok: true, items: [
      {at: at(0, 9), kind: 'Replied', emoji: '💬', title: 'Replied to Northwind Robotics', note: 'You answered (marked done in Focus)', url: ''},
      {at: at(1, 17), kind: 'insight', emoji: '💡', title: 'Insight: Useful', note: 'Location requirements may be limiting your applications', url: ''},
      {at: at(1, 11), kind: 'Feedback requested', emoji: '🙋', title: 'Asked Example Labs for feedback', note: '', url: ''},
      {at: at(3, 15), kind: 'Feedback skipped', emoji: '⏭️', title: 'Skipped asking Acme Robotics for feedback', note: '', url: ''}]};
  };
  // Interview prep kit (Focus → Prepare): runs here (you wait for it), steps shown in its dialog.
  ipcMain.handle('interviewPrep', (_, pageId) => {
    if (DEMO) return {ok: true, text: 'Prep kit ready (demo): nothing was written.'};
    if (!storage.secret('ANTHROPIC_API_KEY')) return {ok: false, text: 'The prep kit needs your Anthropic API key (Settings).'};
    // Its lines and result also go to logs/app.log (a failed kit left no trace before).
    return pipeline.interviewPrep(storage, String(pageId), line => {
      log(line);
      appLog('prep', line);
      if (/^⏳/.test(line)) toWindow('prepStep', line.replace(/^⏳\s*/, ''));
    }).then(result => { appLog('prep', `${pageId}: ${result?.ok ? 'ready' : 'failed'}`, {text: result?.text || result?.error}); return result; });
  });
  ipcMain.handle('describeJob', (_, pageId, text = '', url = '') => (DEMO ? {ok: true, text: 'Saved (demo).'}
    : pipeline.describeJob(storage, String(pageId), String(text || ''), String(url || ''))));
  // Where an email belongs: Focus → "Is this about …?", a job's ⋯ → Undo an email update (src/ai/reassign.py).
  ipcMain.handle('reassignEmail', (_, eventId, target) => (DEMO ? {ok: true, text: 'Moved (demo): nothing was written.'}
    : pipeline.reassignEmail(storage, String(eventId), String(target))));
  ipcMain.handle('emailUpdates', (_, pageId) => (DEMO ? {ok: true, items: []} : pipeline.emailUpdates(storage, String(pageId))));
  ipcMain.handle('focusHistory', () => (DEMO ? demoHistory() : pipeline.focusHistory(storage)));
  ipcMain.handle('focusDone', (_, pageId) => (DEMO ? {ok: true} : pipeline.focusDone(storage, String(pageId))));
  ipcMain.handle('feedbackAction', (_, pageId, action, text = '') => (DEMO ? {ok: true}
    : pipeline.feedbackAction(storage, String(pageId), String(action), String(text))));
  // A rejected job's menu → Why was I rejected? (also runs by itself after the Gmail check logs a rejection).
  ipcMain.handle('reviewRejection', async (_, url) => {
    if (DEMO) return {ok: true, text: 'Reviewed (demo): nothing was written.'};
    if (!storage.secret('ANTHROPIC_API_KEY')) return {ok: false, text: 'The review needs your Anthropic API key (Settings).'};
    try { return await pipeline.reviewRejection(storage, url, log); } catch (error) { return {ok: false, text: error.message}; }
  });
  ipcMain.handle('apply', async (_, options) => options?.mode === 'agents' && !(await claudeConsent())
    ? {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'} : apply.start(storage, options));
  ipcMain.handle('applyOne', (_, url) => apply.openOne(url));
  // A session started again from scratch: it stops and closes (outcome 'restarted' in its statistics), and a new
  // Apply with Claude session starts on the same job (its kit, a new conversation). The job stays Applying.
  // Cancel: Claude stops, the form tab closes (the extension closes it; else the Mac's scripting, on a confident match),
  // the job goes back to Kit ready in Notion, and the session goes (outcome 'Cancelled' in its statistics).
  ipcMain.handle('sessionCancel', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    const {message, detail, buttons} = quitDialog.cancel(old.company);
    const {response} = await dialog.showMessageBox(window && !window.isDestroyed() ? window : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 1, cancelId: 1, message, detail});
    if (response !== 0) return {ok: false, cancelled: true};
    terminals.stop(old.id);
    review.queueClose(old.id);
    const closed = (await review.delivered(old.id, 6000)) || await closeFormTab({url: old.url, company: old.company});
    const reset = DEMO ? {ok: true} : await pipeline.unapply(storage, old.url).catch(error => ({ok: false, error: error.message}));
    if (!reset.ok) return {ok: false, error: `Notion: ${reset.error || 'not updated'}. The session stays; try again.`, closed};
    terminals.setOutcome(old.id, 'cancelled');
    terminals.remove(old.id);
    return {ok: true, closed};
  });
  ipcMain.handle('sessionRestart', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    const {message, detail, buttons} = quitDialog.restart(old.company);
    const {response} = await dialog.showMessageBox(window && !window.isDestroyed() ? window : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 0, cancelId: 1, message, detail});
    if (response !== 0) return {ok: false, cancelled: true};
    if (!(await claudeConsent())) return {ok: false, error: 'Apply with Claude is off. Allow it in Settings.'};
    terminals.setOutcome(old.id, 'restarted');
    terminals.remove(old.id);
    return apply.claudeOne(storage, old.url, undefined, undefined, undefined, {title: old.title, company: old.company, location: old.location, workMode: old.workMode});
  });
  ipcMain.handle('applyWithClaude', async (_, url, details = null) => (await claudeConsent())
    ? apply.claudeOne(storage, url, undefined, undefined, undefined, details)
    : {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'});
  // Apply with Claude sessions inside the app (lib/terminals.js): the dock, the session page and its terminal.
  // Demo mode: fictional sessions (demo/sessions.json) for screenshots; nothing runs.
  const demoSessions = () => JSON.parse(fs.readFileSync(path.join(here, 'demo', 'sessions.json'), 'utf8'));
  ipcMain.handle('sessions', () => (DEMO ? demoSessions() : terminals.list()));
  const demoOutput = () => (process.env.JOB_PILOTTO_DEMO_OUTPUT ? fs.readFileSync(process.env.JOB_PILOTTO_DEMO_OUTPUT, 'utf8')  // a recorded session
    : '\x1b[2m19:10:02\x1b[0m \x1b[32m✓\x1b[0m Loaded the kit, Profile and answers from Notion\r\n\x1b[2m19:10:06\x1b[0m \x1b[32m✓\x1b[0m Opened the posting in Chrome\r\n' +
      '\x1b[2m19:10:09\x1b[0m \x1b[33m!\x1b[0m Location: San Francisco, CA · On-site\r\n\x1b[2m19:10:11\x1b[0m \x1b[35m⏸\x1b[0m Paused before opening the form. Waiting for your reply…\r\n\r\n\x1b[1m>\x1b[0m ');
  ipcMain.handle('sessionOutput', (_, id) => (DEMO ? demoOutput() : terminals.output(String(id))));
  // The log's screen when it opens (see terminals.snapshot); JOB_PILOTTO_DEMO_OUTPUT replays a recorded session in demo mode.
  ipcMain.handle('sessionSnapshot', (_, id) => (DEMO ? terminals.snapshotOf(demoOutput()) : terminals.snapshot(String(id))));
  ipcMain.handle('sessionWrite', (_, id, data) => terminals.write(String(id), data));
  ipcMain.handle('sessionResize', (_, id, cols, rows) => terminals.resize(String(id), Number(cols), Number(rows)));
  ipcMain.handle('sessionStop', (_, id) => terminals.stop(String(id)));
  ipcMain.handle('sessionResume', async (_, id) => (await claudeConsent()) ? apply.resumeSession(storage, String(id)) : {ok: false, error: 'Cancelled.'});
  ipcMain.handle('sessionRemove', (_, id) => terminals.remove(String(id)));
  // Removing a session whose job is still Applying: was it submitted? Notion first; the session goes only if that worked.
  ipcMain.handle('sessionFinish', async (_, id) => {
    const found = terminals.get(String(id));
    if (!found) return {ok: true};
    const {message, detail, buttons} = quitDialog.submitted(found.company);
    const {response} = await dialog.showMessageBox(window && !window.isDestroyed() ? window : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 0, cancelId: 2, message, detail});
    if (response === 2) return {ok: false, cancelled: true};
    const result = DEMO ? {ok: true} : response === 0 ? await pipeline.setStatus(storage, found.url, 'applied') : await pipeline.unapply(storage, found.url);
    if (result.ok) terminals.setOutcome(String(id), response === 0 ? 'submitted' : 'not submitted');  // its statistics, before it goes
    if (!result.ok) return {ok: false, error: result.error || 'Notion could not be updated.'};
    terminals.remove(String(id));
    return {ok: true, submitted: response === 0};
  });
  // At start: sessions left open (the app closed, or was killed) whose jobs are still Applying. Keep, ask one by one, or reset.
  ipcMain.handle('sessionsLeftOpen', async (_, ids) => {
    const all = (Array.isArray(ids) ? ids : []).map(id => terminals.get(String(id))).filter(Boolean);
    // A form still open in Chrome can be resumed as it is: kept without asking. Only the others are asked about.
    const open = DEMO ? new Set() : withOpenForm(all, await listTabs());
    terminals.markAsked([...open]);
    const found = all.filter(session => !open.has(session.id));
    if (!found.length) return {choice: 'keep', kept: open.size};
    const {message, detail, buttons} = quitDialog.leftOpen(found, session => session.company || terminals.label(session), open.size);
    const {response} = await dialog.showMessageBox(window && !window.isDestroyed() ? window : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 0, cancelId: 0, message, detail});
    terminals.markAsked(found.map(session => session.id));
    if (response !== 2) return {choice: response === 1 ? 'each' : 'keep', kept: open.size, asked: found.map(session => session.id)};
    const reset = [], failed = [];
    for (const session of found) {
      const result = DEMO ? {ok: true} : await pipeline.unapply(storage, session.url).catch(error => ({ok: false, error: error.message}));
      if (result.ok) { terminals.setOutcome(session.id, 'not submitted'); terminals.remove(session.id); reset.push(session.url); } else failed.push({url: session.url, error: result.error});
    }
    return {choice: 'reset', reset, failed, kept: open.size};
  });
  // The form page and this page in step (lib/review.js): what to track in the form, and "show me this field".
  ipcMain.handle('reviewStates', () => (DEMO ? JSON.parse(fs.readFileSync(path.join(here, 'demo', 'review.json'), 'utf8')) : review.allStates()));
  ipcMain.handle('reviewWatch', (_, id, items) => {
    appLog('review', `watch ${id}: ${(items || []).length} field(s)`, {labels: (items || []).map(item => String(item.label).slice(0, 60))});
    return review.setWatch(String(id), items);
  });
  // The extension first: the form page takes the request, brings its own tab forward and scrolls to the field (no
  // macOS permission needed, never the wrong tab). Only when no page answers does the app look for the tab itself.
  const showForm = async (id, label, url, company) => {
    review.queueFocus(String(id), String(label || ''));
    const taken = await review.delivered(String(id), 4000);  // the page checks in every 2 s
    const went = taken ? 'tab' : await openFormTab({url, company}, shell.openExternal);
    return {taken, went};
  };
  ipcMain.handle('reviewFocus', async (_, id, label, url, company) => {
    const {taken, went} = await showForm(id, label, url, company);
    const seen = server.extensionSeen(), latest = server.latestExtension();
    return {went, taken, extension: seen?.version || '', latest, outdated: !!(seen?.version && latest && seen.version !== latest)};
  });
  ipcMain.handle('unapplyJob', (_, url) => pipeline.unapply(storage, String(url)));
  ipcMain.handle('claudeReady', () => apply.claudeReady(storage));
  ipcMain.handle('claudePrereqs', async () => ({...apply.claudePrereqs(), inApp: await terminals.available()}));
  // Gmail and Calendar (read-only): replies and interviews, and sign-up confirmation emails for Apply with Claude.
  // The token lives in the Keychain, where the Python side (src/sources/google.py) reads it.
  ipcMain.handle('googleStatus', async () => {
    // Demo mode: the fictional user's account. The real check reads this Mac's Google sign-in (the Keychain, not the
    // demo folder), which put the owner's own address into the reference screenshots.
    if (DEMO) return {connected: true, email: 'alex.morgan@example.com'};
    const {stdout} = await pipeline.run(storage, ['src.sources.google', 'status']);
    try { return JSON.parse(stdout.trim().split('\n').pop()); } catch { return {connected: false}; }
  });
  ipcMain.handle('googleConnect', async () => {
    const lines = [];
    const {code} = await pipeline.run(storage, ['src.sources.google', 'auth'], line => lines.push(line));
    // Always on: the new sign-in goes to the GitHub repo too, so the Gmail check there can use it.
    if (code === 0 && cloud()) github.updateRepo(storage).catch(error => log(`Google sign-in not sent to GitHub: ${error.message}`));
    return code === 0 ? {ok: true} : {ok: false, error: lines.filter(line => !/^Opening|^https?:/.test(line)).slice(-1)[0] || 'Sign-in did not complete'};
  });
  ipcMain.handle('openTabs', () => server.openTabs());
  ipcMain.handle('extensionSeen', () => (server.extensionSeen() ? {...server.extensionSeen(), latest: server.latestExtension()} : null));
  // A failed Notion read is reported (not an empty list), so the section says why instead of disappearing.
  ipcMain.handle('openQuestions', () => (DEMO ? Promise.resolve(storage.settings().openQuestions || []) : questions.list(storage)).then(list => ({ok: true, list}), error => ({ok: false, error: error.message, list: []})));
  ipcMain.handle('answerQuestion', (_, questionKey, answer) => questions.answer(storage, questionKey, answer)
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // A session's ❓ fact, answered with one tick on the session page: saved to the standard answers page.
  ipcMain.handle('rememberAnswer', (_, question, answer) => (DEMO ? Promise.resolve({ok: true}) : questions.remember(storage, question, answer))
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // Saved keys as dots plus their last 4 characters, so Settings can show which key is stored (never the key).
  ipcMain.handle('secretHints', () => Object.fromEntries(['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY']
    .map(name => [name, storage.secret(name)]).filter(([, value]) => value).map(([name, value]) => [name, `${'•'.repeat(12)}${value.slice(-4)}`])));
  // The application kit: the form's questions (read from the ATS), an answer for each and a cover letter,
  // saved on the job's Notion Applications row (Stage Kit ready). Apply needs one.
  ipcMain.handle('prepareKit', async (_, code, name = 'this job') => {
    // With Always on, background jobs run in the user's GitHub repo: Recent activity
    // shows it starting, its progress and its result (its ⏱️ Search runs row); the job's row updates from Notion.
    if (cloud()) {
      await github.cloudDispatch(storage, log)({mode: 'prepare', job: code});
      return {ok: true, cloud: true};
    }
    // Quietly: the result comes as a notification (and the row's Apply), not as log output.
    const lines = [];
    const {code: exit} = await pipeline.run(storage, pipeline.dailyArgs(storage, {mode: 'prepare', job: code}), line => lines.push(line),
      pipeline.triggerEnv('you'));
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
  // "Open filled form": Chrome, switched to the form's tab (lib/form-tab.js).
  // "Open filled form": the session's form tab through the extension (an empty label: bring it forward, no scroll).
  ipcMain.handle('showBrowser', async (_, url, company, id) => (id ? (await showForm(id, '', url, company)).went : openFormTab({url, company}, shell.openExternal)));
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

// Started from a terminal that's since closed, writing a log line fails (EIO/EPIPE); that must never crash the app.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => {});

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
// Opened again while running: bring the window back, or a new one if it was closed.
app.on('second-instance', () => {
  if (!app.isReady()) return;
  if (!window) createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
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
  logTo(path.join(app.getPath('userData'), 'logs'));
  storage = createStorage(app.getPath('userData'), DEMO ? {encrypt: value => value, decrypt: value => value} : safeStorageCrypto(safeStorage));
  applyTheme(process.env.JOB_PILOTTO_THEME || storage.settings().theme);
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
  if (!DEMO) { terminals.persist(path.join(storage.dir, 'sessions.json')); terminals.restore(); }  // sessions of the last run
  // Each form's last state (ready to submit?), so a restart shows it before Chrome's tabs report again.
  if (!DEMO) review.persist(path.join(storage.dir, 'review-states.json'), terminals.list().map(session => session.id));
  // Each session's statistics on its Agent Runs row in Notion, a few seconds after each change (lib/session-runs.js).
  if (!DEMO) terminals.onStatus((view, session) => sessionRuns.schedule(session, () => ({
    call: (method, route, body) => notion.call(storage.secret('NOTION_TOKEN'), method, route, body),
    db: storage.settings().notionIds?.NOTION_AGENT_RUNS_DB,
    create: /^decided|^ended|^failed/.test(session.events?.at(-1)?.status || ''),
  }), page => { session.runPage = page; terminals.saveNow(); }));
  createWindow();
  terminals.onChange((event, payload) => toWindow('session', event, payload));
  server.setReviewHandler(payload => review.report(terminals.list(), payload));
  server.setOpenHandler(id => {
    if (!terminals.get(id)) return false;
    if (!window || window.isDestroyed()) createWindow();
    window.show();
    window.focus();
    app.focus({steal: true});
    toWindow('session', 'open', {id});
    return true;
  });
  review.setReporter(state => {
    appLog('review', `form ${state.id}: ${state.left}/${state.total} left, ${Object.keys(state.states || {}).length} watched field(s) seen`, {states: state.states});
    toWindow('review', state);
  });
  server.setSessionReporter((id, info) => {
    const {session, needsYou} = terminals.report(id, info);
    if (session && needsYou) sessionNeedsYou(session);
  });
  if (!DEMO) {
    // User data left on this Mac -> Notion (source of truth), once. It runs while the window loads, so the
    // window reads again what moved (e.g. open questions read before they reached Notion looked like none).
    migrate.run(storage, log).then(moved => { if (moved.length) toWindow('moved', moved); });
    syncCv();
    // Recent activity from Notion ⏱️ Search runs (every run's row, wherever it ran), every 15 s.
    let notionTimer;
    const readRuns = async () => {
      clearTimeout(notionTimer);
      let busy = false;
      try { notionRuns = await runHistory.list(storage); } catch (error) { busy = error.status === 429; log(`Run history not read from Notion: ${error.message}`); }
      notionTimer = setTimeout(readRuns, busy ? 60000 : 15000);  // Notion busy: this poll steps back for a minute
    };
    readRuns();
    // A job sent to GitHub: "Starting on GitHub…" until its row appears (it's read again sooner than usual).
    github.onDispatch(({workflow, inputs}) => {
      const mode = workflow === 'mail.yml' ? 'mail' : workflow === 'scout.yml' ? 'scout' : inputs.mode || 'scheduled';
      const kind = {scheduled: 'search', run: 'search'}[mode] || mode;
      pendingCloud.push({id: Date.now(), mode, kind, live: true, where: 'github', trigger: 'you', startedAt: new Date().toISOString(), step: 'Starting on GitHub…'});
      setTimeout(readRuns, 20000);
    });
    // The repo's workflow files follow this version of the app (e.g. a new input), unchanged files untouched;
    // keys kept outside the app's store (the Google sign-in) go along.
    if (cloud()) github.updateRepo(storage).then(changed => changed.length && log(`Updated in your GitHub repo: ${changed.join(', ')}`),
      error => log(`GitHub repo not updated: ${error.message}`));
    const backupIfDue = () => { if (storage.settings().setupDone && backup.due(storage.settings())) backupNow(); };
    backupIfDue();
    setInterval(backupIfDue, 6 * 3600 * 1000);
    restartTelegram();
    // On the chosen schedule while the app is open (the digest goes to Telegram when there's something new).
    // Searches: a notification a minute before one starts; every finished run: announceRuns (every 5 s).
    startSchedule(storage, {
      // Their notifications come from announceRuns, like every run's (wherever it ran).
      search: () => pipeline.refresh(storage, log, 'scheduled', 'schedule'),
      mail: () => pipeline.checkMail(storage, log, 'schedule'),
      scout: () => pipeline.scout(storage, log, 'schedule'),
    }, powerMonitor, {soon: () => notify('Checking for new jobs in 1 minute', 'Your scheduled check for new jobs is about to run.')});
    setInterval(announceRuns, 5000);
    setTimeout(resumeQueue, 20 * 1000);  // after the schedule's own catch-up check has queued what's due
  }
  if (!DEMO) setInterval(() => focusReminder().catch(() => {}), 5 * 60 * 1000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

// Focus reminders at 11:00, 15:00 and 19:00 (this Mac's time), once per slot: a notification and a Telegram
// message when someone waits for an answer, an interview is close, or today's applications are behind the target.
const FOCUS_HOURS = [11, 15, 19];
async function focusReminder(now = new Date()) {
  const settings = storage.settings();
  if (!settings.setupDone || settings.focusReminders === false) return;
  const slot = FOCUS_HOURS.filter(hour => now.getHours() >= hour).pop();
  if (slot == null) return;
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${slot}`;  // local day
  if (settings.lastFocusReminder === key) return;
  storage.saveSettings({lastFocusReminder: key});
  const text = await pipeline.focusReminder(storage, true);
  if (text) notify('Focus: what to do next', text);
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Jobs you started that were running or waiting when the app quit (pipeline queue.json) start again. The
// schedule's own (searches, Gmail checks) aren't: its catch-up runs whatever is due anyway.
function resumeQueue() {
  const cloud = !!storage.settings().cloud?.repo;  // searches and Gmail checks then run in the GitHub repo
  const jobs = pipeline.takeQueue(storage).filter(job => job.trigger !== 'schedule' && !(cloud && ['search', 'mail'].includes(job.kind)));
  for (const job of jobs) {
    const failed = error => log(`${pipeline.taskName(job.kind)} failed: ${error.message}`);
    if (job.kind === 'search') pipeline.refresh(storage, log, job.resume.mode || 'run', 'you').catch(failed);
    else if (job.kind === 'mail') pipeline.checkMail(storage, log, 'you').catch(failed);
    else if (pipeline.TASKS[job.kind] && Array.isArray(job.resume.args)) pipeline.task(storage, job.kind, job.resume.args, log, 'you').catch(failed);
  }
  if (jobs.length) {
    notify(`Picking up ${jobs.length} job${jobs.length === 1 ? '' : 's'} from before you quit`,
      jobs.map(job => pipeline.taskName(job.kind)).join(', '));
  }
}

// A Claude session waits for you: a notification (a click opens that session in the app) and a Telegram message.
function sessionNeedsYou(session) {
  const what = terminals.label(session);
  const text = session.brief || 'Claude needs your input';  // one plain sentence; the whole message is on the session page
  if (!process.env.JOB_PILOTTO_SMOKE && Notification.isSupported()) {
    const note = new Notification({title: `Needs your input · ${what}`, body: text});
    note.on('click', () => { window?.show(); window?.focus(); toWindow('session', 'open', {id: session.id}); });
    note.show();
  }
  toWindow('toast', {title: `Needs your input · ${what}`, body: text});
  const token = storage.secret('TELEGRAM_BOT_TOKEN'), chat = storage.settings().telegramChatId;
  if (token && chat) telegram.api(token, 'sendMessage', {chat_id: chat, text: `🧭 Needs your input · ${what}\n${text}\n\nAnswer it in Job Pilotto → Application sessions.`})
    .catch(error => log(`Telegram: ${error.message}`));
}
// Sessions still running when the app quits end with it (a Claude session can't outlive its terminal).
// Their state is saved first and stays as it was: the sessions come back at the next start (terminals.restore).
app.on('will-quit', () => terminals.shutdown());

// Quitting while something runs or waits: ask. "Quit when done" closes the app once the queue is empty;
// "Quit now" stops the running job cleanly and keeps the queue for next time (resumeQueue).
let quitting = false;
app.on('before-quit', event => {
  if (quitting || DEMO || process.env.JOB_PILOTTO_SMOKE) return;
  const busy = pipeline.running(), queue = pipeline.queued();
  // Claude sessions actively working. One waiting for you (a question, a filled form) is kept as it is: it comes
  // back at the next start, and Resume reopens its conversation.
  const sessions = terminals.running().filter(session => session.status === 'running');
  if (!busy && !queue.length && !sessions.length) return;
  event.preventDefault();
  const label = session => session.company || terminals.label(session);
  const icon = nativeImage.createFromPath(path.join(here, 'assets', 'icon.png'));
  if (!busy && !queue.length) {  // only sessions: keep them, or stop them and quit
    const {message, detail, buttons} = quitDialog.sessionsOnly(sessions, label);
    const choice = dialog.showMessageBoxSync(BrowserWindow.getAllWindows()[0], {type: 'none', icon, buttons, defaultId: 0, cancelId: 0, message, detail});
    if (choice === 0) { window?.show(); toWindow('session', 'open', {id: sessions[0].id}); return; }
    quitting = true;
    app.quit();
    return;
  }
  const {message, detail, buttons} = quitDialog.working({busy, queue, sessions, label, taskName: pipeline.taskName});
  const choice = dialog.showMessageBoxSync(BrowserWindow.getAllWindows()[0], {type: 'none', icon, buttons, defaultId: 0, cancelId: 2, message, detail});
  if (choice === 2) return;
  quitting = true;
  if (choice === 1) {
    pipeline.freezeQueue(storage);
    pipeline.stopRunning();
    app.quit();
    return;
  }
  notify('Job Pilotto will quit when done', what);
  pipeline.whenIdle().then(() => app.quit());
});
