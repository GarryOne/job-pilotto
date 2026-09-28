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
    try { return interviews.add(storage, picked.filePaths[0]); } catch (error) { return {error: error.message}; }
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
    if (meta.status === 'ready') notify('Transcript ready', `${meta.title}: name the speakers, pick the job, save it to Notion.`);
    return meta;
  });
  ipcMain.handle('ivSaveDraft', (_, id, patch) => (DEMO ? true : interviews.saveDraft(storage, id, patch)));
  ipcMain.handle('ivDiscard', (_, id) => { interviews.discard(storage, id); return true; });
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
  ipcMain.handle('apply', (_, options) => apply.start(storage, options));
  ipcMain.handle('applyOne', (_, url) => apply.openOne(url));
  ipcMain.handle('applyWithClaude', (_, url) => apply.claudeOne(storage, url));
  ipcMain.handle('claudeReady', () => apply.claudeReady(storage));
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
  ipcMain.handle('openQuestions', () => storage.settings().openQuestions || []);
  ipcMain.handle('answerQuestion', async (_, questionKey, answer) => {
    const q = (storage.settings().openQuestions || []).find(item => item.key === questionKey);
    if (!q) return {ok: false, error: 'Already answered'};
    if (answer) {
      const token = storage.secret('NOTION_TOKEN'), page = storage.settings().notionIds?.NOTION_ANSWERS_PAGE_ID;
      if (!token || !page) return {ok: false, error: 'Connect Notion first: answers are saved in your standard answers page.'};
      try { await notion.appendAnswer(token, page, q.question, answer); } catch (error) { return {ok: false, error: `Notion: ${error.message}`}; }
    }
    questions.close(storage, questionKey, !!answer);
    return {ok: true};
  });
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
      let feedback = '', result, applied, printed;
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await cvlib.tailor(storage, job, key, {feedback});
        cost += answer.usd;
        result = answer.result;
        applied = cvlib.applyTailoring(base, result, storage.readText('profile.md'));
        printed = await printPdf(cvlib.writeHtml(storage, applied.cv, `${code}.html`));
        if (!printed.overflow.length) break;
        feedback = `Your last version didn't fit on page ${printed.overflow.join(', ')}: make the bullets on that page shorter or drop one, so it fits.`;
        if (attempt === 1) applied.warnings.push(`Page ${printed.overflow.join(', ')} is too full and its end is cut off: tailor again, or shorten it by hand.`);
      }
      const record = {job: {code, title: job.title, company: job.company, url: job.url}, createdAt: new Date().toISOString(),
        model: cvlib.MODEL, usd: Math.round(cost * 100) / 100, changes: result.changes, warnings: applied.warnings, cv: applied.cv, review: applied.review, result};
      cvlib.save(storage, code, record, printed.pdf);
      notify('Tailored CV ready ✓', `${name}: ${result.changes.length} changes${applied.warnings.length ? `, ${applied.warnings.length} to check` : ''}.`);
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
