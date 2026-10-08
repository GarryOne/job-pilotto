// Job Pilotto desktop app: a local-first cockpit for the job search. Data and keys stay on this Mac.
import {app, BrowserWindow, clipboard, crashReporter, Menu, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, Notification, powerMonitor, safeStorage, session, shell, systemPreferences} from 'electron';
import {recordIpc} from './lib/e2e-ipc.js';
import {hideWindows} from './lib/e2e-hidden.js';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import * as apply from './lib/apply.js';
import * as credentials from './lib/credentials.js';
import {claimInstance, startWhenReady, installQuitHandling} from './lib/lifecycle.js';
import * as critical from './lib/critical.js';
import * as pageRender from './lib/page-render.js';
import {closeSessionTab, registerSessionHandlers} from './lib/session-handlers.js';
import {registerAppMetaHandlers} from './lib/app-meta-handlers.js';
import {registerInterviewHandlers} from './lib/interview-handlers.js';
import {registerCvAndLettersHandlers} from './lib/cv-handlers.js';
import {registerContactHandlers} from './lib/contact-handlers.js';
import {registerSearchTuningHandlers} from './lib/search-tuning-handlers.js';
import {settingsDepsFor} from './lib/settings-deps.js';
import {createSessionFlow} from './lib/session-flow.js';
import * as cvlib from './lib/cv.js';
import * as cvLook from './lib/cv-look.js';
import * as github from './lib/github.js';
import * as updater from './lib/updater.js';
import * as telemetryLib from './lib/telemetry.js';
import * as poolShare from './lib/pool-share.js';
import {shouldNotify} from './lib/needs-you.js';
import * as reminders from './lib/interview-reminders.js';
import * as engineLog from './lib/engine-log.js';
import * as requestLog from './lib/request-log.js';
import * as notifyWatch from './lib/notify-watch.js';
import {googleSecrets} from './lib/google-keys.js';
import * as runHistory from './lib/run-history.js';
import * as targets from './renderer/targets.js';
import {clearlyTechnical} from './renderer/audience.js';   // pure (no DOM), the same rule as src/coverage.py   // pure (no DOM), shared with the window
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
import * as terminals from './lib/terminals.js';
import * as transcript from './lib/transcript.js';
import {offerMove} from './lib/applications.js';
import * as appMenu from './lib/app-menu.js';
import * as aiTrial from './lib/ai-trial.js';
import * as claudeCode from './lib/claude-code.js';
import * as setupFunnel from './lib/setup-funnel.js';
import * as devMarker from './lib/dev-marker.js';
import {sharedRead} from './lib/shared-read.js';
import * as pendingLicense from './lib/pending-license.js';
import * as installSource from './lib/install-source.js';
import * as review from './lib/review.js';
import * as sessionRuns from './lib/session-runs.js';
import {closeFormTab} from './lib/form-tab.js';
import {log as appLog, logFile, logTo} from './lib/log.js';
import electronLog from 'electron-log/main.js';
import {watchSleep} from './lib/awake.js';
import {versionLine, watchWindow} from './lib/window-log.js';
import * as viewCache from './lib/view-cache.js';
import * as migrate from './lib/migrate.js';
import * as reset from './lib/reset.js';
import * as files from './lib/files.js';
import * as backup from './lib/backup.js';
import * as notionGate from './lib/notion-gate.js';
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
import * as aliasLibrary from './lib/aliases.js';
import {flowState, leftCounts, missedQuestions, submitCounts, unplaced} from './lib/question-labels.js';
import {createStorage, safeStorageCrypto} from './lib/storage.js';
import {fileURLToPath} from 'node:url';
import * as telegramCloud from './lib/telegram-cloud.js';
import * as licenseLib from './lib/license.js';
import * as demo from './lib/demo.js';
import * as intelLib from './renderer/intel.js';
import * as sharedLog from './lib/shared-log.js';
import {registerBrowserHandlers} from './lib/browser-handlers.js';
import {registerVisitsHandlers} from './lib/visits-handlers.js';
import {registerKitHandlers} from './lib/kit-handlers.js';
import {registerApplyHandlers} from './lib/apply-handlers.js';
import {registerFocusHandlers} from './lib/focus-handlers.js';
import {registerSystemHandlers} from './lib/system-handlers.js';
import {registerLeadsHandlers} from './lib/leads-handlers.js';
import * as calltap from './lib/calltap.js';
import * as interviews from './lib/interviews.js';
import {registerJobActionsHandlers} from './lib/job-actions-handlers.js';
import {registerCloudHandlers} from './lib/cloud-handlers.js';
import {registerJobsHandlers} from './lib/jobs-handlers.js';
import {registerStrategyDraftHandlers} from './lib/strategy-draft-handlers.js';
import {registerSetupHandlers} from './lib/setup-handlers.js';

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
// A run going on in GitHub can be stopped too, once Actions has listed it (its address carries the run id): Stop cancels it there.
function cloudStop(run) {
  const githubRun = github.runIdOf(run?.runUrl || run?.url);
  return githubRun && storage.settings().cloud?.repo ? {...run, stoppable: true, githubRun} : run;
}
function activity() {
  pendingCloud = pendingCloud.filter(job => Date.now() - job.id < 10 * 60000);
  const local = pipeline.runs(storage);
  const {runs, live, waiting} = notionRuns ? runHistory.merge(notionRuns, local, pendingCloud) : {runs: local, live: pendingCloud[0] || null, waiting: pendingCloud};
  pendingCloud = waiting;
  const settings = storage.settings();
  const cloud = cloudNextAt(settings);  // Always on: GitHub's schedule (the Mac's own is off then)
  return {runs, running: pipeline.running() || cloudStop(live), queued: pipeline.queued(), lastSearchAt: settings.lastSearchAt || null,
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
  registerContactHandlers({ipcMain, storage, DEMO, connected: () => notionGate.connected(storage), needsNotion, log: appLog,   // lib/contact-handlers.js
    contactSaved: saved => server.contactSaved(storage, saved)});
  registerSetupHandlers({Anthropic, DEMO, connectNotion, dialog, handleImportant, ipcMain, licenseState, needsNotion, shell, storage, syncCv, getTelemetry: () => telemetry, track, trackSetup, getWindow: () => window,
    setNotionFrom: value => { notionFrom = value; }});   // lib/setup-handlers.js
  registerStrategyDraftHandlers({DEMO, here, ipcMain, storage, syncCv, toWindow, trackSetup});   // lib/strategy-draft-handlers.js
  registerJobsHandlers({DEMO, JOBS_PAGE, activity, allowanceBlock, app, cloud, dispatchCloud, here, ipcMain, log, needsNotion, shell, storage, toWindow, track});   // lib/jobs-handlers.js
  registerCloudHandlers({DEMO, cloud, dialog, handleImportant, needsNotion, restartTelegram, shell, storage, toWindow, getWindow: () => window});   // lib/cloud-handlers.js
  registerJobActionsHandlers({DEMO, allowanceBlock, cloud, dispatchCloud, dispatchNote, intelLib, ipcMain, log, needsNotion, getRecipeReporter: () => recipeReporterRef, storage});   // lib/job-actions-handlers.js
  const settingsDeps = settingsDepsFor(toWindow);   // lib/settings-deps.js
  registerSearchTuningHandlers({DEMO, activity, here, ipcMain, needsNotion, getRecipeReporter: () => recipeReporterRef, storage, toWindow});   // lib/search-tuning-handlers.js
  registerInterviewHandlers({appLog, calltap, cloud, DEMO, dialog, dispatchCloud, handleImportant, here, interviews, ipcMain, needsNotion, notify, reminders,
    sharedRead, shell, storage, toWindow, viewCache, getWindow: () => window});   // the Interviews page (lib/interview-handlers.js)
  registerLeadsHandlers({DEMO, aiReady, app, clipboard, ipcMain, log, nativeImage, needsNotion, storage, toWindow});   // lib/leads-handlers.js
  registerSystemHandlers({DEMO, about, app, backupNow, dialog, handleImportant, ipcMain, mediaAccess, getResetDone: () => resetDone, restartApp, shell, storage, systemPreferences, getWindow: () => window});   // lib/system-handlers.js
  registerFocusHandlers({DEMO, aiReady, app, applyTheme, clearlyTechnical, here, ipcMain, log, needsNotion, settingsDeps, storage, toWindow, track});   // lib/focus-handlers.js
  const {prepareKitFor, tailorCv} = registerKitHandlers({allowanceBlock, cloud, dispatchCloud, ipcMain, keepLook, log, needsNotion, notify, openTailoredCv, printPdf, storage, track});   // lib/kit-handlers.js
  registerSessionHandlers({ipcMain, appLog, storage, getWindow: () => window, dialog, nativeImage, here,
    DEMO, apply, pipeline, review, server, notion, claudeConsent});
  registerAppMetaHandlers({DEMO, FROM_SOURCE, app, betaOn, checkForUpdate, cloud, dialog, installUpdate, ipcMain, licenseState, log, storage, testerLogsOn, testerOn, track,
    getLicense: () => license, getTelemetry: () => telemetry, getUpdateOffer: () => updateOffer, setUpdateOffer: value => { updateOffer = value; },
    getUpdateCheckedAt: () => updateCheckedAt, getWindow: () => window});   // lib/app-meta-handlers.js
  const {showForm} = registerApplyHandlers({DEMO, allowanceBlock, claudeConsent, cloud, here, ipcMain, log, needsNotion, prepareKitFor, getRecipeReporter: () => recipeReporterRef, shell, startClaude, storage, toWindow, track});   // lib/apply-handlers.js
  registerCvAndLettersHandlers({BrowserWindow, DEMO, cvOf, handleImportant, ipcMain, keepLook, openTailoredCv, printPdf, shell, storage, tailorCv, tailoring, toWindow});   // lib/cv-handlers.js
  registerVisitsHandlers({DEMO, allowanceBlock, here, ipcMain, log, readSites, shell, storage});   // lib/visits-handlers.js
  registerBrowserHandlers({app, clipboard, ipcMain, openNotion, shell, showForm, storage});   // lib/browser-handlers.js
}

// Started from a terminal that's since closed, writing a log line fails (EIO/EPIPE); that must never crash the app.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => {});

// A separate data folder for tests and demos (JOB_PILOTTO_USER_DATA), so they never touch the real one.
if (DEMO_FOLDER) app.setPath('userData', DEMO_FOLDER);
else if (process.env.JOB_PILOTTO_USER_DATA) app.setPath('userData', process.env.JOB_PILOTTO_USER_DATA);

// A reset asked for in Settings → Danger zone: the data folder is moved aside (or deleted) now, before anything
// opens it; the app then starts like the first time (the setup wizard).
let resetDone = null;
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
// Apply with Claude for one job: the job row's button, the page's "Take over" and an account page the extension reached.
const startClaude = async (url, details = null) => allowanceBlock() || (await claudeConsent())
  ? apply.claudeOne(storage, url, undefined, undefined, undefined, details).then(result => {
    if (result?.ok) { track('apply_started', {how: 'claude'}); handOverForms(url); } else terminals.dropForm(String(url).split('#')[0]);
    return result;
  })
  : {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'};
// The Applying flows' decisions (stuck → hand-over, the stage from each report, the hand-over's tab): lib/session-flow.js, unit-tested.
let sessionFlow = null;
const flow = () => (sessionFlow ||= createSessionFlow({terminals, review, apply, appLog, toWindow, startClaude,
  claudeAllowed: () => !!storage.settings().claudeConsent, closeTab: session => closeSessionTab({review, closeTab: closeFormTab}, session)}));
const handOverForms = url => flow().handOver(url);
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
  logTo(path.join(app.getPath('userData'), 'logs'), electronLog);
  if (resetDone) appLog('data', resetDone.failed ? `reset or import not applied: ${resetDone.failed}` : `applied at start: ${resetDone.imported ? 'import' : resetDone.deleted ? 'reset (deleted)' : 'reset'}`, {backup: resetDone.backup || '', waitedMs: resetDone.waited || 0});   // waitedMs: Windows still held the folder after the old app quit
  requestLog.setFile(path.join(app.getPath('userData'), 'logs', 'notion-requests.log'));  // every Notion request, one line
  engineLog.setFile(path.join(app.getPath('userData'), 'logs', 'engine.log'));  // everything a run printed, in full
  // E2E on a Linux CI runner only (no keyring there): Electron's safeStorage refuses the basic store unless told to. A user's app never takes this path.
  if (process.platform === 'linux' && process.env.JOB_PILOTTO_E2E && process.env.CI) safeStorage.setUsePlainTextEncryption?.(true);
  storage = createStorage(app.getPath('userData'), DEMO ? {encrypt: value => value, decrypt: value => value} : safeStorageCrypto(safeStorage));
  // An import on the Mac that made it: its sealed keys open here; an older export without them takes them from the same Profile's backup (lib/reset.js adoptBackupKeys).
  if (resetDone?.imported) {
    const kept = reset.adoptBackupKeys(storage);
    if (kept) appLog('data', 'import: keys taken from this computer\'s backup of the same Profile', {from: path.basename(kept.from), names: kept.names});
    if (storage.secret('NOTION_TOKEN')) resetDone.notionElsewhere = false;
  }
  if (resetDone?.notionElsewhere) appLog('data', 'import: Profile and tracking are in the backup\'s Notion workspace, no key came with it', {decidedBy: 'reset.notionLeftBehind'});
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
  // A site with no account item yet gets the one job-site password (made the first time), kept under its own name so Settings →
  // Credentials lists it with the profile's email (owner, 8 Oct 2026: the whole flow by itself, one password reused everywhere).
  server.setSitePasswordHandler(async ({host} = {}) => {
    const applying = terminals.list().some(session => !session.outcome && !session.endedAt);
    if (DEMO || !applying || !credentials.forExtension(host, {applying, read: () => 'x'}).ok) {
      appLog('extension', 'site password refused', {host: String(host || '').slice(0, 120), applying});
      return {ok: false};
    }
    let answer = credentials.forExtension(host, {applying});
    let made = false;
    if (!answer.ok) {
      const email = await Promise.resolve(notionGate.connected(storage) ? contactDetails.read(storage) : {}).then(contact => contact?.email || '').catch(() => '');
      const {code} = await pipeline.run(storage, ['src.ai.passwords', 'new', host, '--no-copy', ...(email ? ['--email', email] : [])]);
      made = code === 0;
      answer = credentials.forExtension(host, {applying});
    }
    appLog('extension', 'site password given for a sign-in page', {host: String(host || '').slice(0, 120), made, given: !!answer.ok});   // which site, never the password
    return answer;
  });
  // A page of a session's form reported: its tab is open, so a stopped Claude session is not "Ended" (terminals.formInChrome).
  const formSeen = id => { if (id && terminals.formInChrome(id)) appLog('sessions', 'form open in Chrome: the session is active again', {id}); };
  server.setReviewHandler(payload => {
    const report = review.report(terminals.list(), payload);
    if (report.matched && report.session) formSeen(report.matched);
    return report.session ? {...report, cv: cvOf(report.session.url)} : report;
  });
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
  server.setAliasesHandler(() => aliasLibrary.forExtension(storage, {onSent: shared}));   // shared meanings + this Mac's (lib/contact-keys.js)
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
  server.setVisitRoute('/extension/posting', payload => visits.posting(storage, payload));   // a posting read in your browser ("Jobs we couldn't read")
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
  server.setTabsHandler(report => {
    const sessions = terminals.list();
    review.noteTabs(report, new Set(sessions.map(session => session.id)));
    for (const session of sessions) if (review.tabOpen(session.id) === true) formSeen(session.id);   // a restarted app: its form is still open
    return visits.noteTabs(report);
  });   // one tab report: form tabs (Applying) and read tabs (Find jobs using your browser)
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
  server.setStuckHandler(event => { flow().stuck(event); });   // tier 3: the extension can't reach a form (lib/session-flow.js)
  review.onBind(({id, tab, before, by, host}) => appLog('review', `tab ${tab} is session ${id}'s now`, {before, by, host}));   // which tab a session follows, and why
  review.setReporter(state => flow().reported(state));   // the step each form report puts its session at (lib/session-flow.js)
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
    // The user's side kept in step with this app (lib/github.js updateRepo, lib/telegram-cloud.js refresh): names only, never a value.
    if (cloud()) github.updateRepo(storage).then(changed => {
      if (changed.length) { log(`Updated in your GitHub repo: ${changed.join(', ')}`); appLog('cloud', 'repo brought in step with this app', {changed: changed.length, what: changed.join(', '), decidedBy: 'app start'}); }
    }, error => { log(`GitHub repo not updated: ${error.message}`); appLog('cloud', 'repo not updated', {error: error.message}); })
      .then(() => telegramCloud.refresh(storage))
      .then(result => result && appLog('cloud', result.ok ? 'Telegram Worker redeployed: other code or settings' : 'Telegram Worker not redeployed', {error: result.error, decidedBy: 'app start'}),
        error => appLog('cloud', 'Telegram Worker not redeployed', {error: error.message}));
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
  toWindow('toast', {title: `Needs your input · ${what}`, body: text, target: targets.clean({view: 'sessions', session: session.id})});   // a click opens its card
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
