// Job Pilotto desktop app: a local-first cockpit for the job search. Data and keys stay on this Mac.
import {app, BrowserWindow, clipboard, crashReporter, Menu, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, Notification, powerMonitor, safeStorage, session, shell, systemPreferences} from 'electron';
import {smallCopy} from './lib/shots.js';
import {recordIpc} from './lib/e2e-ipc.js';
import {hideWindows} from './lib/e2e-hidden.js';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import * as apply from './lib/apply.js';
import * as claudeSession from './lib/claude-session.js';
import {claimInstance, startWhenReady, installQuitHandling} from './lib/lifecycle.js';
import * as critical from './lib/critical.js';
import * as pageRender from './lib/page-render.js';
import {registerSessionHandlers} from './lib/session-handlers.js';
import * as cvlib from './lib/cv.js';
import * as cvLook from './lib/cv-look.js';
import * as cvCheck from './lib/cv-check.js';
import * as matchCheck from './lib/match-check.js';
import * as letters from './lib/cover-letter.js';
import * as github from './lib/github.js';
import * as updater from './lib/updater.js';
import * as telemetryLib from './lib/telemetry.js';
import * as poolShare from './lib/pool-share.js';
import {shouldNotify} from './lib/needs-you.js';
import * as reminders from './lib/interview-reminders.js';
import * as engineLog from './lib/engine-log.js';
import * as requestLog from './lib/request-log.js';
import * as notifyWatch from './lib/notify-watch.js';
import {GOOGLE_KEYCHAIN, googleSecrets} from './lib/google-keys.js';
import * as runHistory from './lib/run-history.js';
import * as targets from './renderer/targets.js';
import * as goals from './lib/goals.js';
import {clearlyTechnical} from './renderer/audience.js';   // pure (no DOM), the same rule as src/coverage.py   // pure (no DOM), shared with the window
import * as interviews from './lib/interviews.js';
import * as calltap from './lib/calltap.js';
import * as notion from './lib/notion.js';
import {cloudNextAt, nextAt, nextMailAt, startSchedule} from './lib/schedule.js';
import {e2eMs} from './lib/e2e-timing.js';
import {askResume, resumeDelay, scheduleResume} from './lib/resume-queue.js';
import * as telegram from './lib/telegram.js';
import * as pipeline from './lib/pipeline.js';
import {watchOrphans} from './lib/orphans.js';
import * as server from './lib/server.js';
import * as fewJobs from './lib/few-jobs.js';
import * as visits from './lib/visits.js';
import * as extensionInstall from './lib/extension-install.js';
import * as terminals from './lib/terminals.js';
import * as transcript from './lib/transcript.js';
import {offerMove} from './lib/applications.js';
import * as appMenu from './lib/app-menu.js';
import * as appFeedback from './lib/app-feedback.js';
import * as aiTrial from './lib/ai-trial.js';
import * as claudeCode from './lib/claude-code.js';
import * as setupFunnel from './lib/setup-funnel.js';
import * as devMarker from './lib/dev-marker.js';
import {sharedCheck} from './lib/shared-check.js';
import * as pendingLicense from './lib/pending-license.js';
import * as installSource from './lib/install-source.js';
import * as review from './lib/review.js';
import * as sessionRuns from './lib/session-runs.js';
import {mergeTabs, openFormTab, reloadFormTab, withOpenForm} from './lib/form-tab.js';
import * as backgroundChrome from './lib/background-chrome.js';
import * as strategy from './lib/strategy.js';
import * as questions from './lib/questions.js';
import {log as appLog, logFile, logTo} from './lib/log.js';
import {watchSleep} from './lib/awake.js';
import {versionLine, watchWindow} from './lib/window-log.js';
import * as viewCache from './lib/view-cache.js';
import * as migrate from './lib/migrate.js';
import * as reset from './lib/reset.js';
import * as files from './lib/files.js';
import * as backup from './lib/backup.js';
import * as cvChange from './lib/cv-change.js';
import * as notionGate from './lib/notion-gate.js';
import * as notionOAuth from './lib/notion-oauth.js';
import * as notionWorkspace from './lib/notion-workspace.js';
import * as contactDetails from './lib/contact.js';
import * as learnedAnswers from './lib/learned.js';
import * as misses from './lib/misses.js';
import * as controlEvents from './lib/control-events.js';
import * as recipeLibrary from './lib/recipes.js';
import * as analyticsConfig from './lib/analytics-config.js';
import * as analyticsLib from './lib/analytics.js';
import * as sentryLib from './lib/sentry.js';
import {installId as telemetryInstallId} from './lib/app-feedback.js';
import * as applicationOutcomes from './lib/outcomes.js';
import * as benchmarkLib from './lib/benchmarks.js';
import * as aliasLibrary from './lib/aliases.js';
import {flowState, leftCounts, missedQuestions, submitCounts, unplaced} from './lib/question-labels.js';
import {createStorage, safeStorageCrypto, SECRET_NAMES} from './lib/storage.js';
import {cleanSecret} from './lib/secrets.js';
import {fileURLToPath} from 'node:url';
import * as telegramCloud from './lib/telegram-cloud.js';
import * as licenseLib from './lib/license.js';
import * as demo from './lib/demo.js';
import * as intelLib from './renderer/intel.js';
import * as sharedLog from './lib/shared-log.js';

// Recent activity: Notion ⏱️ Search runs rows (run-history.js), refreshed every 15 s, and the jobs just sent to
// GitHub that haven't opened their row yet.
let notionRuns = null;
let pendingCloud = [];
const cloud = () => !!storage?.settings().cloud?.repo;
let telemetry = null;  // technical reports (lib/telemetry.js), made once storage exists
let analytics = null;  // usage events (lib/analytics.js, PostHog); crash reports (lib/sentry.js) have the same gate and switch as telemetry
let trail = null;  // lib/sentry.js note(): the last steps, attached to the next crash report
const track = (event, props) => { analytics?.track(event, props); trail?.(event, props); };
let recipeReporterRef = null;  // the batched, anonymous product counts (lib/recipes.js), made when the app is ready
let license = null;  // the free allowance and license keys (lib/license.js), made once storage exists
const HEALTH_VERSION = 5;  // bump when the daily health line gets new fields (2: outcome counts, 3: runsOk/runsFailed, 4: allowance, 5: licenseId)
// Where the user stands (demo mode: a fixed fictional state for screenshots).
const licenseState = () => (DEMO ? {licensed: false, license: null, keyProblem: '', used: 12, limit: 40, daysLeft: 41, ended: false} : license.state());
// Guard for what starts NEW work (Prepare kit, Fill in Chrome / Apply with Claude, manual searches): once the free allowance
// is over and there is no key, the window says so and the action answers with why. Never used for what is already under way.
function allowanceBlock() {
  const over = DEMO ? null : license.blocked();
  if (!over) return null;
  toWindow('allowance', over);
  return {ok: false, allowance: true, error: 'The free allowance is over. Paste a license key in Settings → License to keep starting new applications.'};
}
// Jobs read in Chrome that match the search are scored now, by a search started at once (owner, 7 Oct 2026: "Read 5 jobs, but my Jobs count
// never grows": they waited for the next scheduled check). Pages read in Chrome stay on this Mac, so with Always on they wait for a local search.
const readSites = new Map();   // Read with Claude session id -> the addresses it reads
function scoreVisitJobs(fits, by) {
  if (!fits || allowanceBlock()) return;
  // A light run that reads only the pages read in Chrome (src/daily.py --only-visits), first in the queue: about a minute, not a full search
  // behind a long Find new employers (owner, 7 Oct 2026: "why is Find new employers needed?"). With Always on too: those pages stay on this Mac.
  appLog('visit', 'scoring the jobs read in Chrome now, first in the queue', {fits, by});
  pipeline.scoreVisits(storage, log);
}
// Once a day: version, OS, which features are on (never keys), a few counts, so reports can be read in context.
function healthOnce() {
  // Once a day, and again the same day when the line's content changed (HEALTH_VERSION), so new counts arrive at once.
  const settings = storage.settings(), today = `${new Date().toISOString().slice(0, 10)}|${HEALTH_VERSION}`;
  if (!telemetry?.enabled() || settings.telemetryHealthAt === today) return;
  storage.saveSettings({telemetryHealthAt: today});
  const has = name => !!storage.secret(name);
  telemetry.record('health', {ai: has('ANTHROPIC_API_KEY'), aiEngine: claudeCode.engine(settings, has('ANTHROPIC_API_KEY')) || 'none', notion: has('NOTION_TOKEN'), telegram: has('TELEGRAM_BOT_TOKEN'),
    serpapi: has('SERPAPI_API_KEY'), alwaysOn: !!settings.cloud?.repo, theme: settings.theme || 'light',
    sessions: terminals.list().length, runsKept: pipeline.runs(storage).length, ...outcomes(settings), ...allowanceHealth(), ...telemetry.takeRuns()});
}
// The allowance on the health line, to measure it: licensed or not, the license kind and its random id (never the
// name: only the owner can map an id to a person, in his private Notion 🔑 Licenses via tools/license.py sync),
// applications used, days left, and whether the free allowance has ended.
function allowanceHealth() {
  const state = licenseState();
  return {licensed: state.licensed, licenseKind: state.license?.kind || 'none', licenseId: state.license?.id || '', applicationsUsed: state.used, freeDaysLeft: state.daysLeft, allowanceEnded: state.ended};
}
// How much Job Pilotto helped, as anonymous counts (no company, no job title): open matches and good fits, forms the
// extension filled, and the funnel (ever reached: applied, a human reply, screening, interviews, offers). From the
// last Jobs and Focus reads (lib/view-cache.js), so nothing extra is read from Notion.
function outcomes(settings) {
  const jobs = viewCache.recall(storage, 'jobs')?.result?.jobs || [];
  const steps = viewCache.recall(storage, 'focus')?.result?.focus?.funnel?.steps || [];
  const reached = name => steps.find(step => step.step.includes(name))?.reached ?? null;
  return {matches: jobs.length, goodFits: jobs.filter(job => job.fit >= 70).length, formsFilled: settings.formsFilled || 0,
    prepared: reached('Prepared'), applied: reached('Applied'), replies: reached('Human reply'), screenings: reached('Screening'),
    interviews: reached('Interviews'), offers: reached('Offer')};
}
let updateOffer = null;  // the newer stable release, when there is one (lib/updater.js)
let updateCheckedAt = null;  // the last check that reached GitHub (Settings → Diagnostics shows it)
let staleWarned = '';  // the extension version already reported as stale in the log (once per version)
// Running from source (npm start): never offer or install an update. It would quit the dev app and open the
// downloaded one in its place. From source, updating is `git pull` + restart.
const FROM_SOURCE = !app.isPackaged;
const betaOn = () => storage.settings().betaChannel === true;   // opt-in, off by default (Settings → Diagnostics → Beta)
// A tester: the person switched the beta on (versions are plain X.Y.Z since 0.5: the channel says how proven a build is).
const testerOn = betaOn;
// The tester's run-log switch. Saved as `alphaLogs` before 0.5: that choice still counts until the switch is touched.
const testerLogsOn = () => { const s = storage.settings(); return (s.testerLogs ?? s.alphaLogs) === true; };
async function checkForUpdate(asked = false) {
  // From source there is nothing to update, except under the e2e's fake release server (JOB_PILOTTO_E2E_UPDATES_URL): the update flow is tested on the real check.
  if (FROM_SOURCE && !(process.env.JOB_PILOTTO_E2E && process.env.JOB_PILOTTO_E2E_UPDATES_URL)) return asked ? {ok: true, offer: null, current: app.getVersion(), fromSource: true} : null;
  try {
    updateOffer = await updater.check(app.getVersion(), {channel: betaOn() ? 'beta' : 'stable'});
    updateCheckedAt = new Date().toISOString();
    if (updateOffer) { appLog('update', `available: ${updateOffer.version}`); toWindow('update', updateOffer); }
    return {ok: true, offer: updateOffer, current: app.getVersion()};
  } catch (error) {
    return {ok: false, text: `Couldn't check for updates: ${error.message}`, current: app.getVersion()};
  }
}
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu.template({name: app.name, mac: process.platform === 'darwin',
    checkForUpdates: checkForUpdatesNow,
    sendFeedback: () => { if (window && !window.isDestroyed()) { window.show(); toWindow('openFeedback'); } },
    find: what => toWindow('find', what)})));
}

// Setup funnel (lib/setup-funnel.js): the furthest step each install reached, sent at once so a quit mid-setup still counts.
function trackSetup(patch, before) {
  const event = setupFunnel.track(patch, before);
  if (!event) return;
  if (event.step !== 'done') storage.saveSettings({setupFurthest: event.step});
  if (telemetry) { telemetry.record('setup', event); telemetry.flush(); }
  track('setup_step', {step: event.step, minutes: event.minutes});
}

async function installUpdate() {
  if (FROM_SOURCE) return {ok: false, text: 'Running from source (npm start): update with git pull, then restart.'};
  if (!updateOffer) return {ok: false, text: 'No update to install.'};
  try {
    appLog('update', `install ${updateOffer.version} over ${app.getVersion()}: started`);
    await updater.install(updateOffer, {exe: app.getPath('exe'), logFile: logFile(),
      onStep: text => { appLog('update', `install ${updateOffer.version}: ${text}`); toWindow('updateStep', text); },
      quit: () => { appLog('update', `install ${updateOffer.version}: quitting so the new version can be put in place`); app.quit(); }});  // the quit dialog still asks if a job runs; the swap waits for the app to close
    return {ok: true};
  } catch (error) {
    appLog('update', `install failed: ${error.message}`);
    return {ok: false, text: error.message, url: updateOffer.url};
  }
}
// Menu → Check for Updates…: always answers (up to date, an update to install, or why it couldn't check).
async function checkForUpdatesNow() {
  const shown = appMenu.answer(await checkForUpdate(true), app.getVersion());
  const parent = window && !window.isDestroyed() ? window : undefined;
  const {response} = await dialog.showMessageBox(parent, {type: shown.type, message: shown.message, detail: shown.detail,
    buttons: shown.buttons, defaultId: 0, cancelId: shown.buttons.length - 1});
  if (!shown.install || response !== 0) return;
  const result = await installUpdate();
  if (!result.ok) dialog.showMessageBox(parent, {type: 'warning', message: 'The update didn\'t install', detail: result.text, buttons: ['OK']});
}

const here = path.dirname(fileURLToPath(import.meta.url));
// Demo mode (JOB_PILOTTO_DEMO=1, with JOB_PILOTTO_USER_DATA pointing at a copy of demo/): fictional
// profile and jobs for screenshots (scripts/screenshots.mjs). Nothing is contacted: no Python, Telegram,
// GitHub or local server, and the keys in demo/secrets.json are placeholders stored unencrypted.
// "Look around first" (setup wizard, lib/demo.js) starts it too, with --job-pilotto-demo=<a fresh copy of demo/>:
// the same, plus the banner with "Set up my own", and the actions that would reach outside answer "demo".
const DEMO_FOLDER = demo.folderFrom(process.argv);
const LOOK_AROUND = !!DEMO_FOLDER;
const DEMO = !!process.env.JOB_PILOTTO_DEMO || LOOK_AROUND;
const JOBS_PAGE = 200;   // the Jobs list's first page; each "Show more" adds 500
let jobsLimit = JOBS_PAGE;
const HIDDEN = hideWindows({app, BrowserWindow, shell});   // an e2e run: windows never show or take focus (lib/e2e-hidden.js)
pipeline.setDemo(DEMO);  // Python: only the jobs that read the demo folder
// Always on also gives the repo the Google sign-in (kept in the Keychain by the Python side, not the app's store).
github.setExtraSecrets(() => (DEMO ? {} : googleSecrets()));
// The user's repo runs this app's own release of the code (a source checkout: main), so both update together.
github.setEngineRef(app.isPackaged ? `desktop-v${app.getVersion()}` : 'main');
// Version shown in the About box and the sidebar. build-info.json is written by the packaged build
// (scripts/stage.mjs --app); without it this is a development copy (npm start).
const buildInfo = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'build-info.json'), 'utf8')); } catch { return null; } })();
const about = {version: app.getVersion(), build: buildInfo?.build || null, commit: buildInfo?.commit || null, dev: !app.isPackaged && !DEMO,
  label: DEMO ? app.getVersion() : buildInfo ? `${app.getVersion()} (build ${buildInfo.build}, ${buildInfo.commit})` : `${app.getVersion()} (development)`};
let storage;
let window;
// AI steps can run: the user chose their own Claude Code, or saved an API key (lib/claude-code.js).
const aiReady = () => claudeCode.aiReady(storage.settings(), !!storage.secret('ANTHROPIC_API_KEY'));
let polling = null;

function restartTelegram() {
  polling?.stop();
  polling = telegram.startPolling(storage, log, undefined, dispatchNote);
}

// Notion inside the app: its own window (Notion refuses to be shown in an iframe). The session is kept
// (partition persist:notion), so the user signs in to Notion once; links to other sites open in the browser.
let notionWindow = null;
function openNotion(url) {
  if (!/^https:\/\/(www\.)?notion\.(so|site)\//.test(url)) return shell.openExternal(url);
  if (!notionWindow || notionWindow.isDestroyed()) {
    notionWindow = new BrowserWindow({width: 1280, height: 860, title: 'Notion · Job Pilotto', show: !HIDDEN,
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
  const windowTitle = devMarker.title(!app.isPackaged && !DEMO, app.isPackaged ? '' : devMarker.branch(here));
  window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 640, title: windowTitle, show: !process.env.JOB_PILOTTO_SMOKE && !HIDDEN,
    backgroundColor: windowBackground(),
    webPreferences: {preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: !HIDDEN},   // hidden e2e window: still animates, so Playwright's clicks don't wait
  });
  watchWindow(window.webContents, {log: appLog});   // load time, load failures, crashes, freezes, page errors, a blank window
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(windowTitle); });
  // Demo mode can open another page of the app instead, e.g. the component gallery (npm run gallery).
  const page = DEMO && /^[a-z-]+\.html$/.test(process.env.JOB_PILOTTO_PAGE || '') ? process.env.JOB_PILOTTO_PAGE : 'index.html';
  window.loadFile(path.join(here, 'renderer', page));
  // Closed on the Mac, the app keeps running: forget the destroyed window so nothing calls into it.
  const opened = window;
  opened.on('closed', () => { appLog('window', 'main: closed'); if (window === opened) window = null; });
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
const log = line => { if (pipeline.isDataLine(line)) return; pipeline.keep(line); toWindow('log', line); };   // JSON answers are for the app, not the window   // a running task keeps what the window was shown (lib/pipeline.js keep)

// Every cloud run this app starts is written to its own log, with the caller named at the call site: a dispatch
// spends money and time on GitHub, and two runs 38 s apart for one interview could not be told apart afterwards
// without it (1 Oct 2026). Lines: `start <caller> → <workflow> (<mode>) #<digest> in <repo>`, then `sent`/`failed`.
const dispatchNote = line => appLog('dispatch', line);
const dispatchCloud = (why, inputs, workflow) =>
  github.cloudDispatch(storage, log, {note: dispatchNote})(inputs, workflow, why);

// A CV page (cv/template.js) printed to PDF by Chromium in a hidden window. Fixed pages (a custom design)
// never grow, so a page whose content doesn't fit is reported instead of silently cut.
// The CV PDF's photo, icons, logos and page breaks, cut out of it so the tailored CV looks like it (lib/cv-look.js).
async function keepLook(cv) {
  const probe = await cvLook.probeWindow(BrowserWindow, storage.path('cv.pdf'));
  try { return await cvLook.apply(cvlib.dir(storage), cv, cvLook.plan(await probe.scan(), cv), probe); } finally { probe.close(); }
}
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
  const review = new BrowserWindow({width: 1280, height: 920, title: `Tailored CV · ${record.job.company}`, show: !HIDDEN,
    webPreferences: {sandbox: true, contextIsolation: true}});
  review.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('file:')) shell.openPath(fileURLToPath(url)); else shell.openExternal(url);
    return {action: 'deny'};
  });
  review.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    // The panel's "Final CV" block: Show in Finder and Copy path (the review page has no preload, so they are links).
    if (url.startsWith('jobpilotto-cv:')) {
      const final = cvlib.finalCopy(storage, record);
      if (url === 'jobpilotto-cv:reveal') shell.showItemInFolder(final); else if (url === 'jobpilotto-cv:copy') clipboard.writeText(final);
    } else if (!url.startsWith('file:')) shell.openExternal(url);
  });
  review.loadFile(cvlib.reviewPage(storage, record));
  return true;
}
// A macOS notification; clicking it brings the app to the front and, with a target (renderer/targets.js: a page, a section, a run's result, a job's row),
// opens it. The target may also be a function (the older callers). The same message as a window toast carries the target too.
// If macOS blocks notifications (common for an app run with npm start: "Electron" is off in System
// Settings), the same message shows as a toast inside the window, with a one-time hint how to allow them.
let notificationsBlocked = false, hintedMissing = false;
function openTarget(target) {
  const clean = targets.clean(target);
  if (clean) toWindow('openTarget', clean);
}
function notify(title, body, target = null) {
  if (process.env.JOB_PILOTTO_SMOKE) return;
  const onClick = typeof target === 'function' ? target : () => openTarget(target);
  const toast = hint => toWindow('toast', {title, body, hint, target: typeof target === 'function' ? null : targets.clean(target)});
  if (!Notification.isSupported() || notificationsBlocked) { appLog('notify', 'window toast only', {title, blocked: notificationsBlocked}); toast(false); return; }
  const note = new Notification({title, body, silent: false});
  note.on('click', () => { window?.show(); window?.focus(); onClick(); });
  // Titles only in the log, never the body (it can name an employer or an interview).
  notifyWatch.watch(note, {
    onShown: () => appLog('notify', 'shown by macOS', {title}),
    onFailed: () => { const first = !notificationsBlocked; notificationsBlocked = true; appLog('notify', 'macOS refused it: window toast instead', {title}); toast(first); },
    onMissing: () => {
      appLog('notify', 'macOS never showed it (notifications not allowed for this app?): window toast and Dock bounce instead', {title, dev: !app.isPackaged});
      toast(!hintedMissing); hintedMissing = true;
      if (!window?.isFocused()) app.dock?.bounce('informational');
    }});
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
    if (note) notify(note.title, note.body, note.target);   // a click opens that run's result
  }
  nudgeFewJobs(runs);
}

// Two jobs checks in a row with few new jobs (lib/few-jobs.js): once per streak, open that run's "Few new jobs" box; a dot on Strategy;
// one Telegram line at most weekly (Always on users are rarely in the app).
function nudgeFewJobs(runs) {
  if (DEMO) return;   // demo runs are fictional, and a prompt would land in the middle of the demo window's tests
  const found = fewJobs.streak(runs);
  const what = fewJobs.due(found, storage.settings());
  if (!what.notify) return;
  storage.saveSettings({fewJobsNudgedFor: found.runId, ...(what.telegram ? {fewJobsTelegramAt: Date.now()} : {})});
  const said = fewJobs.words(found);
  appLog('advice', 'few new jobs nudge', {run: found.runId, counts: found.counts.join(','), telegram: what.telegram, decidedBy: 'two weak checks in a row'});
  if (window?.isFocused()) toWindow('toast', {title: said.title, body: said.body, target: {run: found.runId}});
  else notify(said.title, said.body, {run: found.runId});
  toWindow('few-jobs', {runId: found.runId});
  const token = storage.secret('TELEGRAM_BOT_TOKEN'), chat = storage.settings().telegramChatId;
  if (what.telegram && token && chat && !DEMO) {
    telegram.api(token, 'sendMessage', {chat_id: chat, text: said.telegram})
      .catch(error => appLog('advice', 'few new jobs Telegram line not sent', {error: error.message}));
  }
}

function handlers() {
  // Demo mode: what would reach outside or change this computer answers "demo" instead (lib/demo.js BLOCKED).
  if (DEMO) ipcMain.handle = demo.guard(ipcMain.handle.bind(ipcMain));
  // End-to-end run: log every call the window makes (the interaction probe reads it, see lib/e2e-ipc.js).
  if (process.env.JOB_PILOTTO_E2E) { globalThis.__jpIpc = []; ipcMain.handle = recordIpc(ipcMain.handle.bind(ipcMain), globalThis.__jpIpc); }
  // Notion later: without Notion the app only tries; a tracking action returns notionGate.needs(reason) and the window
  // opens the connect dialog (pages/core.js gated()). null = go on.
  const needsNotion = reason => {
    const answer = notionGate.check(storage, reason, {demo: DEMO});
    if (answer) appLog('notion', 'gate', {reason, outcome: 'asked'});
    return answer;
  };
  ipcMain.handle('state', () => ({
    about,
    settings: storage.settings(), secrets: storage.secretsPresent(),
    hasCv: fs.existsSync(storage.path('cv.pdf')), hasProfile: !!(storage.settings().setupDone && (storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID || storage.readText('profile.md'))),
    folder: storage.dir,
    notion: storage.secret('NOTION_TOKEN') ? Object.fromEntries(Object.entries(storage.settings().notionIds || {})
      .map(([env, id]) => [env, notion.pageUrl(id)])) : null,
    templateUrl: notion.TEMPLATE.template_url,
    notionReasons: notionGate.REASONS,  // the sentences after "Connect Notion …" (one source: lib/notion-gate.js)
    notionTitles: {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages},
    demo: DEMO ? {lookAround: LOOK_AROUND} : null,
  }));
  // "Look around first" (setup wizard): restart on a fresh copy of the demo data. The user's own folder, keys and
  // setup step stay as they are; "Set up my own" (leaveDemo) restarts back into them.
  ipcMain.handle('lookAround', async (_, from = '') => {
    let folder;
    try { folder = demo.prepare(path.join(here, 'demo')); } catch (error) { return {ok: false, error: `The demo couldn't start: ${error.message}`}; }
    if (telemetry) {
      telemetry.record('setup', setupFunnel.lookAround(String(from), storage.settings()));
      await Promise.race([telemetry.flush(), new Promise(resolve => setTimeout(resolve, 1500))]);  // else sent at the next start
    }
    restartApp('look around (demo)', {args: demo.restartArgs(process.argv, folder)});
    return {ok: true};
  });
  ipcMain.handle('leaveDemo', () => {
    if (!LOOK_AROUND) return {ok: false};
    restartApp('leave the demo', {args: demo.restartArgs(process.argv)});
    return {ok: true};
  });
  // Connect to the user's Notion with a token (pasted, or from "Connect with Notion"): find the workspace, or
  // build it from the schema (lib/notion-workspace.js; templateRoot: the page Notion just copied the template into).
  // This computer's own name ("Igor's MacBook Pro"), as the person named it; the host name without ".local" elsewhere.
  const computerName = () => {
    if (process.platform === 'darwin') { try { return execFileSync('scutil', ['--get', 'ComputerName'], {encoding: 'utf8', timeout: 2000}).trim(); } catch {} }
    return os.hostname().replace(/\.local$/, '');
  };
  let notionFrom = 'token';
  async function connectNotion(token, {templateRoot = null} = {}) {
    try {
      const titles = {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages};
      const send = progress => toWindow('notionProgress', {...progress, titles});
      const result = await notionWorkspace.connectWorkspace(token, {templateRoot, onProgress: send});
      let kept = null;
      if (result.ok) {
        storage.setSecret('NOTION_TOKEN', token);
        storage.saveSettings({notionIds: result.ids});
        // Notion later: a strategy kept on this Mac while trying moves in (lib/migrate.js 'strategy from this Mac'). A workspace the
        // app just built (or Notion just copied the template into) is empty, so this Mac's strategy wins; any other workspace
        // already had data, and Notion wins. Saved first, so a step that fails retries next start with the same answer.
        const hadLocal = !!(storage.readText('profile.md').trim() || storage.readText('answers.md').trim());
        if (hadLocal) storage.saveSettings({notionMoveIn: result.built?.length || templateRoot ? 'fresh' : 'existing'});
        if (!DEMO) {
          if (hadLocal) send({moving: true});
          const moved = await migrate.run(storage, log);  // anything kept on this Mac moves in now
          kept = storage.settings().notionKeptFolder || null;
          if (kept) storage.saveSettings({notionKeptFolder: undefined});
          // A page made by this connect (Notion's template copy, or built by the app) is named after this computer and today, so a second
          // install connecting the same Notion doesn't leave two pages both called "Job Pilotto". Never blocks the connect.
          const fresh = !!(result.built?.length || templateRoot);
          const page = fresh ? await notion.nameWorkspace(token, result.ids, notion.workspaceTitle(computerName()))
            .catch(error => { log(`Notion page not renamed: ${error.message}`); return null; }) : null;
          if (storage.settings().importedNotion) storage.saveSettings({importedNotion: null});   // the import's warning has done its job
          appLog('notion', 'connected', {from: notionFrom, fresh, page: page?.id?.slice(-8) || '', renamed: !!page?.renamed, moved, kept: !!kept, hadLocal});
          syncCv();
          // What was scored before Notion reaches Job Matches, with no AI spend; with Always on GitHub's next run does it.
          if (hadLocal || moved.length) { if (!cloud()) pipeline.syncMatches(storage, log).catch(error => log(`Job Matches not synced: ${error.message}`)); }
        }
      }
      return {...result, titles, kept};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? 'Notion rejected this token. Copy the API token of your Job Pilotto connection again (Developer tools → Connections).' : error.message};
    }
  }
  handleImportant('notionConnect', 'Connecting Notion', async (_, pasted) => {
    const {value: token, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    return connectNotion(token);
  });
  // "Connect with Notion": Notion's consent page in the browser, then the same connect as above.
  handleImportant('notionOAuth', 'Connecting Notion', async (_, options = {}) => {
    notionFrom = typeof options?.from === 'string' ? options.from.slice(0, 40) : 'unknown';  // for the log: wizard, gate:<reason>, settings
    const signedIn = await notionOAuth.connect(url => shell.openExternal(url));
    if (!signedIn.ok) return signedIn;
    window?.show();
    window?.focus();
    return {...await connectNotion(signedIn.access_token, {templateRoot: notionOAuth.templateRoot(signedIn)}), workspace: signedIn.workspace_name};
  });
  ipcMain.handle('notionOAuthCancel', () => notionOAuth.cancel());
  // The connect prompt's outcome (lib/notion-gate.js gateEvent): fixed lists only; counted per install, reported when reports are on.
  ipcMain.handle('notionGateEvent', (_, payload) => {
    const settings = storage.settings();
    const event = notionGate.gateEvent(payload, {firstRunAt: settings.firstRunAt, shown: settings.notionGateShown || 0});
    if (!event) return false;
    storage.saveSettings({notionGateShown: event.shown});
    appLog('notion', 'gate', {reason: event.reason, where: event.where, outcome: event.outcome, why: event.why});
    if (telemetry) telemetry.record('setup', event);
    track('notion_gate', {reason: event.reason, outcome: event.outcome, ...(event.why ? {why: event.why} : {})});
    return true;
  });
  ipcMain.handle('saveSettings', (_, patch) => {
    const before = storage.settings();
    const saved = storage.saveSettings(patch);
    trackSetup(patch, before);
    return saved;
  });
  ipcMain.handle('contact', () => (DEMO || !notionGate.connected(storage) ? {} : contactDetails.read(storage)));
  ipcMain.handle('saveContact', (_, contact) => needsNotion('profile') || contactDetails.save(storage, contact).then(saved => { server.contactSaved(storage, saved || contact); return {ok: true}; })
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  ipcMain.handle('saveSecret', (_, name, pasted) => {
    const {value, error} = cleanSecret(pasted);
    if (error) throw new Error(error);
    storage.setSecret(name, value);
    if (name === 'ANTHROPIC_API_KEY' && !aiTrial.isTrialKey(value)) aiTrial.stop(storage);  // own key: leave the free credit
    return storage.secretsPresent();
  });
  // The AI engine (Settings → Connections → AI, the wizard's AI step; lib/claude-code.js): the user's own choice.
  const DEMO_CLAUDE = {installed: true, version: '2.1.0', path: '/usr/local/bin/claude', authenticated: true, error: '', checkedAt: '2026-09-30T09:00:00Z'};
  ipcMain.handle('claudeCodeStatus', async () => (DEMO ? DEMO_CLAUDE : {...(storage.settings().claudeCode || {}), ...await claudeCode.detect(),
    checkedAt: storage.settings().claudeCode?.checkedAt || null}));
  ipcMain.handle('verifyClaudeCode', () => (DEMO ? DEMO_CLAUDE : claudeCode.verify(storage)));
  ipcMain.handle('setAiEngine', (_, choice, options = {}) => {
    if (!claudeCode.ENGINES.includes(choice)) throw new Error(`Unknown AI engine: ${choice}`);
    storage.saveSettings({aiEngine: choice, ...(choice === 'cli' ? {claudeCodeNotice: true} : {}),
      ...('fallback' in options ? {aiFallback: !!options.fallback} : {})});
    return storage.settings();
  });
  ipcMain.handle('setAiFallback', (_, on) => { storage.saveSettings({aiFallback: !!on}); return storage.settings(); });
  ipcMain.handle('dismissEngineOffer', () => { storage.saveSettings({aiEngineOffered: true}); return storage.settings(); });
  // The free AI credit for invited testers (lib/ai-trial.js).
  ipcMain.handle('startTrialCredit', () => aiTrial.start(storage, licenseState));
  ipcMain.handle('trialCredit', () => aiTrial.credit(storage));
  ipcMain.handle('checkAnthropic', async (_, pasted) => {
    const {value: key, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    try {
      await new Anthropic({apiKey: key, baseURL: 'https://api.anthropic.com'}).models.list({limit: 1}); // free call: is the key valid?
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
    const gate = needsNotion('profile');
    if (gate) return gate;
    try { return {ok: true, ...await cvChange.review(storage, storage.secret('ANTHROPIC_API_KEY'), {client: claudeCode.client(storage)})}; }
    catch (error) { return {ok: false, error: error.message}; }
  });
  handleImportant('cvApply', 'Saving your CV and strategy', async (_, accepted) => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    try { return {ok: true, ...await cvChange.apply(storage, accepted)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('cvChangeDone', () => { storage.saveSettings({cvChange: null}); return true; });
  ipcMain.handle('draftStrategy', async (_, answers) => {
    storage.saveSettings({questionnaire: {...storage.settings().questionnaire, ...answers}});  // the note (older fields kept)
    const send = progress => toWindow('draftProgress', progress);
    // Demo mode: the fictional draft in demo/draft.json after a short pretend run; no AI is called.
    if (DEMO) {
      const demo = JSON.parse(fs.readFileSync(path.join(here, 'demo', 'draft.json'), 'utf8')).draft;
      demo.profile_markdown = strategy.withNote(demo.profile_markdown, answers);
      send({part: 'Proposing your goals', percent: 20, notes: ['Sent your CV to Claude (demo: nothing is sent)', 'Claude read your CV']});
      await new Promise(resolve => setTimeout(resolve, Number(process.env.JOB_PILOTTO_DEMO_STRATEGY_DELAY) || 300));
      return demo;
    }
    const kb = Math.round(fs.statSync(storage.path('cv.pdf')).size / 1024);
    const sent = `Sent your CV (${kb} KB)${answers.anything_else ? ' and your note' : ''} to Claude (${strategy.MODEL})`;
    // Before Claude writes anything it reads the CV (about 25 s): the bar moves by time, up to 10%.
    const started = Date.now();
    let writing = false;
    const reading = setInterval(() => !writing && send({part: 'Claude is reading your CV', notes: [sent, 'Claude is reading your CV…'],
      percent: Math.min(strategy.READING - 1, Math.round((Date.now() - started) / 25000 * strategy.READING))}), 1000);
    send({part: 'Sending your CV to Claude', percent: 0, notes: [sent]});
    let draft;
    try {
      draft = await strategy.draft(storage, answers, storage.secret('ANTHROPIC_API_KEY'), claudeCode.client(storage),
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
      const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
      // Progress for the save window: each step starts, advances (blocks written) and finishes.
      const step = (name, extra = {}) => toWindow('saveProgress', {step: name, ...extra});
      // The daily target asked in the wizard goes with the search settings.
      const perDay = storage.settings().questionnaire?.applications_per_day;
      const accepted = () => ({search: take('search') ? draft.search : null,
        preferences: !parts ? {...draft.preferences, daily_applications_target: strategy.clampTarget(perDay)} : take('filters') ? draft.preferences : null});
      // Trying (no Notion yet, lib/notion-gate.js): the strategy is kept on this Mac, and lib/migrate.js moves it into
      // Notion when it is connected. Contact details are a section of the Profile text, as in Notion.
      if (!notionGate.connected(storage)) {
        strategy.save(storage, accepted());
        step('local', {finished: true});
        const contact = Object.fromEntries(Object.entries(draft.contact || {}).filter(([, value]) => value));
        const profile = draft.profile_markdown.trim() + (Object.keys(contact).length ? `\n\n${contactDetails.markdown(contact)}\n` : '\n');
        const backup = strategy.saveLocal(storage, {profile: take('profile') ? profile : null, answers: take('answers') ? draft.answers_markdown : null},
          {backup: !!storage.settings().setupDone});
        appLog('notion', 'strategy kept on this Mac', {parts: parts || 'all', backup: !!backup});
        for (const name of ['profile', 'answers', 'search']) step(name, {finished: true});
        { const before = storage.settings(); storage.saveSettings({setupDone: true}); trackSetup({setupDone: true}, before); }
        return {ok: true, local: true};
      }
      // Replacing a strategy that was set up before: keep a copy of the current one in Notion first.
      if (storage.settings().setupDone) {
        step('snapshot');
        const when = new Date().toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
        await notion.snapshotStrategy(token, ids, when);
        step('snapshot', {finished: true});
      }
      // ⚙️ Search settings is the source of truth: read it first, so edits made there since the last search are not overwritten by the cached copy.
      if (ids.NOTION_SEARCH_SETTINGS_PAGE) await pipeline.run(storage, ['src.notion.search_settings', 'sync']);
      strategy.save(storage, accepted());
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
      { const before = storage.settings(); storage.saveSettings({setupDone: true}); trackSetup({setupDone: true}, before); }
      syncCv();  // the CV to the Profile page (Notion keeps every version)
      return {ok: true};
    })().catch(error => ({ok: false, error: `Couldn't write to Notion: ${error.message}`})).finally(() => { saving = null; });
    return saving;
  });
  // The page the person opened (a name from a fixed list, nothing else): where people go, in order.
  ipcMain.handle('pageView', (_, name) => { if (analyticsLib.PAGES.includes(String(name))) track('page_view', {page: String(name)}); return true; });
  ipcMain.handle('runs', () => activity());
  // Pages are logged by their LAST 8 characters: the first 8 are the workspace's, the same on every page (6 Oct 2026: a log of reads could not tell them apart).
  ipcMain.handle('runDetail', async (_, pageId) => {
    if (DEMO) return JSON.parse(fs.readFileSync(path.join(here, 'demo', 'run-pages.json'), 'utf8'))[pageId] || {message: null, log: []};
    try {
      const started = Date.now(), read = await runHistory.detail(storage, pageId);
      appLog('run', 'page read', {page: String(pageId).replace(/-/g, '').slice(-8), message: !!read.message, lines: read.log.length, ms: Date.now() - started});
      return read;
    } catch (error) {
      appLog('run', 'page not read', {page: String(pageId).replace(/-/g, '').slice(-8), error: error.message, status: error.status || 0});
      return {message: null, log: [`Not read from Notion: ${error.message}`]};
    }
  });

  ipcMain.handle('checkMail', () => (storage.settings().cloud?.repo
    ? dispatchCloud('Gmail check (Check now)', {}, 'mail.yml').then(result => (result.ok
      ? {ok: true, cloud: true} : {ok: false, error: result.error}))
    : pipeline.checkMail(storage, log, 'you').then(({ok, run}) => ({ok, run}))));
  // Right after setup: the first search, so the Jobs screen fills while the user watches.
  ipcMain.handle('firstSearch', () => (storage.settings().lastSearchAt || pipeline.running() ? {ok: true, skipped: true}
    : cloud() ? dispatchCloud('First search (after setup)', {mode: 'run'}).then(r => ({ok: r.ok, cloud: true, error: r.error}))  // background jobs run in one place
      : pipeline.refresh(storage, log, 'run', 'first')));
  // The list sends the best `jobsLimit` rows; "Show more" raises it for the rest of this launch, so a refresh after a search keeps them.
  // The window's own line for logs/app.log, area "ui": what a person saw that the app's side can't tell (7 Oct 2026: a counter that
  // flashed only sometimes). Short identity fields only (numbers, flags, names), never a job or anything the user wrote.
  ipcMain.handle('uiLog', (_, message, fields = {}) => {
    const kept = Object.entries(fields && typeof fields === 'object' ? fields : {}).slice(0, 12)
      .map(([key, value]) => [String(key).slice(0, 40), typeof value === 'number' || typeof value === 'boolean' ? value : String(value).slice(0, 60)]);
    appLog('ui', String(message).slice(0, 120), Object.fromEntries(kept));
  });
  ipcMain.handle('jobs', async (_, options = {}) => {
    if (options?.limit) jobsLimit = Math.max(JOBS_PAGE, Math.round(options.limit));
    if (DEMO) return JSON.parse(fs.readFileSync(path.join(here, 'demo', 'jobs.json'), 'utf8'));
    // Searches run in the cloud: show the latest cloud run's jobs (checked at most every 5 minutes).
    const cloud = storage.settings().cloud;
    if (cloud?.repo && Date.now() - Date.parse(cloud.checkedAt || 0) > 5 * 60 * 1000) {
      storage.saveSettings({cloud: {...cloud, checkedAt: new Date().toISOString()}});
      await github.syncDatabase(storage).catch(error => log(`Cloud job list: ${error.message}`));
    }
    const result = await pipeline.jobs(storage, jobsLimit);
    for (const job of result.jobs || []) job.tailored = !!job.code && cvlib.exists(storage, job.code);
    // A session whose job is already Applied is over (the form was submitted): the extension's report can arrive
    // while the app is closing, so this cannot wait for the window to notice. Cheap and idempotent.
    const ended = server.reconcileAppliedSessions(result.jobs || []);
    if (ended.length) {
      appLog('sessions', `Ended ${ended.length} session(s) whose job is already Applied`, {urls: ended});
      toWindow('session', 'update', {ended});
    }
    return viewCache.remember(storage, 'jobs', result);
  });
  ipcMain.handle('calendarJobs', async () => (DEMO ? {jobs: JSON.parse(fs.readFileSync(path.join(here, 'demo', 'jobs.json'), 'utf8')).jobs}
    : needsNotion('interviews') || viewCache.remember(storage, 'calendar', await pipeline.calendarJobs(storage))));
  // The last good Jobs / Focus / Strategy read, shown at once while the fresh one loads (lib/view-cache.js).
  ipcMain.handle('cached', (_, name) => (DEMO ? null : viewCache.recall(storage, name)));
  ipcMain.handle('refresh', async () => {
    const blocked = allowanceBlock();
    if (blocked) return blocked;
    if (!storage.settings().cloud?.repo) return pipeline.refresh(storage, log, 'run', 'you');
    const started = await dispatchCloud('Run now (Refresh)', {mode: 'run'});
    return started.ok ? {ok: true, cloud: true} : {ok: false, error: started.error};
  });
  // Always on: sign in to GitHub (code approved in the browser), then set up
  // the user's private repo. Also re-run after a key or setting changes ("Update").
  handleImportant('cloudConnect', 'Setting up Always on', async (_, chosen = '') => {
    if (DEMO) return {ok: true, repo: storage.settings().cloud?.repo || 'alexmorgan/job-pilotto-private', existing: null,
      secrets: ['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], variables: []};  // never the real GitHub
    const gate = needsNotion('cloud');
    if (gate) return gate;
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
  const turnCloudOff = async () => {
    if (storage.settings().telegramCloud) await telegramCloud.turnOff(storage);  // its buttons start runs there
    const repo = storage.settings().cloud?.repo;
    const failed = await github.pauseWorkflows(storage).catch(error => [error.message]);  // before the repo is forgotten
    appLog('dispatch', 'always on off: schedules paused', {repo, failed: failed.length, ...(failed.length ? {why: failed.join('; ').slice(0, 200)} : {})});
    storage.saveSettings({cloud: null}); restartTelegram();
  };
  handleImportant('cloudOff', 'Turning off Always on', async () => { await turnCloudOff(); return true; });
  // Choosing "While app is open" in the run-mode control *is* turning Always on off, so say what changes first: the
  // schedule moves back to this Mac, and the GitHub repository stays where it is.
  handleImportant('cloudTurnOffConfirmed', 'Turning off Always on', async () => {
    const repo = storage.settings().cloud?.repo;
    if (!repo) return {ok: true, already: true};
    const {response} = await dialog.showMessageBox(window && !window.isDestroyed() ? window : undefined,
      {type: 'question', buttons: ['Turn Always on off', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Turn Always on off?',
        detail: `Scheduled searches, kits, insights and mail checks run on this Mac while Job Pilotto is open. Your repository ${repo} stays on GitHub.`});
    if (response !== 0) return {ok: false, cancelled: true};
    await turnCloudOff();
    return {ok: true};
  });
  // Telegram buttons, always on: the user's own Cloudflare Worker (lib/telegram-cloud.js).
  handleImportant('telegramCloudOn', 'Setting up the Telegram buttons', async (_, token) => { const gate = needsNotion('telegram'); if (gate) return gate; const result = await telegramCloud.turnOn(storage, token); restartTelegram(); return result; });
  handleImportant('telegramCloudOff', 'Turning off the Telegram buttons', async () => { const result = await telegramCloud.turnOff(storage); restartTelegram(); return result; });
  // Settings → Telegram → ⋯ → Disconnect Telegram (owner, 7 Oct 2026, after Gmail's): the bot token and chat are forgotten, the Telegram
  // buttons' Worker goes (it answers for this bot), the app stops listening, and with Always on the repo's two Telegram secrets go too.
  // The bot itself stays in Telegram (@BotFather → /deletebot removes it). Logged, never the token.
  handleImportant('telegramDisconnect', 'Disconnecting Telegram', async () => {
    if (DEMO) return {ok: false, error: 'Demo mode: Telegram is not changed.'};
    const bot = storage.settings().telegramBot || '', buttons = !!storage.settings().telegramCloud;
    if (buttons) await telegramCloud.turnOff(storage);
    storage.setSecret('TELEGRAM_BOT_TOKEN', '');
    storage.saveSettings({telegramChatId: null, telegramBot: null, telegramOffset: null});
    restartTelegram();
    let inRepo = false;
    if (cloud()) inRepo = await github.removeRepoSecrets(storage, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']).catch(error => { appLog('connections', 'Telegram secrets not removed from GitHub', {error: error.message}); return 'failed'; });
    appLog('connections', 'Telegram disconnected', {from: 'settings', buttonsOff: buttons, github: inRepo});
    return {ok: true, bot, github: inRepo};
  });
  // Telegram: check the bot token, wait for the user to press Start, then listen for taps and commands.
  handleImportant('telegramConnect', 'Connecting Telegram', async (_, pasted) => {
    const gate = needsNotion('telegram');
    if (gate) return gate;
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
  // Prepare top matches (Actions): kits for the best-scored matches without one, tracked like the other tasks. Not a Telegram
  // command; with Always on it runs in the user's GitHub repo like every background job.
  const prepareTopMatches = async () => {
    const gate = needsNotion('kits');
    if (gate) return gate;
    const blocked = allowanceBlock();
    if (blocked) return blocked;
    appLog('dispatch', 'prepare top matches', {where: cloud() ? 'github' : 'mac'});
    if (cloud()) {
      const started = await dispatchCloud('Prepare top matches', {mode: 'kits'});
      return {text: started.ok ? 'Drafting kits for your top matches on GitHub.' : `⚠️ ${started.error}`};
    }
    pipeline.task(storage, 'kits', pipeline.dailyArgs(storage, {mode: 'kits'}), log).catch(error => log(`Prepare top matches failed: ${error.message}`));
    return {text: 'Drafting kits for your top matches.'};
  };
  // Every Telegram command, from the app (the answer also goes to Telegram when connected).
  const COMMANDS = ['check', 'employers', 'run', 'today', 'applied', 'saved', 'insight', 'weekly', 'mail', 'scout', 'status', 'add', 'help'];
  ipcMain.handle('command', async (_, name, arg = '') => {
    if (name === 'kits') return prepareTopMatches();
    if (!COMMANDS.includes(name)) return {text: 'Unknown command'};
    if (name === 'run' && allowanceBlock()) return {text: 'The free allowance is over. Paste a license key in Settings → License to search again.'};
    try { return await telegram.runCommand(storage, name, arg, log, undefined, dispatchNote); } catch (error) { return {text: `⚠️ ${error.message}`}; }
  });
  // Jobs → Applied elsewhere: tracked like /add, but waited for, so the list shows it as Applied right away.
  ipcMain.handle('importJob', async (_, url) => {
    if (DEMO) return {ok: true, text: 'Added (demo): nothing was written.'};
    const gate = needsNotion('add');
    if (gate) return gate;
    try { return await pipeline.importJob(storage, url, log); } catch (error) { return {ok: false, text: error.message}; }
  });
  ipcMain.handle('addApplied', async (_, url, when = '', details = {}) => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.'};
    const gate = needsNotion('applied');
    if (gate) return gate;
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
  // "Your search may be too narrow" (src/coverage.py): how much of the market the role keywords catch, and what adding a term would add.
  // The one-tap "why?" after Dismiss and the daily score snapshot (renderer/intel.js): counts for the product, on the Technical reports switch.
  ipcMain.handle('dismissReason', (_, input) => { recipeReporterRef?.dismissal(String(input?.reason || ''), String(input?.bucket || '')); return {ok: true}; });
  ipcMain.handle('intelSnapshot', (_, list, hosts) => {
    const today = new Date().toISOString().slice(0, 10);
    if (DEMO || storage.settings().intelSnapshotDay === today) return {ok: true, skipped: true};
    // A list without any score or stage (read before Notion's rows came through) is sent, since the site keeps the latest, but does not use up the day.
    const useful = intelLib.informative(list);
    if (useful) storage.saveSettings({intelSnapshotDay: today});
    appLog('intel', `snapshot ${useful ? 'sent' : 'sent, but only unscored/new jobs, so the day stays open'}`, {bands: Array.isArray(list) ? list.length : 0});
    recipeReporterRef?.snapshot(list);
    recipeReporterRef?.sources(applicationOutcomes.sourceStats(hosts, controlEvents.boardName));
    return {ok: true};
  });
  ipcMain.handle('benchmarkLines', (_, urls) => ({ok: true, lines: benchmarkLib.lines(storage, urls, controlEvents.boardName)}));
  ipcMain.handle('searchCoverage', async () => {
    if (DEMO) return {ok: true, coverage: JSON.parse(fs.readFileSync(path.join(here, 'demo', 'coverage.json'), 'utf8'))};   // the Strategy cards and the few-jobs buttons, shown
    // A test run can make the engine's answer as slow as it is on a real machine (a Python start over a big data folder): the card must not arrive late and push the page.
    if (process.env.JOB_PILOTTO_E2E && Number(process.env.JOB_PILOTTO_E2E_COVERAGE_MS) > 0) await new Promise(resolve => setTimeout(resolve, Number(process.env.JOB_PILOTTO_E2E_COVERAGE_MS)));
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'coverage']);
    if (code !== 0) return {ok: false, error: 'Could not read the coverage (see the activity log)'};
    try { return {ok: true, coverage: JSON.parse(stdout.trim().split('\n').pop())}; } catch { return {ok: true, coverage: null}; }
  });
  // Roles suggested from the Profile (src/ai/role_ideas.py: Sonnet at most once a day), counted in the titles of the user's places; the ones the
  // person set aside ("Not now") are sent back so they are never proposed again.
  ipcMain.handle('roleIdeas', async (_, setAside = []) => {
    if (DEMO) return {ok: true, ideas: [{role: 'Cashier', word: 'caissier', why: 'Retail sales experience in a camera shop', count: 6},
      {role: 'Visual merchandiser', word: 'merchandiser', why: 'Eye for images plus retail experience', count: 3},
      {role: 'Image retoucher', word: 'retouche', why: 'Strong Photoshop and Lightroom retouching', count: 2},
      {role: 'Photo lab assistant', word: 'laboratoire photo', why: 'Camera shop background', count: 0}].filter(idea => !(setAside || []).includes(idea.word))};
    const file = path.join(os.tmpdir(), `jp-role-ideas-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({set_aside: (Array.isArray(setAside) ? setAside : []).map(String).slice(0, 60)}));
    try {
      const {stdout} = await pipeline.run(storage, ['src.desktop', 'role-ideas', file]);
      const answer = JSON.parse(String(stdout).trim().split('\n').pop());
      appLog('strategy', 'role ideas', {count: answer.ideas?.length ?? 0, ok: !!answer.ok});
      return answer;
    } catch (error) {
      return {ok: false, ideas: [], error: error.message};
    } finally {
      fs.rmSync(file, {force: true});
    }
  });
  // "Your filters drop jobs": only what the engine's own coverage listed can be removed (never a word typed elsewhere).
  // "Explain with AI" on a jobs check with few new jobs: on the user's click only (src/ai/few_jobs.py; counts, never the CV).
  ipcMain.handle('explainCoverage', async () => {
    if (DEMO) return {ok: true, why: 'Demo data: your role words catch most postings in your places.', first_steps: []};
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'explain-coverage']);
    if (code !== 0) return {ok: false, error: 'Claude could not answer now (see the activity log)'};
    try { return {ok: true, ...JSON.parse(stdout.trim().split('\n').pop())}; } catch { return {ok: false, error: 'Claude\'s answer could not be read'}; }
  });
  // Every save that rewrites ⚙️ Search settings in Notion (Strategy's Save, its chips, the few-jobs chips, Tune, the daily target): what it is doing,
  // told to the window as it goes (renderer/save-progress.js), as the page is rewritten a block at a time (7 Oct 2026: Save sat on "Saving…" 71 s,
  // 107 blocks deleted one by one behind a search, and nothing said why).
  const settingsProgress = (stage, extra = {}) => toWindow('settingsProgress', {stage, ...extra});
  const settingsDeps = () => ({
    run: (store, args, ...rest) => {
      if (args[0] === 'src.notion.search_settings' && args[1] === 'sync') settingsProgress('read');
      return pipeline.run(store, args, ...rest);
    },
    ensurePage: notion.ensurePage,
    writePage: (token, page, markdown) => notion.writePage(token, page, markdown, undefined, (done, total) => settingsProgress('write', {done, total})),
  });
  ipcMain.handle('loosenSearch', async (_, asked = {}) => {
    if (DEMO) return {ok: true, removed: []};
    try {
      const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'coverage']);
      if (code !== 0) throw new Error('Could not read the coverage (see the activity log)');
      const said = JSON.parse(stdout.trim().split('\n').pop()) || {};
      const listedWords = new Set((said.excluded || []).map(item => item.fragment)), listedLanguages = new Set((said.languages || []).map(item => item.language));
      const result = await strategy.loosen(storage, {excludes: (asked.excludes || []).filter(word => listedWords.has(word)),
        languages: (asked.languages || []).filter(language => listedLanguages.has(language))}, settingsDeps());
      appLog('search', `filters loosened: ${result.removed.join(', ') || 'none'}`);
      return {ok: true, ...result};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('addRoles', async (_, terms) => {
    if (DEMO) return {ok: true, added: []};
    try {
      const result = await strategy.addRoles(storage, terms, settingsDeps());
      appLog('search', `role terms added: ${result.added.join(', ') || 'none'}`);
      // Counted for the starter keyword pack: only words the card itself offered (a fixed vocabulary), with the search's coarse role and region.
      try {
        const summary = JSON.parse(storage.readText('data/coverage.json') || 'null');
        const offered = new Set((summary?.suggestions || []).map(item => String(item.term).toLowerCase()));
        for (const term of result.added) if (offered.has(term)) recipeReporterRef?.termAccepted(term, summary.roles, summary.regions);
      } catch { /* ignore */ }
      return {ok: true, ...result};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // "Your places miss N matching roles": the names the card offered are looked up again in the engine's own verdict, so only an offered place
  // (a fixed list, src/coverage.py PLACE_OPTIONS) can ever be written into the search settings.
  ipcMain.handle('addPlaces', async (_, names) => {
    if (DEMO) return {ok: true, added: []};
    try {
      const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'coverage']);
      if (code !== 0) throw new Error('Could not read the coverage (see the activity log)');
      const offered = (JSON.parse(stdout.trim().split('\n').pop())?.places?.options || []).filter(option => (Array.isArray(names) ? names : []).includes(option.place));
      const result = await strategy.addPlaces(storage, offered, settingsDeps());
      appLog('search', `places added: ${result.added.join(', ') || 'none'}`, {offered: offered.length});
      return {ok: true, ...result};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // Tune my strategy (Actions): proposals from the user's own outcomes (src/tune.py, no AI); only the ticked ones are written,
  // and only ones the engine offers again at that moment (the window's ids pick from them, they never carry a change themselves).
  const tuneProposals = async () => {
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'tune']);
    if (code !== 0) return {ok: false, error: 'Could not read your results (see the activity log)'};
    try { return JSON.parse(stdout.trim().split('\n').pop()); } catch { return {ok: false, error: 'Could not read your results (see the activity log)'}; }
  };
  ipcMain.handle('tuneProposals', async () => {
    if (DEMO) return {ok: true, proposals: [], basis: {jobs: 0, dismissed: 0, engaged: 0, interviews: 0, min_dismissed: 5}};
    const gate = needsNotion('tune');
    if (gate) return gate;
    const answer = await tuneProposals();
    appLog('strategy', 'tune proposals', {ok: !!answer.ok, proposals: answer.proposals?.length || 0, jobs: answer.basis?.jobs, dismissed: answer.basis?.dismissed});
    return answer;
  });
  // Strategy → What you're targeting → Edit: the lists edited in the app, written to ⚙️ Search settings (lib/strategy.js editLists).
  ipcMain.handle('editTargets', async (_, edits) => {
    if (DEMO) return {ok: true, changed: Object.keys(edits || {})};
    try {
      const result = await strategy.editLists(storage, edits, settingsDeps());
      const asked = strategy.cleanEdits(edits);
      if (result.changed.length) storage.saveSettings({searchChangedAt: new Date().toISOString()});   // Jobs and Strategy: "Refresh your jobs to apply it"
      appLog('strategy', 'targets edited', {lists: result.changed.join(','), added: Object.values(asked).reduce((n, e) => n + (e.add?.length || 0), 0),
        removed: Object.values(asked).reduce((n, e) => n + (e.remove?.length || 0), 0), remote: asked.remote?.set || '', notion: !!storage.secret('NOTION_TOKEN')});
      return {ok: true, ...result};
    } catch (error) { appLog('strategy', 'targets not saved', {error: error.message}); return {ok: false, error: error.message}; }
  });
  // Stop on a running task (Actions banner, Recent activity): its commands end, what it saved is kept, the next run continues.
  ipcMain.handle('stopTask', () => {
    const result = pipeline.stopTask();
    appLog('run', result.ok ? 'stopped by you' : 'stop refused', {kind: result.kind || pipeline.running()?.kind || '', error: result.error || ''});
    return result;
  });
  // Remove a queued task (Recent activity's queued row, ⌘K): it never starts.
  ipcMain.handle('unqueueTask', (_, id) => {
    const result = pipeline.unqueue(storage, String(id || ''));
    appLog('run', result.ok ? 'removed from the queue by you' : 'unqueue refused', {kind: result.kind || '', id: String(id || ''), error: result.error || ''});
    return result;
  });
  // Strategy → Your goals: one goal corrected in the Profile (lib/goals.js). The fit scores follow it over the next searches.
  ipcMain.handle('editGoal', async (_, key, value) => {
    if (DEMO) return {ok: true, where: 'demo'};
    try {
      const result = await goals.setGoal(storage, key, value);
      appLog('strategy', 'goal corrected', {goal: key, where: result.where, length: String(value || '').trim().length});
      return result;
    } catch (error) { appLog('strategy', 'goal not saved', {goal: key, error: error.message}); return {ok: false, error: error.message}; }
  });
  ipcMain.handle('tuneApply', async (_, ids) => {
    if (DEMO) return {ok: true, changed: []};
    const gate = needsNotion('tune');
    if (gate) return gate;
    try {
      const fresh = await tuneProposals();
      if (!fresh.ok) return fresh;
      const {chosen, asked} = strategy.chooseOffered(fresh.proposals, ids);
      const result = await strategy.retune(storage, chosen, settingsDeps());
      appLog('strategy', 'tune applied', {asked, applied: chosen.length, kinds: chosen.map(item => item.kind).join(',')});
      return {ok: true, ...result, missing: asked - chosen.length};
    } catch (error) { return {ok: false, error: error.message}; }
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
  // Two steps: proposeLead reads it (Claude, once; nothing written), the window asks you to confirm the channel and the
  // start date, then addLead(…, {proposal, confirmed}) writes it to Notion with those instead of Claude's guesses.
  const leadCheck = () => needsNotion('lead')
    || (!aiReady() ? {ok: false, text: 'Reading a message or screenshot needs AI: choose Claude Code or add an API key (Settings → Connections → AI).'} : null);
  // Screenshots (up to 5) go to temporary files for the run (then to Notion, on the job's page), deleted after.
  const withShots = async (image, task) => {
    const exts = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'};
    const shots = (Array.isArray(image) ? image : image ? [image] : []).filter(shot => exts[shot?.type]).slice(0, 5);
    const files = shots.map((shot, i) => path.join(app.getPath('temp'), `job-pilotto-shot-${Date.now()}-${i}${exts[shot.type]}`));
    try {
      shots.forEach((shot, i) => {
        const data = Buffer.from(String(shot.data), 'base64');
        fs.writeFileSync(files[i], data);  // Claude reads this one
        const small = smallCopy(nativeImage, data);  // Notion gets this one: a narrow JPEG (src/ai/inbox.py load_image)
        if (small) fs.writeFileSync(`${files[i]}.small.jpg`, small);
      });
      return await task(files.join(','));
    } catch (error) { return {ok: false, text: error.message}; } finally { files.forEach(file => { fs.rmSync(file, {force: true}); fs.rmSync(`${file}.small.jpg`, {force: true}); }); }
  };
  // Each step the engine reports ("⏳ …"), and its wait for another search, show in the Log box while it works.
  const leadLine = line => { log(line); const step = pipeline.leadStepOf(line); if (step) toWindow('leadStep', step); };
  // earlier: the proposal shown, when you pick another job in the confirmation step (proposed again, no second reading).
  ipcMain.handle('proposeLead', async (_, text, image = null, target = '', earlier = null) => {
    if (DEMO) return demo.leadProposal(target);
    const problem = leadCheck();
    if (problem) return problem;
    if (earlier) {
      const reading = path.join(app.getPath('temp'), `job-pilotto-reading-${Date.now()}.json`);
      try {
        fs.writeFileSync(reading, JSON.stringify(earlier));
        return await pipeline.proposeLead(storage, String(text || ''), leadLine, {target: String(target || ''), reading});
      } finally { fs.rmSync(reading, {force: true}); }
    }
    return withShots(image, file => pipeline.proposeLead(storage, String(text || ''), leadLine, {file, target: String(target || '')}));
  });
  ipcMain.handle('addLead', async (_, text, image = null, target = '', proposal = null, confirmed = null) => {
    if (DEMO) return {ok: true, text: 'Tracked (demo): nothing was written.', job: {pageId: 'demo-lead-9', url: 'https://www.notion.so/demo-lead-9',
      title: 'Platform Engineer', jobUrl: 'https://example.com/lead/9', created: true}};
    const problem = leadCheck();
    if (problem) return problem;
    const reading = proposal ? path.join(app.getPath('temp'), `job-pilotto-reading-${Date.now()}.json`) : '';
    try {
      if (reading) fs.writeFileSync(reading, JSON.stringify(proposal));
      return await withShots(image, file => pipeline.addLead(storage, String(text || ''), leadLine,
        {file, target: String(target || ''), reading, confirmed}));
    } finally { if (reading) fs.rmSync(reading, {force: true}); }
  });
  // Interviews: drafts on this Mac (recording, transcribing, editing), saved ones in Notion 🎤 Interviews.
  // Demo mode shows fictional ones (demo/interviews.json) and changes nothing.
  const demoInterviews = () => JSON.parse(fs.readFileSync(path.join(here, 'demo', 'interviews.json'), 'utf8'));
  // Recordings made in the app are matched to the job whose Next interview time is close to when they began (a suggestion only:
  // the job is confirmed by saving). Imported files have no real start time, so they get none.
  ipcMain.handle('ivDrafts', () => {
    if (DEMO) return [demoInterviews().draft];
    const jobs = viewCache.recall(storage, 'jobs')?.result?.jobs || [];
    return interviews.drafts(storage).map(draft => {
      if (draft.jobUrl || draft.file !== 'recording.webm') return draft;
      const found = reminders.match(jobs, Date.parse(draft.createdAt));
      return found ? {...draft, suggestedJobUrl: found.url, suggestedJob: `${found.company} — ${found.title}`} : draft;
    });
  });
  ipcMain.handle('ivRemindGet', () => ({on: reminders.on(storage)}));
  ipcMain.handle('ivRemindSet', (_, value) => { storage.saveSettings({interviewReminders: !!value}); return {on: !!value}; });
  ipcMain.handle('ivTranscript', (_, id) => (DEMO ? demoInterviews().transcript : interviews.transcript(storage, id)));
  ipcMain.handle('ivSaved', async () => (DEMO ? {ok: true, interviews: demoInterviews().saved, insight: demoInterviews().insight}
    : needsNotion('interviews') || viewCache.remember(storage, 'interviews', await interviews.saved(storage))));
  ipcMain.handle('calendarRecordings', async () => (DEMO ? {ok: true, interviews: demoInterviews().saved}
    : needsNotion('interviews') || viewCache.remember(storage, 'calendarRecordings', await interviews.savedForCalendar(storage))));
  ipcMain.handle('ivInsightStep', async (_, text, done) => (DEMO ? {ok: true, done_steps: []}
    : needsNotion('interviews') || interviews.insightStep(storage, text, !!done)));
  ipcMain.handle('ivInsights', async () => {
    if (DEMO) return {ok: true, status: 'unchanged', text: 'Demo mode', insight: demoInterviews().insight};
    const gate = needsNotion('interviews');
    if (gate) return gate;
    const result = await interviews.refreshInsights(storage);
    const cached = interviews.cacheWithInsight(viewCache.recall(storage, 'interviews'), result);
    if (cached) viewCache.remember(storage, 'interviews', cached);  // the next start shows this one
    return result;
  });
  handleImportant('ivAdd', 'Saving an interview', async () => {
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
  ipcMain.handle('ivPrefetch', () => (DEMO ? {ok: true} : interviews.prefetch(storage, step => toWindow('ivProgress', step))));
  handleImportant('ivTranscribe', 'Transcribing an interview', async (_, id, options) => {
    const meta = await interviews.transcribe(storage, id, options, step => toWindow('ivProgress', step));
    if (meta.status === 'ready') notify('Transcript ready', `${meta.title}: ${meta.pageId ? 'already in your Notion; ' : ''}name the speakers, pick the job, then Save.`, {view: 'interviews'});
    return meta;
  });
  ipcMain.handle('ivSaveDraft', (_, id, patch) => (DEMO ? true : interviews.saveDraft(storage, id, patch)));
  ipcMain.handle('ivDiscard', async (_, id) => (DEMO ? (interviews.discard(storage, id), true) : (await interviews.drop(storage, id)).ok));
  ipcMain.handle('ivSave', (_, id) => needsNotion('interviews') || interviews.save(storage, id));
  ipcMain.handle('ivLink', (_, pageId, jobUrl) => needsNotion('interviews') || interviews.link(storage, pageId, jobUrl));
  // A row already reviewed is reviewed again by the same run (⋯ Review again: src/ai/interviews.py review_again).
  // One review costs ~$0.25 and takes about a minute, so a second ask for the same interview inside that window is a
  // duplicate, whoever made it: 1 Oct 2026 produced two GitHub runs 38 s apart, two Notion rows and two different
  // reviews of one transcript. The window is short enough that a deliberate "Review again" later still runs.
  const REVIEW_WINDOW_MS = 2 * 60 * 1000;
  const reviewingStarted = new Map();  // interview page id -> when its review was last started
  // `why` comes from the window (the row's Review, ⋯ Review again, Save & review): the log then names the button, not
  // just "the app", which is what makes a second dispatch attributable.
  ipcMain.handle('ivReview', (_, pageId, why = '') => {
    if (DEMO) return {ok: true, summary: 'Reviewed (demo): nothing was written'};
    const gate = needsNotion('interviews');
    if (gate) return gate;
    const id = String(pageId), caller = `Interview review (${why || 'interviews page'})`;
    if (Date.now() - (reviewingStarted.get(id) || 0) < REVIEW_WINDOW_MS) {
      appLog('dispatch', `refused ${caller} → daily.yml (interview) in ${storage.settings().cloud?.repo || 'this Mac'}: already started within ${REVIEW_WINDOW_MS / 60000} min`);
      return {ok: true, already: true, summary: 'Already reviewing this interview — it shows in Recent activity'};
    }
    reviewingStarted.set(id, Date.now());
    if (cloud()) {
      return dispatchCloud(caller, {mode: 'interview', interview: id}).then(started => (started.ok
        ? {ok: true, cloud: true, summary: 'Reviewing on GitHub: it shows in Recent activity, and the review lands on the interview in Notion.'}
        : {ok: false, error: `Could not start the review on GitHub: ${started.error}`}));
    }
    return Promise.resolve(interviews.review(storage, id)).then(result => {
      if (!result?.ok) reviewingStarted.delete(id);  // it failed: a retry must be able to start at once
      return result;
    });
  });
  ipcMain.handle('ivDelete', (_, pageId) => (DEMO ? {ok: true} : interviews.remove(storage, pageId)));
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
    restartApp('reset');
    return {ok: true};
  });
  // Told once per app start: a window reload (⌘R) asks again, and must not re-show "Data imported ✓" for an import done long ago.
  ipcMain.handle('lastReset', () => { const done = resetTold ? null : resetDone; resetTold = true; return done; });
  // What lives only on this Mac: the weekly automatic backup (lib/backup.js), or now.
  ipcMain.handle('backupNow', () => backupNow());
  ipcMain.handle('showBackups', () => { fs.mkdirSync(backup.folder(), {recursive: true}); return shell.openPath(backup.folder()); });
  ipcMain.handle('backupStatus', () => ({at: storage.settings().lastBackupAt || null, file: storage.settings().lastBackupFile || null,
    folder: backup.folder()}));
  // Export: one file with this computer's Job Pilotto data (keys only when asked: they're in plain text there).
  // notion: also a read-only copy of the whole Notion workspace (notion.json), to keep or move elsewhere.
  handleImportant('exportProfile', 'Exporting your data', async (_, {keys = false, notion: withNotion = false} = {}) => {
    // Whose data and when: the name from the Profile's contact details (3 s at most: never hold the dialog on Notion), the first role searched for.
    const contact = await Promise.race([contactDetails.read(storage).catch(() => ({})), new Promise(done => setTimeout(() => done({}), 3000))]);
    const role = (() => { try { return JSON.parse(storage.readText('config/search.json') || '{}').jobs_board_search_queries?.[0] || ''; } catch { return ''; } })();
    const name = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    const picked = await dialog.showSaveDialog(window, {title: 'Export your Job Pilotto data',
      defaultPath: path.join(app.getPath('documents'), reset.exportName({name, role})), filters: [{name: 'Job Pilotto export', extensions: ['gz']}]});
    if (picked.canceled || !picked.filePath) return {ok: false};
    const secrets = keys ? Object.fromEntries(SECRET_NAMES.map(name => [name, storage.secret(name)]).filter(([, value]) => value)) : null;
    exportStop = new AbortController();
    const {signal} = exportStop;
    try {
      const copy = withNotion ? await notion.dumpWorkspace(storage.secret('NOTION_TOKEN'), storage.settings().notionIds || {},
        {onProgress: count => toWindow('exportProgress', count), signal}) : null;
      if (signal.aborted) throw Object.assign(new Error('Export cancelled'), {cancelled: true});   // the file is written only after this
      reset.exportTo(storage.dir, picked.filePath, {keys: secrets, notion: copy, version: about.label});
      appLog('data', 'exported', {keys: !!secrets, notion: !!copy});
      return {ok: true, file: picked.filePath, notion: copy && {pages: copy.pages, rows: copy.rows}};
    } catch (error) {
      appLog('data', error.cancelled ? 'export cancelled' : `export failed: ${error.message}`);
      return error.cancelled ? {ok: false, cancelled: true} : {ok: false, error: error.message};
    } finally { exportStop = null; }
  });
  // Settings → Cancel export: the Notion copy stops at its next request and no file is written.
  let exportStop = null;
  ipcMain.handle('exportCancel', () => { exportStop?.abort(); return !!exportStop; });
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
    restartApp('import');
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
  // Every Applied decision lands in the log, whoever made it: the two buttons here, the extension's own report
  // (server.js), and a mistaken one's undo (notSubmitted below). "Who decided this, and why?" is answerable from
  // logs/app.log alone (1 Oct 2026).
  ipcMain.handle('deleteJob', async (_, url) => {
    if (DEMO) return {ok: true, trashed: 0};
    const result = await pipeline.deleteJob(storage, String(url)).catch(error => ({ok: false, error: error.message}));
    let host = ''; try { host = new URL(String(url)).hostname; } catch { /* not an address */ }
    appLog('jobs', result?.ok ? 'deleted a dismissed job' : 'job not deleted', {host, trashed: result?.trashed ?? 0, by: 'you', error: result?.ok ? undefined : result?.error});
    if (result?.ok) viewCache.jobDeleted(storage, String(url));
    return result;
  });
  ipcMain.handle('setStatus', async (_, url, status) => {
    const reason = notionGate.statusReason(status);
    const gate = reason && needsNotion(reason);
    if (gate) return gate;
    if (status !== 'applied') {
      const result = await pipeline.setStatus(storage, url, status);
      if (result?.ok) viewCache.statusChanged(storage, String(url), status, result.stage);
      return result;
    }
    const job = String(url);
    appLog('applied', `asked from the app (you): ${job}`);
    const result = await pipeline.setStatus(storage, job, status).catch(error => ({ok: false, error: error.message}));
    appLog('applied', `asked from the app (you): ${job} -> ${result?.ok ? 'marked applied' : result?.error || 'failed'}`);
    if (result?.ok) { track('applied', {how: 'manual'}); server.sessionSubmitted(job); viewCache.statusChanged(storage, job, status, result.stage); }   // the job is Applied: its sessions are over, as for a submit the extension saw
    return result;
  });
  // Focus: what to do next (Notion, no AI); Done on a reply logs a "Replied" event.
  // Demo mode: the fictional list in demo/focus.json (JOB_PILOTTO_DEMO_FOCUS_DELAY ms first, to see the loading state;
  // JOB_PILOTTO_DEMO_FOCUS=<file> another fictional list, e.g. e2e/mail-states.mjs's open and answered questions).
  // Demo mode remembers what you do there, as Notion would for a person: an answered "which job?" leaves Focus and is
  // answered, a built prep kit is ready. Without it every re-read of the file undid it (owner, 6 Oct 2026).
  let demoFocus = null;
  const demoFocusData = () => demoFocus || (demoFocus = JSON.parse(fs.readFileSync(process.env.JOB_PILOTTO_DEMO_FOCUS || path.join(here, 'demo', 'focus.json'), 'utf8')));
  ipcMain.handle('focus', async () => {
    const gate = needsNotion('focus');
    if (gate) return gate;
    if (!DEMO) return viewCache.remember(storage, 'focus', await pipeline.focus(storage));
    await new Promise(resolve => setTimeout(resolve, Number(process.env.JOB_PILOTTO_DEMO_FOCUS_DELAY) || 0));
    return {ok: true, focus: demoFocusData()};
  });
  // The daily applications target lives on ⚙️ Search settings in Notion (Focus, Settings and the wizard set it).
  ipcMain.handle('dailyTarget', () => ({target: DEMO ? JSON.parse(fs.readFileSync(path.join(here, 'demo', 'focus.json'), 'utf8')).today.target : strategy.dailyTarget(storage), reminders: storage.settings().focusReminders !== false}));
  // Is the candidate looking for IT work? The tips keep their IT examples for those who are (renderer/audience.js; with no roles known yet the general version is shown).
  ipcMain.handle('audience', () => {
    if (DEMO) return {technical: true};   // the demo candidate is an SRE
    let keywords = [], places = [];
    try {
      const search = JSON.parse(fs.readFileSync(path.join(storage.path('config'), 'search.json'), 'utf8'));
      keywords = search.role_keywords || [];
      places = ['top_tier', 'country_wide', 'abroad'].flatMap(key => search.locations?.[key] || []);   // top cities first: the first one is the candidate's own example
    } catch { /* no search yet */ }
    return {technical: clearlyTechnical(keywords), places: places.slice(0, 12)};
  });
  ipcMain.handle('setDailyTarget', async (_, value) => {
    if (DEMO) return {ok: true, target: strategy.clampTarget(value)};
    const gate = needsNotion('focus');
    if (gate) return gate;
    try {
      return {ok: true, target: await strategy.setDailyTarget(storage, value, settingsDeps())};
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
    if (DEMO) {
      const item = demoFocusData().items.find(one => one.kind === 'prepare' && one.page_id === pageId);
      if (item) Object.assign(item, {prep_at: new Date().toLocaleDateString('en-CA'), prep_stale: false});
      return {ok: true, text: 'Prep kit ready (demo): nothing was written.'};
    }
    if (!aiReady()) return {ok: false, text: 'The prep kit needs AI: choose Claude Code or add an API key (Settings → Connections → AI).'};
    // Its lines and result also go to logs/app.log (a failed kit left no trace before).
    return pipeline.interviewPrep(storage, String(pageId), line => {
      log(line);
      appLog('prep', line);
      if (/^⏳/.test(line)) toWindow('prepStep', line.replace(/^⏳\s*/, ''));
    }).then(result => { appLog('prep', `${pageId}: ${result?.ok ? 'ready' : 'failed'}`, {text: result?.text || result?.error}); return result; });
  });
  ipcMain.handle('describeJob', (_, pageId, text = '', url = '') => (DEMO ? {ok: true, text: 'Saved (demo).'}
    : pipeline.describeJob(storage, String(pageId), String(text || ''), String(url || ''))));
  // Where an email belongs: Focus → "Is this about …?" (src/ai/reassign.py).
  ipcMain.handle('reassignEmail', (_, eventId, target) => {
    if (!DEMO) return pipeline.reassignEmail(storage, String(eventId), String(target));
    const focus = demoFocusData();
    const at = focus.items.findIndex(one => one.kind === 'which_job' && one.event_id === eventId);
    if (at >= 0) {
      const [item] = focus.items.splice(at, 1);
      const job = JSON.parse(fs.readFileSync(path.join(here, 'demo', 'jobs.json'), 'utf8')).jobs.find(one => one.url === target);
      const label = target === 'none' ? '' : job ? `${job.company || job.via} — ${job.title}` : `${item.company || 'New job'} — new job`;
      focus.answered_questions = [{subject: item.subject, job: label, at: new Date().toISOString()}, ...(focus.answered_questions || [])];
    }
    return {ok: true, text: 'Moved (demo): nothing was written.'};
  });
  ipcMain.handle('focusHistory', () => (DEMO ? demoHistory() : needsNotion('focus') || pipeline.focusHistory(storage)));
  ipcMain.handle('focusDone', (_, pageId, what = 'replied') => (DEMO ? {ok: true} : needsNotion('focus') || pipeline.focusDone(storage, String(pageId), String(what))));
  // Focus → "Did the interview happen?": held (notes), moved (a new time) or cancelled; Notion first.
  ipcMain.handle('interviewHappened', (_, pageId, answer, detail = {}) => (DEMO ? {ok: true, review: false}
    : pipeline.interviewHappened(storage, String(pageId), String(answer), detail || {})));
  ipcMain.handle('feedbackAction', (_, pageId, action, text = '') => (DEMO ? {ok: true}
    : pipeline.feedbackAction(storage, String(pageId), String(action), String(text))));
  // A rejected job's menu → Why was I rejected? (also runs by itself after the Gmail check logs a rejection).
  ipcMain.handle('reviewRejection', async (_, url) => {
    if (DEMO) return {ok: true, text: 'Reviewed (demo): nothing was written.'};
    if (!aiReady()) return {ok: false, text: 'The review needs AI: choose Claude Code or add an API key (Settings → Connections → AI).'};
    try { return await pipeline.reviewRejection(storage, url, log); } catch (error) { return {ok: false, text: error.message}; }
  });
  ipcMain.handle('apply', async (_, options) => needsNotion('apply') || allowanceBlock() || (options?.mode === 'agents' && !(await claudeConsent())
    ? {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'} : apply.start(storage, options, undefined, undefined, undefined, undefined, (code, name) => prepareKitFor(code, name, {quiet: true}), text => toWindow('applyProgress', text))));
  ipcMain.handle('applyOne', async (_, url, details) => {
    const gate = needsNotion('apply');
    if (gate) return gate;
    const blocked = allowanceBlock();
    if (blocked) return blocked;
    const result = await (DEMO ? apply.openOne(url) : apply.applyOne(storage, url, details || {}));
    if (result?.ok) track('apply_started', {how: 'extension'});
    return result;
  });
  // Checked session workflows share the production registration with the offline app scenario tests.
  registerSessionHandlers({ipcMain, appLog, storage, getWindow: () => window, dialog, nativeImage, here,
    DEMO, apply, pipeline, review, server, notion, claudeConsent});
  const startClaude = async (url, details = null) => allowanceBlock() || (await claudeConsent())
    ? apply.claudeOne(storage, url, undefined, undefined, undefined, details).then(result => { if (result?.ok) track('apply_started', {how: 'claude'}); terminals.dropForm(String(url).split('#')[0]); return result; })
    : {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'};
  ipcMain.handle('applyWithClaude', (_, url, details = null) => startClaude(url, details));
  server.setTakeOverHandler(async event => {   // the panel's button: the person's own request, the same start as the session card's Apply with Claude
    const job = event.job;
    appLog('extension', 'take over with Claude asked from the page', {host: event.host, known: !!job});
    const result = await startClaude(String(event.url || ''), job ? {title: job.title, company: job.company, location: job.location, workMode: job.work_mode} : null);
    if (result?.ok) { if (result.session?.id) toWindow('session', 'open', {id: result.session.id}); } else toWindow('toast', {title: 'Claude could not start', body: result?.error || 'Try again from the Applying page.'});
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
    const key = String(id), name = String(label || '');
    // On a Mac the form tab is found and brought forward first, through Chrome's own tab list: at once, whatever the page is
    // doing (a background tab's timers are slow). One attempt: it worked, or it says no tab is this job's form.
    if (process.platform === 'darwin') {
      // The page this session's own reports came from, and the pages other sessions' came from (never taken for this one).
      const states = review.allStates();
      const hints = {own: states.find(state => state.id === key)?.url || '', claimed: states.filter(state => state.id !== key).map(state => state.url).filter(Boolean)};
      const direct = await openFormTab({url, company}, shell.openExternal, {confident: true, ...hints}).catch(() => 'none');
      if (direct !== 'tab') {
        appLog('review', `show ${key}: no tab is this job's form; nothing queued`, {went: direct});
        review.forget(key);
        return {taken: false, went: 'none', found: null};
      }
      if (!name) { appLog('review', `show ${key}: went straight to the form tab`, {went: direct}); return {taken: true, went: direct, found: null}; }
      // A field: the tab is in front now, so its page checks in quickly and scrolls to it.
      review.queueFocus(key, name);
      const answered = await review.delivered(key, 6000);
      if (!answered) review.cancelFocus(key);  // nobody took it: it must not fire later
      const seen = answered ? await review.focusFound(key, 3000) : null;
      appLog('review', `show ${key}: tab in front, ${answered ? 'the page took the field' : 'the page did not answer'}`, {label: name.slice(0, 60), found: seen});
      return {taken: answered, went: 'tab', found: seen};
    }
    review.queueFocus(key, name);
    let taken = await review.delivered(key, 4000);  // the page checks in every 2 s
    if (!taken) {
      // The tab Claude opened has no panel. Wake the extension and inject into that tab; do not reload it.
      let host = '';
      try { host = new URL(String(url || '')).hostname; } catch { /* no url */ }
      appLog('review', 'extension not on the form tab: joining it', {host});
      await extensionInstall.openInChrome(`chrome-extension://${server.EXTENSION_ID}/wake.html`, {browser: apply.extensionBrowser()}).catch(() => {});
      taken = await review.delivered(key, 6000);
    }
    if (!taken) review.cancelFocus(key);  // nobody took it: it must not fire later and pull Chrome forward
    const went = taken ? 'tab' : await openFormTab({url, company}, shell.openExternal);
    appLog('review', `show ${key}: ${taken ? 'form page answered' : `no page answered, app went to: ${went}`}`, {label: name.slice(0, 60), taken: !!taken, went});
    const found = taken && name ? await review.focusFound(key, 3000) : null;
    return {taken, went, found};
  };
  ipcMain.handle('reviewFocus', async (_, id, label, url, company) => {
    const result = await showForm(id, label, url, company);
    const seen = server.extensionSeen(), latest = server.latestExtension();
    return {...result, extension: seen?.version || '', latest, outdated: !!(seen?.version && latest && seen.version !== latest)};
  });
  ipcMain.handle('unapplyJob', (_, url) => pipeline.unapply(storage, String(url)));
  // "This wasn't submitted": only ever asked for by the user, and only from a bare Applied.
  ipcMain.handle('notSubmitted', (_, url) => {
    const job = String(url);
    appLog('applied', `not submitted: undo asked for ${job}`);
    return pipeline.notSubmitted(storage, job).then(result => {
      appLog('applied', `not submitted: ${job} -> ${result.notion || result.error} (${result.events || 0} event(s) removed)`);
      return result;
    });
  });
  // "How did it go?" on a job: written to Notion like a stage the Gmail check found, then counted anonymously (lib/outcomes.js) if reports are on.
  ipcMain.handle('markOutcome', async (_, input) => {
    const outcome = String(input?.outcome || ''), url = String(input?.url || '');
    const stage = applicationOutcomes.STAGES[outcome];
    if (!stage || !url) return {ok: false, error: 'Unknown outcome.'};
    if (DEMO) return {ok: true, stage};
    appLog('outcome', `marked ${outcome} (${stage})`, {board: applicationOutcomes.anonymous({url, outcome})?.board || ''});
    const result = await pipeline.markOutcome(storage, url, stage);
    if (result.ok && outcome !== 'withdrawn') recipeReporterRef?.application(applicationOutcomes.anonymous({url, outcome, appliedOn: input?.appliedOn}));
    if (result.ok && outcome !== 'withdrawn') recipeReporterRef?.reply(String(input?.bucket || ''), outcome);   // the job's score band, to see whether the score predicts replies
    return result;
  });
  ipcMain.handle('claudeReady', () => apply.claudeReady(storage));
  ipcMain.handle('claudePrereqs', async () => ({...apply.claudePrereqs(), inApp: await terminals.available()}));
  // Gmail and Calendar (read-only): replies and interviews, and sign-up confirmation emails for Apply with Claude.
  // The token lives in the Keychain, where the Python side (src/sources/google.py) reads it.
  // One Gmail check shared by every view (lib/shared-check.js): Settings' overview and the Gmail card ask at once.
  const googleStatus = sharedCheck(async () => {
    const {stdout} = await pipeline.run(storage, ['src.sources.google', 'status']);
    return JSON.parse(stdout.trim().split('\n').pop());  // unreadable: throws, so it isn't kept and is retried
  });
  ipcMain.handle('googleStatus', async () => {
    // Demo mode: the fictional user's account. The real check reads this Mac's Google sign-in (the Keychain, not the
    // demo folder), which put the owner's own address into the reference screenshots.
    // JOB_PILOTTO_DEMO_GOOGLE=off shows the disconnected states (the state viewer, e2e/mail-states.mjs).
    if (DEMO) return process.env.JOB_PILOTTO_DEMO_GOOGLE === 'off' ? {connected: false} : {connected: true, email: 'alex.morgan@example.com'};
    try { return await googleStatus(); } catch { return {connected: false}; }
  });
  ipcMain.handle('googleConnect', async () => {
    const gate = needsNotion('gmail');
    if (gate) return gate;
    const lines = [];
    const {code} = await pipeline.run(storage, ['src.sources.google', 'auth'], line => lines.push(line));
    googleStatus.forget();   // the next status asks again, so the new account shows at once
    // Always on: the new sign-in goes to the GitHub repo too, so the Gmail check there can use it.
    if (code === 0 && cloud()) github.updateRepo(storage).catch(error => log(`Google sign-in not sent to GitHub: ${error.message}`));
    return code === 0 ? {ok: true} : {ok: false, error: lines.filter(line => !/^Opening|^https?:/.test(line)).slice(-1)[0] || 'Sign-in did not complete'};
  });
  // Settings → Gmail and Calendar → ⋯ → Disconnect Gmail (owner, 7 Oct 2026): revoked at Google, forgotten in the Keychain and, with
  // Always on, in the GitHub repo. Logged: what was asked and what each step did, never the token.
  ipcMain.handle('googleDisconnect', async () => {
    if (DEMO) return {ok: false, error: 'Demo mode: the sign-in is not changed.'};
    const {code, stdout} = await pipeline.run(storage, ['src.sources.google', 'disconnect']);
    let result = {};
    try { result = JSON.parse(String(stdout).trim().split('\n').pop()); } catch {}
    googleStatus.forget();
    let inRepo = false;
    if (code === 0 && cloud()) inRepo = await github.removeRepoSecrets(storage, Object.keys(GOOGLE_KEYCHAIN)).catch(error => { appLog('connections', 'Gmail secrets not removed from GitHub', {error: error.message}); return 'failed'; });
    appLog('connections', 'Gmail disconnected', {from: 'settings', code, revoked: !!result.revoked, wasConnected: !!result.was_connected, github: inRepo});
    return code === 0 && result.ok ? {ok: true, revoked: !!result.revoked, github: inRepo} : {ok: false, error: 'Gmail could not be disconnected: try again'};
  });
  ipcMain.handle('openTabs', () => server.openTabs());
  // Which sessions' forms are still open in Chrome, by the extension's own tab report. `known` is false while the
  // extension has not checked in lately: then nothing can be said about a closed tab, so the page says nothing.
  let lastFormsOpen = '';
  ipcMain.handle('formsOpen', () => {
    const seen = server.extensionSeen(), known = !!seen && Date.now() - seen.at < 90 * 1000;
    if (!known) return {known, ids: []};
    // A session whose own tab we know is open while that tab exists; for the others, any tab that looks like its form.
    const sessions = terminals.list(), byLook = withOpenForm(sessions, mergeTabs(server.openTabs(), []));
    const ids = sessions.map(session => session.id).filter(id => { const own = review.tabOpen(id); return own === null ? byLook.has(id) : own; });
    const line = ids.join(',') || 'none';
    if (line !== lastFormsOpen) { lastFormsOpen = line; appLog('review', `forms open in Chrome: ${line}`, {sessions: sessions.length}); }   // who is open, when it changed
    return {known, ids};
  });
  // App updates (lib/updater.js): the latest stable release, offered in the menu; one click installs it.
  // Technical reports: the window's own errors come here; Settings shows the last ones sent and the switch.
  // Settings → License: where the user stands, pasting a key (checked offline), removing it.
  ipcMain.handle('license', () => ({...licenseState(), text: licenseLib.text(licenseState())}));
  ipcMain.handle('licenseSet', (_, key) => {
    if (DEMO) return {ok: false, error: 'Demo mode: keys are not saved.'};
    const result = license.set(String(key || ''));
    return result.ok ? {ok: true, state: {...result.state, text: licenseLib.text(result.state)}} : result;
  });
  ipcMain.handle('licenseRemove', () => { const state = license.remove(); return {...state, text: licenseLib.text(state)}; });
  ipcMain.handle('telemetryRecord', (_, kind, fields) => {
    // A window error also goes to app.log (type and message; the stack stays in the report): it was invisible there.
    if (kind === 'advice') appLog('advice', `${String(fields?.act || '?').slice(0, 10)} ${String(fields?.advice || '?').slice(0, 20)} on ${String(fields?.where || '?').slice(0, 20)}`, fields?.source ? {source: String(fields.source).slice(0, 30)} : {});   // what the app recommended, and what was taken
    if (kind === 'crash') appLog('window', `error on ${String(fields?.page || '?').slice(0, 30)}: ${String(fields?.type || 'Error').slice(0, 40)}: ${String(fields?.message || '').slice(0, 300)}`);
    telemetry?.record(String(kind), fields || {});
    return true;
  });
  // The switch shows the saved choice (on unless turned off), also in a build that doesn't send (the reporter is null there).
  ipcMain.handle('telemetryShown', () => ({on: storage.settings().telemetry !== false, events: telemetry?.shown() || [], shared: sharedLog.list(storage), tester: testerOn(), testerLogs: testerLogsOn()}));
  ipcMain.handle('testerLogsSet', (_, on) => { storage.saveSettings({testerLogs: !!on}); appLog('telemetry', `tester run logs ${on ? 'on' : 'off'}`); return {on: !!on}; });
  // "Help the pool grow" (opt-out, lib/pool-share.js): the switch, and exactly what would be sent (python -m src contribute --show).
  ipcMain.handle('poolShareGet', () => ({on: poolShare.on(storage)}));
  ipcMain.handle('poolShareSet', async (_, value) => {
    const result = poolShare.set(storage, value);
    appLog('pool', `Help the pool grow ${value ? 'on' : 'off'}`, {decidedBy: 'user switch'});
    if (cloud()) github.updateRepo(storage).catch(error => log(`GitHub repo not updated: ${error.message}`));
    return result;
  });
  ipcMain.handle('poolShareShown', async () => {
    const {code, stdout} = await pipeline.run(storage, ['src.contribute', '--show']);
    return {text: code === 0 ? stdout.trim() : 'Could not work out what would be sent right now.'};
  });
  ipcMain.handle('telemetrySet', (_, on) => { storage.saveSettings({telemetry: !!on}); if (!on) telemetry?.flush(); return {on: !!on}; });
  ipcMain.handle('updateState', () => updateOffer);
  ipcMain.handle('updateCheck', () => checkForUpdate(true));
  ipcMain.handle('updateStatus', () => ({current: app.getVersion(), offer: updateOffer, checkedAt: updateCheckedAt, fromSource: FROM_SOURCE}));
  ipcMain.handle('updateInstall', () => installUpdate());
  // Beta (Settings → Diagnostics → Beta). Asked here, in the main process: only a click on this dialog turns it on, never a script in the window.
  // Beta builds are only the ones the release gate approved (tools/beta-approve.sh); "Back to stable" installs the latest stable release even though it is older.
  const parentWindow = () => (window && !window.isDestroyed() ? window : undefined);
  ipcMain.handle('betaState', async () => {
    const stable = FROM_SOURCE ? null : await updater.stableRelease(app.getVersion()).catch(() => null);
    return {on: betaOn(), current: app.getVersion(), stable: stable?.version || '', ahead: !!stable?.ahead, fromSource: FROM_SOURCE};
  });
  ipcMain.handle('betaSet', async (_, want) => {
    if (DEMO || FROM_SOURCE) return {ok: false, text: 'Not in demo mode or when running from source.'};
    if (want) {
      const {response} = await dialog.showMessageBox(parentWindow(), {type: 'question', message: 'Get the beta version?', buttons: ['Join the beta', 'Not now'], defaultId: 1, cancelId: 1,
        detail: 'Be the first to test new features. Beta versions pass our automatic checks, but can still have bugs. Job Pilotto will offer you each one; nothing installs without your click.\n\nYou can go back to the stable version any time: Settings → Diagnostics → Beta → Back to stable.'});
      if (response !== 0) return {ok: false, cancelled: true};
    }
    storage.saveSettings({betaChannel: !!want});
    appLog('update', `beta channel ${want ? 'on' : 'off'}`, {version: app.getVersion()});
    checkForUpdate();
    return {ok: true, on: !!want};
  });
  ipcMain.handle('betaRollback', async () => {
    if (DEMO || FROM_SOURCE) return {ok: false, text: 'Not in demo mode or when running from source.'};
    const stable = await updater.stableRelease(app.getVersion()).catch(error => ({error}));
    if (stable?.error) return {ok: false, text: `Couldn't reach GitHub: ${stable.error.message}`};
    if (!stable?.ahead) return {ok: false, text: 'You are not ahead of the stable version.'};
    const {response} = await dialog.showMessageBox(parentWindow(), {type: 'question', message: `Go back to stable ${stable.version}?`, buttons: ['Go back to stable', 'Cancel'], defaultId: 0, cancelId: 1,
      detail: `You have ${app.getVersion()}. The app closes, installs the stable version and opens again. Your jobs and answers are in Notion and stay as they are. The beta is switched off; you can join again any time.`});
    if (response !== 0) return {ok: false, cancelled: true};
    storage.saveSettings({betaChannel: false});
    updateOffer = stable;
    appLog('update', `back to stable: ${app.getVersion()} -> ${stable.version}`);
    return installUpdate();
  });
  // Why setup stopped (the quit question or "Stuck? Tell us"): a setup report; typed words also reach the owner.
  ipcMain.handle('leaveReason', async (_, answer = {}) => {
    const event = answer.reason ? setupFunnel.stopped(answer, storage.settings()) : null;
    if (event && telemetry) { telemetry.record('setup', event); await telemetry.flush().catch(() => {}); }
    if (event?.said) await appFeedback.send({text: `[Setup · ${event.where} · ${setupFunnel.REASONS[event.reason]}] ${event.said}`, contact: answer.contact || ''},
      {storage, version: app.getVersion()}).catch(() => {});
    if (answer.mode === 'quit') setTimeout(() => app.quit(), 100);
    return {ok: true};
  });
  // Send feedback… (lib/app-feedback.js): to the owner, through the website. Demo mode sends nothing.
  ipcMain.handle('sendFeedback', (_, text, contact) => DEMO ? {ok: true}
    : appFeedback.send({text, contact}, {storage, version: app.getVersion()}).then(result => { if (result?.ok) track('feedback_sent', {}); return result; }));
  // latest + note: the pages show one wording for a stale copy (server.staleExtension), the same sentence the app
  // records with a failed fill.
  ipcMain.handle('extensionSeen', () => {
    const seen = server.extensionSeen();
    if (!seen) return null;
    const latest = server.latestExtension();
    return {...seen, latest, note: server.staleExtension(seen.version, latest)};
  });
  // A failed Notion read is reported (not an empty list), so the section says why instead of disappearing.
  ipcMain.handle('openQuestions', () => (DEMO ? Promise.resolve(storage.settings().openQuestions || []) : questions.list(storage)).then(list => ({ok: true, list}), error => ({ok: false, error: error.message, list: []})));
  ipcMain.handle('answerQuestion', (_, questionKey, answer) => needsNotion('profile') || questions.answer(storage, questionKey, answer)
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // A session's ❓ fact, answered with one tick on the session page: saved to the standard answers page.
  ipcMain.handle('rememberAnswer', (_, question, answer) => (DEMO ? Promise.resolve({ok: true}) : needsNotion('profile') || questions.remember(storage, question, answer))
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // Saved keys as dots plus their last 4 characters, so Settings can show which key is stored (never the key).
  ipcMain.handle('secretHints', () => Object.fromEntries(['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY']
    .map(name => [name, storage.secret(name)]).filter(([, value]) => value).map(([name, value]) => [name, `${'•'.repeat(12)}${value.slice(-4)}`])));
  // The application kit: the form's questions (read from the ATS), an answer for each and a cover letter,
  // saved on the job's Notion Applications row (Stage Kit ready). Apply needs one.
  const prepareKitFor = async (code, name = 'this job', {quiet = false} = {}) => {
    const gate = needsNotion('prepare');
    if (gate) return gate;
    const blocked = allowanceBlock();
    if (blocked) return blocked;
    // With Always on, background jobs run in the user's GitHub repo: Recent activity
    // shows it starting, its progress and its result (its ⏱️ Search runs row); the job's row updates from Notion.
    if (cloud()) {
      const started = await dispatchCloud(`Application kit (${name})`, {mode: 'prepare', job: code});
      return started.ok ? {ok: true, cloud: true} : {ok: false, error: started.error};
    }
    // Quietly: the result comes as a notification (and the row's Apply), not as log output.
    const lines = [];
    const {code: exit} = await pipeline.run(storage, pipeline.dailyArgs(storage, {mode: 'prepare', job: code}), line => lines.push(line),
      pipeline.triggerEnv('you'));
    const ineligible = lines.map(line => line.replace(/<[^>]+>/g, '')).find(line => line.includes('Not eligible:'));
    if (quiet) { if (exit === 0) track('kit_prepared', {}); return {ok: exit === 0}; }  // an Apply batch: it reports once at the end
    if (exit !== 0) notify('Kit not prepared', `${name}: ${lines.filter(Boolean).slice(-1)[0] || 'something went wrong'}`, {view: 'jobs', job: code});
    else notify('Application kit ready ✓', ineligible ? `${name}. ${ineligible.trim()}` : `${name}. Press Apply to fill the form.`, {view: 'jobs', job: code});
    if (exit === 0) track('kit_prepared', {});
    return {ok: exit === 0, ineligible: ineligible || ''};
  };
  ipcMain.handle('prepareKit', (_, code, name) => prepareKitFor(code, name));
  // Tailored CV for one job: base CV (imported from the CV PDF the first time) + the posting -> Claude ->
  // checked -> PDF. A fixed-page design that overflows gets one second try with that feedback.
  const tailorCv = async (code, name = 'this job', {show = true, quiet = false} = {}) => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try {
      let cost = 0;
      if (!cvlib.baseCv(storage)) {
        if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF) in Settings first.'};
        cost += (await cvlib.importPdf(storage, key, ai, {look: keepLook})).usd;
      }
      const job = await pipeline.posting(storage, code);
      if (!job.ok) return {ok: false, error: job.error};
      const base = cvlib.baseCv(storage);
      const {profile} = await strategy.profileTexts(storage);
      let feedback = '', result, applied, printed;
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await cvlib.tailor(storage, job, key, {client: ai, feedback, profile});
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
      if (!quiet) notify('Tailored CV ready ✓', `${name}: ${result.changes.length} changes${applied.warnings.length ? `, ${applied.warnings.length} to check` : ''}.`
        + (inNotion ? ' Saved in Notion too.' : ' On this Mac only: save the job (☆) to keep it in Notion.'), {view: 'jobs', job: code});
      if (show) openTailoredCv(code);   // from the form's panel the window stays behind: the person is on the form, the notification says it is ready
      return {ok: true, usd: record.usd};
    } catch (error) {
      if (!quiet) notify('CV not tailored', `${name}: ${error.message}`, {view: 'jobs', job: code});
      return {ok: false, error: error.message};
    }
  };
  ipcMain.handle('tailorCv', (_, code, name) => tailorCv(code, name));
  // Tailor CVs for top matches (Actions): the best N open jobs without a tailored CV, one after another (about 1-2 minutes each),
  // so the form needs no wait for it. One notification at the end; each CV is listed on its job as 📄 Tailored CV to check.
  ipcMain.handle('tailorTop', async (_, count) => {
    const n = Math.max(1, Math.min(10, Number(count) || 5));
    const gate = needsNotion('tailor');
    if (gate) return gate;
    const blocked = allowanceBlock();
    if (blocked) return blocked;
    appLog('cv', 'tailor top matches', {asked: n, by: 'you'});
    // A tracked task like a Jobs check: the banner, a live log, a row in Recent activity and the result line. Started, not awaited: the window follows it.
    pipeline.work(storage, 'tailor', log, async tee => {
      let done = 0, failed = 0, usd = 0;
      const tailored = [];
      tee(`Finding your ${n} best matches without a tailored CV…`);   // reading the job list takes a few seconds: the banner is already up
      const picked = apply.pickUntailored((await pipeline.jobs(storage)).jobs, n);
      appLog('cv', 'tailor top matches picked', {asked: n, jobs: picked.length});
      if (!picked.length) {
        const none = 'Every one of your best matches already has a tailored CV.';
        tee(none); tee('<<<message'); tee(none); tee('message>>>');
        return true;
      }
      tee(`Tailoring ${picked.length} CV${picked.length === 1 ? '' : 's'} for your best matches (1-2 minutes each)`);
      for (const [index, job] of picked.entries()) {
        tee(`Tailoring ${index + 1} of ${picked.length}: ${job.title} · ${job.company}`);
        const result = await tailorCv(job.code, `${job.title} · ${job.company}`, {show: false, quiet: true});
        if (result.ok) { done++; usd += result.usd || 0; tailored.push(job); tee(`  ✓ ${job.title} · ${job.company}`); } else {
          failed++;
          tee(`  ✗ ${job.title} · ${job.company}: ${String(result.error || 'something went wrong').slice(0, 120)}`);
          appLog('cv', 'tailor top matches: one failed', {job: job.code, reason: String(result.error || '').slice(0, 80)});
        }
      }
      appLog('cv', 'tailor top matches done', {done, failed, usd: Math.round(usd * 100) / 100});
      const text = `Tailored ${done} of ${picked.length} CV${picked.length === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}. Open each job's 📄 Tailored CV to check it before you apply.`;
      tee(text);
      // The card (renderer/kits-ready.js reads this shape): the count, then each tailored job's title with its link, and its company.
      tee('<<<message');
      if (tailored.length) {
        tee('✂️ Tailored CVs ready');
        tee(`${done} of ${picked.length} tailored${failed ? ` · ${failed} failed` : ''} · check each before you apply`);
        for (const job of tailored) { tee(''); tee(`${job.title} (${job.url})`); tee(job.company); }
      } else tee(text);
      tee('message>>>');
      return done > 0;
    }).catch(error => log(`Tailor CVs failed: ${error.message}`));
    return {ok: true, started: true, text: 'Tailoring started.'};
  });
  // CV match (Jobs ⋯ and the session card): this job's posting against the CV, on request. The last answer is kept per job for the CV it was made with.
  ipcMain.handle('matchSaved', (_, code) => { if (DEMO) return demo.matchSaved; const cv = cvlib.baseCv(storage); return cv ? matchCheck.saved(storage, String(code), cv) : null; });
  ipcMain.handle('matchCheck', async (_, code) => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try {
      let cost = 0;
      if (!cvlib.baseCv(storage)) {
        if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF) in Settings first.'};
        cost += (await cvlib.importPdf(storage, key, ai, {look: keepLook})).usd;
      }
      const job = await pipeline.posting(storage, String(code));
      if (!job.ok) return {ok: false, error: job.error};
      const cv = cvlib.baseCv(storage), {profile} = await strategy.profileTexts(storage).catch(() => ({profile: ''}));
      const result = await matchCheck.check(storage, key, {job, cv, profile, client: ai});
      appLog('cv', 'match check', {grade: result.grade, musts: result.musts.length, knockouts: result.knockouts.length, usd: result.usd});
      return {ok: true, ...matchCheck.save(storage, String(code), cv, job, {...result, usd: Math.round((result.usd + cost) * 100) / 100})};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('cvOf', (_, url) => cvOf(String(url || '')));   // the session card: tailored for this job already, or being tailored now
  // The form panel's "Tailor my CV for this job": the person's own click, the same work as the menu's Tailor CV.
  server.setTailorHandler(async event => {
    const job = event.job;
    appLog('extension', 'tailor CV asked from the form', {known: !!job?.code});
    if (!job?.code) { toWindow('toast', {title: 'CV not tailored', body: 'This job is not in your list yet: add it first.'}); return; }
    const key = server.pageKey(job.url);
    if (tailoring.has(key)) return;
    tailoring.add(key);
    try { await tailorCv(job.code, `${job.title} · ${job.company}`, {show: false}); } finally { tailoring.delete(key); }
  });
  // A job's code (the Jobs list) or its posting address (a Tailor CVs card knows only the link).
  ipcMain.handle('openTailoredCv', (_, which) => openTailoredCv(/^https?:/.test(String(which)) ? cvlib.forUrl(storage, String(which))?.job?.code : which));
  // The base CV the tailoring starts from: import it from the CV PDF (again), see it, or edit its files.
  // CV check (Profile → CV): how a parser reads the uploaded PDF (free), then one AI review of what it says (a few cents). A cache of the PDF: cv/check.json.
  ipcMain.handle('cvCheckStatus', () => (DEMO ? demo.cvCheck : cvCheck.saved(storage)));
  ipcMain.handle('cvCheckRun', async () => {
    if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF) in Settings first.'};
    let probe;
    try {
      probe = await cvLook.probeWindow(BrowserWindow, storage.path('cv.pdf'));
      const result = cvCheck.analyse(await probe.scan());
      appLog('cv', 'parser check', {score: result.score, pages: result.pages, issues: result.checks.filter(c => c.status !== 'pass').map(c => c.id)});
      return {ok: true, ...cvCheck.save(storage, {ats: result})};
    } catch (error) { return {ok: false, error: `The CV could not be read: ${error.message}`}; } finally { probe?.close(); }
  });
  ipcMain.handle('cvCheckAi', async () => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    const ats = cvCheck.saved(storage)?.ats;
    if (!ats) return {ok: false, error: 'Check the CV first.'};
    try {
      const {profile} = await strategy.profileTexts(storage).catch(() => ({profile: ''}));
      const result = await cvCheck.review(storage, key, ats.text, {client: ai, profile});
      appLog('cv', 'content review', {score: result.score, fixes: result.fixes.length, usd: result.usd});
      return {ok: true, ...cvCheck.save(storage, {ai: result})};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('cvStatus', () => ({base: !!cvlib.baseCv(storage), custom: fs.existsSync(path.join(cvlib.dir(storage), 'style.css')) || cvlib.baseCv(storage)?.look === 'rich'}));
  handleImportant('importCv', 'Saving your CV', async () => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF) first.'};
    try { return {ok: true, usd: (await cvlib.importPdf(storage, key, ai, {look: keepLook})).usd}; } catch (error) { return {ok: false, error: error.message}; }
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
  // The general cover letter (Settings → Profile → Cover letter): drafted from the CV + Profile + standard answers,
  // reviewed by the user, approved -> PDF. See lib/cover-letter.js.
  ipcMain.handle('coverLetter', () => letters.status(storage));
  ipcMain.handle('coverLetterDraft', async (_, feedback = '') => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try {
      if (!cvlib.baseCv(storage)) {
        if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF) first.'};
        await cvlib.importPdf(storage, key, ai, {look: keepLook});
      }
      const {profile, answers} = await strategy.profileTexts(storage);
      const contact = await contactDetails.read(storage).catch(() => ({}));
      const result = await letters.generate(storage, {apiKey: key, client: ai, profile, answers, feedback: String(feedback).slice(0, 1000),
        preferences: storage.readText('config/search.json') || '', name: contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ')});
      appLog('cover-letter', `drafted${feedback ? ' with feedback' : ''}`, {words: result.text.split(/\s+/).length, usd: result.usd});
      return {ok: true, ...letters.status(storage)};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('coverLetterSave', (_, text) => {
    try { letters.edit(storage, text); appLog('cover-letter', 'edited by the user; back to draft'); return {ok: true, ...letters.status(storage)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('coverLetterApprove', async (_, text) => {
    try {
      if (typeof text === 'string') letters.edit(storage, text);
      const record = letters.load(storage);
      if (!record?.text) return {ok: false, error: 'Write or generate a letter first.'};
      const contact = await contactDetails.read(storage).catch(() => ({}));
      fs.mkdirSync(letters.dir(storage), {recursive: true});
      const page = path.join(letters.dir(storage), 'letter.html');
      fs.writeFileSync(page, letters.html(record.text, contact, cvlib.baseCv(storage)), {mode: 0o600});
      letters.approve(storage, (await printPdf(page)).pdf);
      appLog('cover-letter', 'approved; PDF written for form uploads', {words: record.text.split(/\s+/).length});
      // Notion too (the source of truth): best effort, the PDF is on this Mac either way.
      files.coverLetterToProfile(storage, letters.pdfPath(storage)).then(caption => caption && appLog('cover-letter', 'PDF saved to the Notion Profile', {caption}))
        .catch(error => appLog('cover-letter', `not saved to Notion: ${error.message}`));
      return {ok: true, ...letters.status(storage)};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('coverLetterOpen', () => (fs.existsSync(letters.pdfPath(storage)) ? shell.openPath(letters.pdfPath(storage)) : ''));
  ipcMain.handle('showCvFolder', () => { fs.mkdirSync(cvlib.dir(storage), {recursive: true}); return shell.openPath(cvlib.dir(storage)); });
  ipcMain.handle('openExternal', (_, url) => shell.openExternal(url));
  ipcMain.handle('openVisit', (_, url) => visits.open(url));
  ipcMain.handle('focusBrowser', () => visits.focusBrowser());
  ipcMain.handle('visitShowTab', (_, url) => visits.showTab(url));   // Find jobs using your browser' rows (Recent activity): the tab reading this site
  ipcMain.handle('visitAgain', (_, url) => visits.again(url));        // ... and a site whose tab you closed, back in the run
  // Read with Claude: a Claude in Chrome session reads a site the extension could not (Apply with Claude's needs: Claude Code, its consent).
  ipcMain.handle('visitWithClaude', async (_, url, name) => {
    const ready = apply.claudeReady(storage);
    if (!ready.ok) return ready;
    if (!/^https:\/\//.test(url || '')) return {ok: false, error: 'This site has no address to open.'};
    appLog('visit', 'read with Claude started', {host: new URL(url).hostname, by: 'you'});
    const started = await claudeSession.launchRead(storage, url, String(name || '').slice(0, 80), {claude: apply.claudeBinary()}).catch(error => ({error: error.message}));
    if (started?.id) readSites.set(started.id, [url]);
    return started?.error ? {ok: false, error: started.error} : {ok: true};
  });
  // "Read the failed sites with Claude" (owner, 7 Oct 2026): one session reads them in turn (claude-session.js readManyPrompt).
  ipcMain.handle('visitsWithClaude', async (_, sites = []) => {
    const ready = apply.claudeReady(storage);
    if (!ready.ok) return ready;
    const chosen = (Array.isArray(sites) ? sites : []).filter(site => /^https:\/\//.test(site?.url || '')).slice(0, 10)
      .map(site => ({url: String(site.url), name: String(site.name || '').slice(0, 80)}));
    if (!chosen.length) return {ok: false, error: 'These sites have no address to open.'};
    appLog('visit', 'read with Claude started', {sites: chosen.length, hosts: chosen.map(site => new URL(site.url).hostname).join(' '), by: 'you'});
    const started = await claudeSession.launchRead(storage, chosen[0].url, `${chosen.length} sites`, {claude: apply.claudeBinary(), sites: chosen}).catch(error => ({error: error.message}));
    if (started?.id) readSites.set(started.id, chosen.map(site => site.url));
    return started?.error ? {ok: false, error: started.error} : {ok: true};
  });
  ipcMain.handle('visitsList', async () => {
    const {stdout} = await pipeline.run(storage, ['src.desktop', 'visit-list']).catch(() => ({stdout: ''}));
    try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return {ok: false, visits: []}; }
  });
  // "Find jobs using your browser" (Actions): a tracked task like Tailor CVs, so the banner, Recent activity and the result card follow it.
  ipcMain.handle('visitsRun', async (_, {urls = [], atOnce = 2, filter = true} = {}) => {
    const {stdout} = await pipeline.run(storage, ['src.desktop', 'visit-list']).catch(() => ({stdout: ''}));
    const listed = (() => { try { return JSON.parse(String(stdout).trim().split('\n').pop()).visits || []; } catch { return []; } })();
    const chosen = listed.filter(site => urls.includes(site.url));
    if (!chosen.length) return {text: 'Tick at least one site to read.'};
    const n = Math.max(1, Math.min(5, Number(atOnce) || 2));
    // An older extension in Chrome cannot read the sites by itself (owner's run, 7 Oct 2026: it waited 8 min on 0.9.3): said now, not after.
    const seen = server.extensionSeen?.()?.version, latest = server.latestExtension();
    if (seen && latest && seen !== latest) {
      appLog('visit', 'read sites refused: Chrome has an older extension', {seen, latest});
      return {text: `Chrome still has the Job Pilotto extension ${seen}; Find jobs using your browser needs ${latest}. In Chrome open chrome://extensions, press Reload on Job Pilotto, then Run again.`};
    }
    appLog('visit', 'read sites task', {sites: chosen.length, atOnce: n, filter: !!filter, by: 'you'});
    pipeline.work(storage, 'visits', log, async tee => {
      tee(`Reading ${chosen.length} site${chosen.length === 1 ? '' : 's'} in your browser, ${n} at a time`);
      const results = await visits.runAll(chosen, {atOnce: n, filter: !!filter, tee, prepare: async site => (await visits.withJobPages(storage, [site]))[0]});
      // The matching jobs are scored and written to Jobs before this run ends, in its own turn (owner, 7 Oct 2026: "can't we score them right
      // away?"; a search queued after it waited behind Find new employers): the light run that reads only the pages read in Chrome.
      const fits = visits.lastFits();
      let scored = null;
      if (fits && !allowanceBlock()) {
        tee(`Scoring the ${fits} matching job${fits === 1 ? '' : 's'} for your Jobs list…`);
        appLog('visit', 'scoring the jobs read in Chrome inside the read sites run', {fits});
        const {stdout = ''} = await pipeline.run(storage, pipeline.visitsArgs(storage), tee).catch(error => ({stdout: '', error}));
        scored = /Job Matches: (\d+) created/.exec(String(stdout))?.[1] ?? null;
      }
      const text = visits.resultMessage(results, {added: scored === null ? null : Number(scored)});
      tee(text.split('\n')[1]);
      tee('<<<message'); text.split('\n').forEach(line => tee(line)); tee('message>>>');
      return results.some(result => result.ok);
    }).catch(error => appLog('visit', 'read sites run failed', {error: error.message}));
    return {started: true};
  });   // a site only you can open, in the browser that has the extension
  // "Open filled form": Chrome, switched to the form's tab (lib/form-tab.js).
  // "Open filled form": the session's form tab through the extension (an empty label: bring it forward, no scroll).
  // `taken` says whether the page's panel answered — the one thing the window needs to know whether the "Reload the
  // tab" repair applies (1 Oct 2026: it was offered always, next to Open filled form, though it reloads a form page).
  ipcMain.handle('showBrowser', async (_, url, company, id) => (id
    ? (await showForm(id, '', url, company))
    : {went: await openFormTab({url, company}, shell.openExternal), taken: true}));
  // "Reload the tab": the repair for a form page whose panel died with an older extension. Chrome reloads that tab,
  // then the page's fresh panel answers the focus handshake, so one press both heals and brings Chrome to the field.
  ipcMain.handle('reviewReload', async (_, id, url, company) => {
    const seen = server.extensionSeen(), latest = server.latestExtension();
    const current = !!seen?.version && seen.version === latest;  // an older copy ignores the command below, silently
    // 1. The page's own panel: it reloads itself, in whatever browser and instance it runs (no macOS permission).
    if (current) {
      review.queueReload(String(id));
      if (await review.delivered(String(id), 4000)) return {result: 'reloaded', extension: seen.version, latest};
    }
    // 2. No page answered (a panel from an older extension instance can't): Chrome's own scripting can reload the
    //    tab without the extension. It needs the user's Automation permission, and it reaches one instance only.
    const result = await reloadFormTab({url: String(url), company: String(company || '')});
    if (result !== 'reloaded') {
      return {result, extension: seen?.version || '', latest, outdated: !current,
        stray: result === 'no-window' ? (await backgroundChrome.stray())[0] || null : null};
    }
    await new Promise(resolve => setTimeout(resolve, 2500));  // the panel boots and reports within a second or two
    return {result: 'reloaded-chrome', extension: seen?.version || '', latest, ...(await showForm(String(id), '', String(url), String(company || '')))};
  });
  // Notion pages open where the user is already signed in: the Notion app when it's installed, else the
  // browser. ⌘-click opens the app's own Notion window instead (its own sign-in, kept between restarts).
  ipcMain.handle('openNotion', (_, url, inWindow) => {
    if (inWindow) return openNotion(url);
    if (app.getApplicationNameForProtocol('notion://')) return shell.openExternal(url.replace(/^https:\/\//, 'notion://'));
    return shell.openExternal(url);
  });
  ipcMain.handle('showFolder', (_, name) => shell.openPath(name === 'extension' ? path.join(pipeline.REPO, 'extension') : storage.dir));
  ipcMain.handle('extensionInfo', () => ({url: `http://127.0.0.1:${server.PORT}`, token: server.extensionToken(storage)}));
  // A windowless Chrome left behind by an automation holds macOS's one Apple Event connection to Chrome, so this app
  // cannot reach the user's own window. Reported so the card can offer to quit it; only ever an orphaned one
  // (lib/background-chrome.js), never a running automation's.
  ipcMain.handle('strayChrome', () => backgroundChrome.stray());
  ipcMain.handle('quitStrayChrome', (_, pid) => backgroundChrome.quit(Number(pid)));
  const extensionFolder = () => path.join(pipeline.REPO, 'extension');
  // The Chrome extension from the browsers' own records: is it installed, is it on, is that browser up, and which
  // copy is loaded. A file read answers in milliseconds — Settings no longer shows "Checking…" for a minute and then
  // calls it "not connected" (1 Oct 2026).
  ipcMain.handle('extensionInstall', async () => {
    const installed = extensionInstall.installed({folder: extensionFolder()});
    let browserUp = null;
    if (installed.length) {
      const up = await Promise.all([...new Set(installed.map(entry => entry.app))].map(app => extensionInstall.running(app)));
      browserUp = up.some(Boolean);
    }
    return {folder: extensionFolder(), latest: server.latestExtension(), installed, browserUp, browser: apply.launchBrowser(),
      looked: extensionInstall.lookedFor({})};  // where it was looked for, for a browser that keeps profiles elsewhere
  });
  // The computer's part of installing it, in one press: Chrome on its extensions page, the extension's folder in
  // front of the user, and its path on the clipboard — the Load unpacked dialog then takes ⌘⇧G, ⌘V, Return.
  // The step-1 chip: try to open Chrome on its extensions page, and put the URL on the clipboard too — Chrome
  // ignores chrome:// URLs handed to it from outside often enough that the paste has to be the reliable half.
  ipcMain.handle('extensionPage', async () => {
    const browser = apply.extensionBrowser();
    clipboard.writeText(extensionInstall.extensionsUrl(browser));
    return {opened: await extensionInstall.openExtensionsPage({browser})};
  });
  // Step 2's computer part: the folder in front of the user and its path on the clipboard, so Chrome's Load
  // unpacked dialog takes ⌘⇧G, ⌘V, Return. Chrome's own extensions page is the step-1 chip's job.
  ipcMain.handle('extensionShow', async () => {
    clipboard.writeText(extensionFolder());
    const opened = !(await shell.openPath(extensionFolder()));  // openPath resolves to an error string when it fails
    return {folder: extensionFolder(), opened};
  });
  // The extension's own options page: its "Connect to the Job Pilotto app" is what starts it reporting. The ID the
  // browser recorded is authoritative (a manifest "key" makes it differ from the folder path's hash).
  ipcMain.handle('extensionOptions', async () => {
    const found = extensionInstall.installed({folder: extensionFolder()});
    const copy = found.find(entry => entry.current) || found[0] || null;
    const opened = copy?.id ? await extensionInstall.openInChrome(`chrome-extension://${copy.id}/options.html`, {browser: copy.app})
      : await extensionInstall.openOptionsPage(copy?.folder || extensionFolder());
    return {opened};
  });
}

// Started from a terminal that's since closed, writing a log line fails (EIO/EPIPE); that must never crash the app.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => {});

// A separate data folder for tests and demos (JOB_PILOTTO_USER_DATA), so they never touch the real one.
if (DEMO_FOLDER) app.setPath('userData', DEMO_FOLDER);
else if (process.env.JOB_PILOTTO_USER_DATA) app.setPath('userData', process.env.JOB_PILOTTO_USER_DATA);

// A reset asked for in Settings → Danger zone: the data folder is moved aside (or deleted) now, before anything
// opens it; the app then starts like the first time (the setup wizard).
let resetDone = null;
let resetTold = false;
// What the form's panel shows about a job's CV: tailored already, or being tailored now (jobs whose Tailor CV was asked from the panel).
const tailoring = new Set();
const cvOf = url => ({tailored: !!cvlib.forUrl(storage, url), working: tailoring.has(server.pageKey(url))});
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
try { resetDone = reset.applyPending(app.getPath('userData')); } catch (error) { console.error('Reset failed:', error.message); resetDone = {failed: error.message}; }

// An IPC handler whose work quitting must not cut off half-way (lib/critical.js): the quit check names it and offers to wait.
function handleImportant(channel, label, handler) {
  ipcMain.handle(channel, (...args) => critical.during(label, () => handler(...args)));
}
// Every restart says why: app.exit skips 'will-quit', so without this line a restart looks like a silent exit (a Windows e2e relaunch, 6 Oct 2026).
function restartApp(reason, options) {
  appLog('window', `restart: ${reason}`);
  app.relaunch(options);
  app.exit(0);
}
// How the app ended, in logs/app.log: a Windows e2e relaunch closed with no line at all (6 Oct 2026). No line after "start" now means the
// process was killed from outside (nothing in the app can log that).
app.on('will-quit', () => appLog('window', 'quitting'));
process.on('exit', code => appLog('window', `process exit ${code}`));
// One copy per data folder: lifecycle callbacks are tested without launching Electron.
const firstCopy = claimInstance({app, getWindow: () => window, createWindow,
  showDuplicate: () => appLog('window', 'another copy holds this data folder: this one quits') || dialog.showMessageBoxSync({type: 'info', message: 'Job Pilotto is already running',
    detail: `Quit the other copy first (${process.platform === 'darwin' ? '⌘Q' : 'close its window'}), then open this one again.`}),
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
  telemetry?.record('crash', {where: 'main', type: reason?.name || 'Rejection', message: reason?.message || String(reason), stack: reason?.stack});
});
// A crash in the main process, reported without changing what Electron does with it (the monitor only watches).
process.on('uncaughtExceptionMonitor', error => {
  telemetry?.record('crash', {where: 'main', type: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack});
});

startWhenReady({app, firstCopy, getWindows: () => BrowserWindow.getAllWindows(), createWindow, start: () => {
  if (offerMove({app, dialog})) return false;  // moving to Applications: Electron quits and opens the moved copy
  buildMenu();
  app.setAboutPanelOptions({applicationName: 'Job Pilotto', applicationVersion: app.getVersion(),
    version: buildInfo ? `build ${buildInfo.build} · ${buildInfo.commit}` : 'development', copyright: '© 2026 Job Pilotto'});
  if (!app.isPackaged) { app.dock?.setIcon(path.join(here, 'assets', 'icon.png')); app.dock?.setBadge('DEV'); }  // from source: never mistaken for the installed app
  logTo(path.join(app.getPath('userData'), 'logs'));
  if (resetDone?.notionElsewhere) appLog('data', 'import: Profile and tracking are in the backup\'s Notion workspace, no key came with it', {decidedBy: 'reset.notionLeftBehind'});
  if (resetDone) appLog('data', resetDone.failed ? `reset or import not applied: ${resetDone.failed}` : `applied at start: ${resetDone.imported ? 'import' : resetDone.deleted ? 'reset (deleted)' : 'reset'}`, {backup: resetDone.backup || '', waitedMs: resetDone.waited || 0});   // waitedMs: Windows still held the folder after the old app quit
  requestLog.setFile(path.join(app.getPath('userData'), 'logs', 'notion-requests.log'));  // every Notion request, one line
  engineLog.setFile(path.join(app.getPath('userData'), 'logs', 'engine.log'));  // everything a run printed, in full
  // E2E on a Linux CI runner only (no keyring there): Electron's safeStorage refuses the basic store unless told to. A user's app never takes this path.
  if (process.platform === 'linux' && process.env.JOB_PILOTTO_E2E && process.env.CI) safeStorage.setUsePlainTextEncryption?.(true);
  storage = createStorage(app.getPath('userData'), DEMO ? {encrypt: value => value, decrypt: value => value} : safeStorageCrypto(safeStorage));
  // An import whose Profile is in a Notion workspace it brought no key for (lib/reset.js notionLeftBehind): the Notion dialog says to pick that one, until connected.
  if (resetDone?.notionElsewhere) storage.saveSettings({importedNotion: {page: storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID || '', at: new Date().toISOString()}});
  { const lost = (storage.secretsPresent(), storage.unreadableSecrets()); if (lost.length) appLog('secrets', 'unreadable on this computer: asked again', {names: lost}); }
  const firstStart = DEMO ? null : versionLine(storage, app.getVersion(), buildInfo ? `build ${buildInfo.build} · ${buildInfo.commit}` : '');
  if (firstStart) appLog('update', firstStart);
  aiTrial.apply(storage.settings());  // the free AI credit, if on: this process's Anthropic SDK goes to our website
  // Technical reports (lib/telemetry.js): on by default, off in Settings → Advanced; never in demo mode, and never
  // from a source checkout (npm start): its crashes are work in progress, not users' problems, and would open triage issues.
  license = licenseLib.create(storage, {appliedNow: () => viewCache.recall(storage, 'focus')?.result?.focus?.funnel?.steps
    ?.find(step => step.step.includes('Applied'))?.reached ?? 0});
  // A founder key left by the one-command install (lib/pending-license.js): unlock + free AI credit, before setup.
  if (!DEMO) {
    const taken = pendingLicense.consume(app.getPath('userData'), {license, storage, licenseState});
    if (taken) console.log(`Founder key from the installer: ${taken.ok ? `accepted${taken.trial ? ', free AI credit on' : ''}` : taken.error}`);
  }
  // The channel the install came from (the install link's ?src=): kept once, reported with the app's anonymous id.
  if (!DEMO) { const channel = installSource.consume(app.getPath('userData'), storage); if (channel) appLog('install', 'channel taken from the installer', {channel}); }
  // CI smoke runs (windows-smoke.mjs) launch the packaged app with a fresh profile each time: they (any launch with CI/GITHUB_ACTIONS set) must not count as installs.
  const quiet = DEMO ? 'demo mode' : telemetryLib.reportingOff(process.env, {packaged: app.isPackaged});
  const sentryOnly = telemetryLib.sentryOnly(process.env);   // the journey on CI: Sentry (environment e2e, id "e2e") yes; the store and PostHog never
  telemetry = quiet && !sentryOnly ? null : telemetryLib.create(storage, {version: app.getVersion(), silent: sentryOnly});
  // No channel from the installer (a Download button): ask the website once which click from this network it was (lib/install-source.js).
  if (!quiet) installSource.attribute(storage).then(channel => appLog('install', channel ? 'channel matched to a download click' : 'no channel for this install', {channel}))
    .catch(error => appLog('install', 'channel lookup failed', {error: error.message}));
  appLog('telemetry', quiet ? `reporting is off: ${quiet}${sentryOnly ? ' (Sentry only, environment e2e)' : ''}` : 'reporting follows the Technical reports switch');   // the end-to-end harness reads this line
  if (!storage.settings().setupDone) trackSetup({wizardStep: 'welcome'}, storage.settings());  // the funnel's first step: the app opened
  if (telemetry) {
    // Crash reports (Sentry) and usage events (PostHog): only an installed build, only with Technical reports on, only when
    // config/analytics.json (or env) names where. Every problem the app records for itself goes to Sentry too; native crashes go through
    // Electron's own reporter. Nothing a person wrote or read is part of any of it (lib/sentry.js, lib/analytics.js).
    const keys = analyticsConfig.load(pipeline.REPO);
    const identity = {installId: sentryOnly ? 'e2e' : telemetryInstallId(storage), version: app.getVersion(), os: os.release()};
    const sentryClient = sentryLib.create({dsn: keys.sentryDsn, release: `job-pilotto@${identity.version}`, installId: identity.installId, os: identity.os,
      ...(sentryOnly ? {environment: 'e2e', tags: sentryLib.e2eTags(), enabled: () => true} : {enabled: telemetry.enabled})});
    if (sentryClient.active) {
      const record = telemetry.record.bind(telemetry);
      trail = sentryClient.note;
      // Testers only (beta on), and only for one who switched it on (Settings → Technical reports): the scrubbed tail of the run log
      // rides along with a failed or hung run's report to Sentry (never to our own telemetry store).
      const logLines = kind => (['run_failed', 'stuck'].includes(kind) && testerOn() && testerLogsOn()) ? engineLog.tailLines(200) : undefined;
      telemetry.record = (kind, fields) => { record(kind, fields); sentryClient.capture(kind, {...fields, logLines: logLines(kind)}); };
      if (sentryOnly || telemetry.enabled()) sentryLib.startNativeCrashes(crashReporter, {dsn: keys.sentryDsn, release: `job-pilotto@${identity.version}`, installId: identity.installId});
      pipeline.setCrashReports({dsn: keys.sentryDsn, version: identity.version, installId: identity.installId, enabled: sentryOnly ? () => false : telemetry.enabled});   // the engine's own reports carry no environment tag: off in the journey
    }
    analytics = sentryOnly ? null : analyticsLib.create({key: keys.posthogKey, host: keys.posthogHost, installId: identity.installId, version: identity.version, os: identity.os, enabled: telemetry.enabled});
    track('app_start', {});
    server.setAppliedHook(info => track('applied', info));
    app.on('before-quit', () => { void analytics?.flush(); });
    pipeline.onRunEnd(({args, code, seconds, tail, timedOut, result}) => {
      telemetry.countRun(code === 0);  // the health line's runsOk / runsFailed (release check evidence)
      if (args[0] === 'src' && ['daily', 'check'].includes(args[1])) {
        const searched = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : '';
        if (['run', 'scheduled'].includes(searched)) {
          track('search_done', {ok: code === 0, seconds: Math.round(seconds / 10) * 10, mode: searched, timed_out: !!timedOut});
          if (code === 0 && !storage.settings().firstSearchTracked) { storage.saveSettings({firstSearchTracked: true}); track('first_search_done', {seconds: Math.round(seconds / 10) * 10}); }
        }
      }
      const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : /^[a-z_]+$/.test(args[1] || '') ? args[1] : '';
      const job = `${args[0]}${mode ? ` ${mode}` : ''}`;
      if (code === 0) {
        // A run that finished but said something went wrong (the AI not answering, Notion refusing a write, feeds failing) is
        // not a crash and used to be invisible: one event with its first warning, so a user who "got nothing" is not silent.
        const warning = result?.warnings?.[0]?.message;
        if (warning) telemetry.record('run_warning', {job, seconds, warning, count: result.warnings.length});
        return;
      }
      const error = timedOut ? `stopped by the app: ${timedOut}` : [...tail].reverse().find(line => /error|exception|traceback|failed|refused/i.test(line)) || tail.at(-1) || '';
      telemetry.record('run_failed', {job, code, seconds, error, ...(timedOut ? {timedOut} : {}),
        cutOff: /cut off|max_tokens|Unterminated string/i.test(tail.join(' ')), tail: tail.slice(-5)});
    });
    server.setFormIssueHandler(fields => {
      // Claude not answering a form's questions is the AI step failing, not one unfilled field: a warning with its reason.
      if (fields.type === 'ai') { telemetry.record('run_warning', {job: 'extension fill', warning: `Claude did not answer: ${fields.reason}`, site: fields.site}); return; }
      telemetry.record('form_issue', fields);
      // A stale extension is not a filled field: it is the cause of the fields that failed, so the app's own log
      // says it too (once per version pair — the extension reports every field of every form).
      if (fields.type === 'version' && staleWarned !== fields.version) {
        staleWarned = fields.version;
        appLog('extension', fields.reason, {reportedBy: fields.site});
      }
    });
    setTimeout(() => { healthOnce(); telemetry.flush(); }, 60 * 1000);
    setInterval(() => { healthOnce(); telemetry.flush(); }, 10 * 60 * 1000);
  }
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
    server.setWindowSignal(toWindow);
  // The engine's pages that need their scripts run, in this app's own Chromium (lib/page-render.js): the address reaches engine runs (lib/pipeline.js).
  server.setRenderer((url, userAgent) => pageRender.renderPage(url, {BrowserWindow, userAgent}));
  pageRender.setAddress(`http://127.0.0.1:${server.PORT}/engine/render`);
  server.start(storage, error => log(error.code === 'EADDRINUSE'
      ? `Chrome extension connection is off: port ${server.PORT} is used by another program.`
      : `Chrome extension connection failed: ${error.message}`));
  }
  if (!DEMO) { terminals.persist(path.join(storage.dir, 'sessions.json')); terminals.restore(); }  // sessions of the last run
  // Each form's last state (ready to submit?), so a restart shows it before Chrome's tabs report again.
  if (!DEMO) review.persist(path.join(storage.dir, 'review-states.json'), terminals.list().map(session => session.id));
  // A session's conversation (its Claude Code transcript) on its Agent Runs row, folded: the Mac's file doesn't last.
  const saveConversation = session => {
    if (!session.runPage || !session.transcript) return;
    const talk = transcript.conversation(session.transcript);
    if (!talk?.length || talk.length === session.conversationSaved) return;
    transcript.save((method, route, body) => notion.call(storage.secret('NOTION_TOKEN'), method, route, body), session.runPage, talk)
      .then(count => { session.conversationSaved = count; terminals.saveNow(); }).catch(error => log(`conversation not saved to Notion: ${error.message}`));
  };
  // Each session's statistics on its Agent Runs row in Notion, a few seconds after each change (lib/session-runs.js).
  if (!DEMO) terminals.onStatus((view, session) => sessionRuns.schedule(session, () => ({
    call: (method, route, body) => notion.call(storage.secret('NOTION_TOKEN'), method, route, body),
    db: storage.settings().notionIds?.NOTION_AGENT_RUNS_DB,
    create: /^decided|^ended|^failed/.test(session.events?.at(-1)?.status || ''),
  }), page => {
    session.runPage = page;
    terminals.saveNow();
    // Once it ended, its conversation goes on the row too (again if it was resumed and said more since).
    if (/^decided|^ended|^failed/.test(session.events?.at(-1)?.status || '')) saveConversation(session);
  }));
  // Sessions that ended before this was saved (or while Notion was busy): at start-up, none of them is running.
  if (!DEMO) for (const session of terminals.list()) { const record = terminals.record(session.id); if (record) saveConversation(record); }
  createWindow();
  terminals.onChange((event, payload) => toWindow('session', event, payload));
  server.setReviewHandler(payload => { const report = review.report(terminals.list(), payload); return report.session ? {...report, cv: cvOf(report.session.url)} : report; });
  const recipeReporter = recipeLibrary.createReporter(storage, {onSent: (what, sent) => sharedLog.add(storage, what, sent)});
  recipeReporterRef = recipeReporter;
  server.setProposalReporter(items => recipeReporter.proposal(items));
  // After a search: how much of the market the role keywords caught (data/coverage.json, src/coverage.py), as anonymous counts, once per crawl.
  pipeline.onRunEnd(({args, code}) => {
    if (code !== 0 || args[1] !== 'daily') return;
    try {
      const summary = JSON.parse(storage.readText('data/coverage.json') || 'null');
      if (!summary?.at || storage.settings().intelCoverageAt === summary.at) return;
      storage.saveSettings({intelCoverageAt: summary.at});
      recipeReporter.coverage(summary);
    } catch { /* a number for the product is never worth a failed run */ }
  });
  const shared = (what, sent) => sharedLog.add(storage, what, sent);
  server.setSharedLogger(shared);
  server.setRecipesHandler(payload => recipeLibrary.lookup(storage, payload.fingerprints, {onSent: shared}));
  server.setAliasesHandler(() => aliasLibrary.lookup(storage, {onSent: shared}));
  const owner = () => !!process.env.JOB_PILOTTO_OWNER;   // the owner's own installs name sites in plain, to debug with
  // Sites only you can open (lib/visits.js): the extension sends each page the person asked it to read; the hosts light its icon.
  let visitHosts = ['linkedin.com', 'indeed.', 'glassdoor.', 'levels.fyi'];
  const refreshVisitHosts = () => pipeline.run(storage, ['src.desktop', 'visit-list']).then(({stdout}) => {
    const listed = JSON.parse(String(stdout).trim().split('\n').pop() || '{}').visits || [];
    visitHosts = [...new Set([...visitHosts, ...listed.map(item => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean)])];
  }).catch(error => appLog('visit', 'visit list not read', {error: error.message}));
  if (!DEMO) setTimeout(refreshVisitHosts, 20000);
  server.setVisitHosts(() => visitHosts);
  server.setVisitFilters(page => visits.filters(storage, page));
  server.setVisitRoute('/extension/visit-understand', outline => visits.understand(storage, outline));
  server.setVisitRoute('/extension/visit-unblock', page => visits.unblock(storage, page));
  server.setVisitRoute('/extension/visit-recipe', page => visits.recipe(storage, page));
  server.setVisitRoute('/extension/visit-jobpage', page => visits.jobPage(storage, page));   // a home page: where its job list is
  server.setVisitRoute('/extension/visit-done', payload => visits.done(payload));
  server.setVisitRoute('/extension/visit-waiting', payload => visits.waitingFor(payload));
  server.setVisitRoute('/extension/visit-state', payload => visits.stepOf(payload));   // what each read tab is doing, live in its row
  let waitingSaid = 0;
  visits.onWaiting(() => {   // once a run: a notification that brings Chrome forward on click
    if (Date.now() - waitingSaid < 10 * 60000) return;
    waitingSaid = Date.now();
    notify('Job Pilotto is waiting for you in Chrome', 'Press "Allow on the sites the app opens" once: then it reads the sites by itself.', () => visits.focusBrowser());
  });   // the extension waits on the person: said, not "reading"   // a tab the Actions task opened has been read
  server.setVisitHandler(async page => {
    const answer = await visits.read(storage, page);
    // A page you read by your own click is said at once; one read for a Find jobs using your browser run (it has a ticket) is said by that run's card, which also
    // starts the search (7 Oct 2026: a toast per page said "your next jobs check scores them" while the card said a search had started).
    if (answer.ok && !page?.ticket) toWindow('visit-read', answer);
    return answer;
  });
  server.setMissesHandler(payload => misses.record(storage, payload, Date.now(), prints => {
    for (const item of controlEvents.fromMisses(payload, prints, {owner: owner()})) telemetry?.record('control', item);
    recipeReporter.sample((payload.items || []).filter(item => prints.has(item.fingerprint)));   // the structure of a new kind of control, no text
  }));
  server.setControlsHandler(payload => {
    for (const item of controlEvents.fromOperators(payload, {owner: owner()})) telemetry?.record('control', item);
    recipeReporter.outcome(payload.items);   // counts per fingerprint and recipe: the canary's evidence
    const board = controlEvents.boardName(payload.host);
    if (Array.isArray(payload.trace)) recipeReporter.fill(board, payload.required);   // one more form on this board (only a fill report carries the trace; a flow or alias event is not a fill)
    recipeReporter.question((Array.isArray(payload.buttons) ? payload.buttons : []).map(label => ({label, kind: 'button'})), board);   // button texts of a page with no Apply button we knew
    recipeReporter.alias(payload.aliasUse);   // which label meanings from the service placed a question, and whether the field took it
    recipeReporter.fillQuality(payload.filled, payload.corrections);   // which answers were filled, and which the person changed by hand (labels only)
    recipeReporter.question(unplaced(payload.trace), board);   // the form's own wording for questions no answer matched
    const left = leftCounts(payload.trace);
    recipeReporter.unfilled(board, left);   // why fields stayed empty: counts per fixed reason word
    const unreadCount = left.find(c => c.reason === 'unread')?.n || 0;
    if (unreadCount) appLog('review', `fill: ${unreadCount} required question(s) on the page not read`, {board});
    if (payload.flow) recipeReporter.flow(board, flowState(payload.flow));   // where an application got to on this board
    if (payload.card) recipeReporter.card(board, payload.card);   // this fill's anonymous record (extension/fill-card.js)
    if (payload.byYou || payload.invalid || payload.fillId) {   // at Submit: what the fill missed (the person answered it, or the page flagged it)
      const counts = submitCounts(payload);
      if (payload.fillId) recipeReporter.submit(payload.fillId, {submitted: payload.submitted, ...Object.fromEntries(counts.map(c => [c.reason, c.n]))});
      recipeReporter.unfilled(board, counts);
      recipeReporter.question(missedQuestions(payload), board);
      appLog('review', `at submit: ${counts.map(c => `${c.n} ${c.reason}`).join(', ') || 'nothing missed'}`, {board});
    }
  });
  server.setLearnedHandler(payload => learnedAnswers.save(storage, payload, {notify: (title, body) => toWindow('toast', {title, body}), contactSaved: contact => server.contactSaved(storage, contact)}));
  server.setTabsHandler(report => { review.noteTabs(report); visits.noteTabs(report); });   // one tab report: form tabs (Applying) and read tabs (Find jobs using your browser)
  server.setJoinHandler(tabs => review.tabsToArm(terminals.list(), tabs));
  server.setFocusHandler(payload => review.noteFocus(terminals.list(), payload));
  server.setOpenHandler(id => {
    if (!terminals.get(id)) return false;
    if (!window || window.isDestroyed()) createWindow();
    window.show();
    window.focus();
    app.focus({steal: true});
    toWindow('session', 'open', {id});
    return true;
  });
  server.setStuckHandler(event => {   // tier 3: the extension can't reach a form: that job's form session offers Apply with Claude
    const forms = terminals.list().filter(session => session.kind === 'form' && !session.outcome);
    const match = forms.find(session => apply.isFormOf(event.url, session.url));
    appLog('extension', `can't reach the form: ${event.why}`, {host: event.host, matched: !!match});
    if (match) terminals.noteStuck(match.id, event.why === 'account' ? 'account' : 'no-form');
  });
  review.setReporter(state => {
    if (state.total > 0) terminals.clearStuck(state.id);
    appLog('review', `form ${state.id}: ${state.left}/${state.total} left, ${Object.keys(state.states || {}).length} watched field(s) seen`, {states: state.states});
    toWindow('review', state);
  });
  const readReported = new Set();
  // (readSites, set when a Read with Claude session starts: its sites' addresses, so each site's button is told when it ends)   // Read with Claude sessions already reported (a session's Stop can arrive more than once)
  server.setSessionReporter((id, info) => {
    const {session, needsYou} = terminals.report(id, info);
    if (session && needsYou) sessionNeedsYou(session);
    // A Read with Claude session that finished: what it saved, said like the extension's reads (log, toast, the site's button) and scored
    // (owner, 7 Oct 2026: "Read with Claude never reports back"). Its pages were saved under its session name (claude-session.js readPrompt).
    if (session?.kind === 'read' && session.status === 'done' && !readReported.has(id)) {
      readReported.add(id);
      visits.claudeResult(storage, id).then(result => {
        appLog('visit', 'read with Claude finished', {host: (() => { try { return new URL(session.url).hostname; } catch { return ''; } })(), jobs: result?.jobs ?? 0, fits: result?.fits ?? 0});
        toWindow('visit-claude-done', {url: session.url, urls: readSites.get(id) || [session.url], name: result?.name || session.company || '', jobs: result?.jobs || 0, fits: result?.fits || 0});
        scoreVisitJobs(result?.fits || 0, 'read with Claude');
      }).catch(error => appLog('visit', 'read with Claude result not read', {error: error.message}));
    }
  });
  if (!DEMO) {
    // User data left on this Mac -> Notion (source of truth), once. It runs while the window loads, so the
    // window reads again what moved (e.g. open questions read before they reached Notion looked like none).
    critical.during('Moving your data to Notion', () => migrate.run(storage, log)).then(moved => { if (moved.length) toWindow('moved', moved); });
    syncCv();
    // Recent activity from Notion ⏱️ Search runs (every run's row, wherever it ran), every 15 s.
    let notionTimer;
    const readRuns = async () => {
      clearTimeout(notionTimer);
      let busy = false;
      try { notionRuns = await runHistory.list(storage); } catch (error) { busy = error.status === 429; appLog('run', `history not read: ${error.message}`, {status: error.status || 0}); log(`Run history not read from Notion: ${error.message}`); }
      // While a GitHub run is only a placeholder, read Notion again in 5 s so its row replaces "Running"
      // as soon as it exists. Otherwise every 15 s. Notion busy: step back for a minute.
      notionTimer = setTimeout(readRuns, busy ? 60000 : pendingCloud.length ? 5000 : e2eMs('HISTORY_MS', 15000));
    };
    readRuns();
    // A job sent to GitHub: "Starting on GitHub…" until its row appears (it's read again sooner than usual).
    // The dispatch itself returns no run id, so the link is filled in once Actions lists the run, and the
    // placeholder is dropped when that run finishes — a finished check must not stay "Running".
    const claimedGithubRuns = new Set();
    const watchGithubRun = (job, workflow) => {
      const since = job.id - 15000;
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      (async () => {
        let run = null;
        for (let attempt = 0; attempt < 24 && pendingCloud.includes(job) && !run; attempt++) {
          await pause(attempt ? 5000 : 2000);
          if (!pendingCloud.includes(job)) return;
          let runs = [];
          try { runs = await github.dispatchedRuns(storage, {workflow, since}); }
          catch (error) { appLog('dispatch', `github run not listed: ${error.message}`, {workflow}); continue; }
          run = runs.find(item => !claimedGithubRuns.has(item.id)) || null;
        }
        if (!run || !pendingCloud.includes(job)) return;
        claimedGithubRuns.add(run.id);
        const describe = async current => {
          let jobs = [];
          try { jobs = await github.runJobs(storage, current.id); } catch (error) { appLog('dispatch', `github jobs not listed: ${error.message}`, {run: current.id}); }
          const link = github.runLink(current, jobs);
          if (link.url) job.url = link.url;
          if (link.runUrl) job.runUrl = link.runUrl;
          return link;
        };
        const link = await describe(run);
        appLog('dispatch', `github run ${run.id} for ${workflow}`, {status: link.status, job: link.jobId});
        setTimeout(readRuns, 1000);  // the row may already be there: drop "Starting on GitHub…" without a reload
        if (run.status === 'completed') {
          appLog('dispatch', `github run ${run.id} finished`, {conclusion: run.conclusion || ''});
          pendingCloud = pendingCloud.filter(item => item !== job);
          return;
        }
        while (pendingCloud.includes(job)) {
          await pause(5000);
          if (!pendingCloud.includes(job)) return;
          let again;
          try { again = await github.workflowRun(storage, run.id); }
          catch (error) { appLog('dispatch', `github run ${run.id} not read: ${error.message}`); continue; }
          if (!again || again.status !== 'completed') { await describe(again || run); continue; }
          appLog('dispatch', `github run ${run.id} finished`, {conclusion: again.conclusion || ''});
          pendingCloud = pendingCloud.filter(item => item !== job);
          setTimeout(readRuns, 1000);
          return;
        }
      })();
    };
    github.onDispatch(({workflow, inputs}) => {
      const mode = workflow === 'mail.yml' ? 'mail' : workflow === 'scout.yml' ? 'scout' : inputs.mode || 'scheduled';
      const kind = {scheduled: 'search', run: 'search'}[mode] || mode;
      const job = {id: Date.now(), mode, kind, live: true, where: 'github', trigger: 'you', startedAt: new Date().toISOString(), step: 'Starting on GitHub…'};
      pendingCloud.push(job);
      watchGithubRun(job, workflow);
      setTimeout(readRuns, 20000);
    });
    // The repo's workflow files follow this version of the app (e.g. a new input), unchanged files untouched;
    // keys kept outside the app's store (the Google sign-in) go along.
    // Updates: shortly after start, then every 10 minutes while installs are few (back to 6 hours for a mass rollout: GitHub allows 60 anonymous checks an hour per IP; an installed app only; a source checkout updates with git).
    if (app.isPackaged && !DEMO) { setTimeout(() => checkForUpdate(), 20000); setInterval(() => checkForUpdate(), 10 * 60 * 1000); }
    // Interview reminders: a Mac notification 10 and 1 minute before each Next interview (from the last read of the Jobs list).
    const remind = () => {
      if (DEMO || !storage.settings().setupDone || !reminders.on(storage) || !notionGate.connected(storage)) return;
      const jobs = viewCache.recall(storage, 'jobs')?.result?.jobs || [];
      const sent = storage.settings().reminded || {};
      const items = reminders.due(jobs, sent);
      if (!items.length) return;
      const next = {...sent};
      for (const item of items) {
        const words = reminders.text(item);
        notify(words.title, words.body, () => toWindow('openInterviews'));
        for (const key of item.keys) next[key] = true;
      }
      storage.saveSettings({reminded: Object.fromEntries(Object.entries(next).slice(-200))});
    };
    setInterval(remind, 30000);
    if (!DEMO) watchOrphans(appLog, {onStopped: async run => {
      const closed = await runHistory.closeLost(storage, Date.now() - run.elapsed * 1000, `Stopped: the app had lost this run (${run.why}).`);
      for (const row of closed) appLog('run', 'closed the row of a run the app stopped', {kind: row.kind, started: row.startedAt, decidedBy: 'orphan watchdog'});
    }});   // an engine run left behind by a restart, stuck: stop it (lib/orphans.js)
    setTimeout(remind, 15000);
    if (cloud()) github.updateRepo(storage).then(changed => changed.length && log(`Updated in your GitHub repo: ${changed.join(', ')}`),
      error => log(`GitHub repo not updated: ${error.message}`));
    const backupIfDue = () => { if (storage.settings().setupDone && backup.due(storage.settings())) backupNow(); };
    backupIfDue();
    setInterval(backupIfDue, 6 * 3600 * 1000);
    // Catch-up share to the central pool: what a cut-short or offline run could not send (finds go out one by one as they happen).
    if (!DEMO && storage.settings().setupDone && poolShare.on(storage)) setTimeout(() => pipeline.run(storage, ['src.contribute', '--send'])
      .then(({code}) => appLog('pool', 'catch-up share at start', {code}), error => appLog('pool', 'catch-up share failed', {error: error.message})), 60000);
    restartTelegram();
    watchSleep(powerMonitor, appLog);   // the run watchdogs leave out the time this Mac sleeps (lib/awake.js)
    // On the chosen schedule while the app is open (the digest goes to Telegram when there's something new).
    // Searches: a notification a minute before one starts; every finished run: announceRuns (every 5 s).
    startSchedule(storage, {
      // Their notifications come from announceRuns, like every run's (wherever it ran).
      search: () => pipeline.refresh(storage, log, 'scheduled', 'schedule'),
      mail: () => (notionGate.connected(storage) ? pipeline.checkMail(storage, log, 'schedule') : skipUntilNotion('mail')),
      scout: () => pipeline.scout(storage, log, 'schedule'),
    }, powerMonitor, {soon: () => notify('Searching for new jobs in 1 minute', 'Your scheduled search for new jobs is about to run.', {activity: true})});
    setInterval(announceRuns, 5000);
    scheduleResume(pipeline, storage, {cloud: !!storage.settings().cloud?.repo, begin: resumeQueue, delayMs: resumeDelay()});  // after the schedule's own catch-up check has queued what's due; the queue is read now, not then
  }
  if (!DEMO) setInterval(() => focusReminder().catch(() => {}), 5 * 60 * 1000);
}});

// Focus reminders at 11:00, 15:00 and 19:00 (this Mac's time), once per slot: a notification and a Telegram
// message when someone waits for an answer, an interview is close, or today's applications are behind the target.
const FOCUS_HOURS = [11, 15, 19];
// Notion later: loops that read Notion do nothing until it is connected, and say so once per start (they pick up by themselves after a connect).
const skippedLoops = new Set();
function skipUntilNotion(loop) {
  if (!skippedLoops.has(loop)) { skippedLoops.add(loop); appLog('notion', 'loop skipped: not connected', {loop}); }
  return Promise.resolve();
}
async function focusReminder(now = new Date()) {
  const settings = storage.settings();
  if (!settings.setupDone || settings.focusReminders === false) return;
  if (!notionGate.connected(storage)) return skipUntilNotion('focus reminder');
  const slot = FOCUS_HOURS.filter(hour => now.getHours() >= hour).pop();
  if (slot == null) return;
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${slot}`;  // local day
  if (settings.lastFocusReminder === key) return;
  storage.saveSettings({lastFocusReminder: key});
  const text = await pipeline.focusReminder(storage, true);
  appLog('focus', `reminder ${key}: ${text ? 'sent' : 'nothing worth saying'}`, {chars: text.length});
  if (text) notify('Focus: what to do next', text, {view: 'focus'});
}


// Jobs you started that were running or waiting when the app quit (pipeline queue.json): the app asks whether to start them again (owner,
// 7 Oct 2026). The schedule's own (searches, Gmail checks) aren't asked about: its catch-up runs whatever is due anyway.
async function resumeQueue(jobs) {
  if (!jobs.length) return;
  const names = [...new Set(jobs.map(job => pipeline.taskName(job.kind)))];
  const parent = window && !window.isDestroyed() ? window : null;
  const {start, decidedBy} = await askResume(names, {ask: options => (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))})
    .catch(error => { appLog('run', 'resume question failed', {error: error.message}); return {start: false, decidedBy: 'question failed'}; });
  appLog('run', start ? 'started again after a quit' : 'left stopped after a quit', {kinds: jobs.map(job => job.kind).join(','), decidedBy});
  // The Notion row of a run the quit killed: the engine closes it itself now (src/notion/cron_runs.py); this is for one that could not (Windows ends the whole tree).
  try {
    const closed = await runHistory.closeInterrupted(storage, jobs, {reason: start ? 'Interrupted: the app was closed before this run finished; it was started again.'
      : 'Interrupted: the app was closed before this run finished; left stopped.'});
    for (const row of closed) appLog('run', 'closed the row of a run the quit interrupted', {kind: row.kind, started: row.startedAt, decidedBy});
  } catch (error) { appLog('run', 'interrupted rows not closed', {error: error.message}); }
  if (!start) return;
  for (const job of jobs) {
    const failed = error => log(`${pipeline.taskName(job.kind)} failed: ${error.message}`);
    if (job.kind === 'search') pipeline.refresh(storage, log, job.resume.mode || 'run', 'you').catch(failed);
    else if (job.kind === 'mail') pipeline.checkMail(storage, log, 'you').catch(failed);
    else if (pipeline.TASKS[job.kind] && Array.isArray(job.resume.args)) pipeline.task(storage, job.kind, job.resume.args, log, 'you').catch(failed);
  }
}

// A Claude session waits for you: a notification (a click opens that session in the app) and a toast in the window.
const needsYouSeen = new Map();  // session id -> the last question announced (lib/needs-you.js)
function sessionNeedsYou(session) {
  const what = terminals.label(session);
  const text = session.brief || 'Claude needs your input';  // one plain sentence; the whole message is on the session page
  if (!shouldNotify(needsYouSeen, session.id, text)) return;  // the card says it; no new ping for the same question
  if (!process.env.JOB_PILOTTO_SMOKE && Notification.isSupported()) {
    const note = new Notification({title: `Needs your input · ${what}`, body: text});
    note.on('click', () => { window?.show(); window?.focus(); toWindow('session', 'open', {id: session.id}); });
    note.show();
  }
  toWindow('toast', {title: `Needs your input · ${what}`, body: text});
  // Not on Telegram: a session waiting for you is answered in the app, and the pings added noise (1 Oct 2026).
}
// Quitting decisions read current services, so they remain testable without global mocks.
installQuitHandling({app, platform: process.platform,
  state: () => ({storage, window, telemetry, demo: DEMO, smoke: !!process.env.JOB_PILOTTO_SMOKE}),
  pipeline, terminals, critical, shouldAskOnQuit: setupFunnel.shouldAskOnQuit,
  askWhyLeaving: () => toWindow('askWhyLeaving'),
  showDialog: (parent, options) => dialog.showMessageBoxSync(parent, options),
  icon: () => nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')),
  getWindows: () => BrowserWindow.getAllWindows(), toWindow, notify, log: appLog,
});
