// "Apply to N jobs": pick the N best open jobs and start applying.
//   chrome: open them as tabs in the browser with the extension (Chrome, Edge…); the Job Pilotto extension fills each, you submit.
//   agents: one Claude session per job in Terminal (tools/apply-batch-claude.sh), driving Chrome with
//     Claude in Chrome; it follows a job board's Apply to the employer's site, signs up there if asked,
//     and fills every page. Recommended when Claude Code is installed; needs Notion kits.
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pipeline from './pipeline.js';
import * as session from './claude-session.js';
import * as terminals from './terminals.js';
import {browserCommand, browserOf} from './browser-launch.js';
import * as extensionInstall from './extension-install.js';

export const FILL_MARK = 'jobpilotto-fill'; // must match extension/background.js

// Saved jobs first, then by fit.
const best = (a, b) => (b.status === 'saved') - (a.status === 'saved') || (b.fit ?? -1) - (a.fit ?? -1);
const open = job => ['unreviewed', 'saved'].includes(job.status) && job.url;

// Only jobs with a drafted kit (their form is already answered), best first.
export function pick(jobs, n) {
  return jobs.filter(job => open(job) && job.kit).sort(best).slice(0, n);
}

// The best open jobs that still have no kit: what an Apply batch drafts first when fewer than N are ready.
export function pickMissing(jobs, n) {
  return jobs.filter(job => open(job) && job.code && !job.kit).sort(best).slice(0, n);
}

// Draft the missing kits one after the other (about 20 s each). `prepare(code, name)` is the app's prepareKit.
// Returns how many are ready now, or {cloud: true} when they are drafted on GitHub and cannot be waited for here.
export async function draftMissing(jobs, shortfall, prepare) {
  let done = 0;
  for (const job of pickMissing(jobs, shortfall)) {
    const result = await prepare(job.code, `${job.title} · ${job.company}`).catch(() => ({ok: false}));
    if (result.cloud) return {cloud: true, done};
    if (result.ok) done++;
  }
  return {done};
}

const NO_KITS = 'No job has an application kit yet, and none could be drafted. Press Apply on one job to see why.';
const ON_GITHUB = 'Kits are being drafted on GitHub (Always on). Press Apply again in a few minutes, when the jobs show 📝 Kit.';

// Tier 1: where the application form lives for a known site, when the posting page only has an "Apply" button in front of it.
// Ashby: <posting>/application, Lever: <posting>/apply, Workable: <posting>/apply. Anything else (or a URL already there) opens as it is.
export function formUrl(url) {
  let parsed;
  try { parsed = new URL(String(url).split('#')[0]); } catch { return String(url || ''); }
  const path = parsed.pathname.replace(/\/+$/, '');
  const host = parsed.hostname.toLowerCase();
  const to = suffix => `${parsed.origin}${path}${suffix}${parsed.search}`;
  if (host === 'jobs.ashbyhq.com' && /^\/[^/]+\/[0-9a-f-]{36}$/i.test(path)) return to('/application');
  if (host === 'jobs.lever.co' && /^\/[^/]+\/[0-9a-f-]{36}$/i.test(path)) return to('/apply');
  if (host === 'apply.workable.com' && /^\/[^/]+\/j\/[0-9A-Za-z]+$/.test(path)) return to('/apply');
  return String(url).split('#')[0];
}

// Is this URL (a page the extension reported) the form of that job's posting: the posting itself, its direct form link, or a
// page below it. Exact on the job, unlike the page-to-session match, so a stuck report never lands on another job at the same company.
export function isFormOf(reported, posting) {
  const key = url => String(url || '').split('#')[0].replace(/\/+$/, '');
  const [page, job] = [key(reported), key(posting)];
  return !!page && !!job && (page === job || page === key(formUrl(posting)) || page.startsWith(`${job}/`));
}

// One job, from its row: open it in Chrome with the fill marker, so the extension fills the form by itself.
export function openOne(url, open = spawn) {
  if (!/^https?:\/\//.test(url || '')) return {ok: false, error: 'This job has no link to open.'};
  const chrome = chromeCommand([`${formUrl(url)}#${FILL_MARK}`], process.platform, process.env, fs.existsSync, extensionBrowser());
  if (!chrome) return {ok: false, error: NO_CHROME};
  open(...chrome, {detached: true, stdio: 'ignore'}).unref();
  return {ok: true};
}

// The Apply button: the form tab, and a form session for it in the Applying page (the job goes to Applying in Notion, like an
// Apply with Claude session). The session shows what is left in the form from the extension's reports and moves to Applied
// when the extension sees the submit. Pressing Apply on a job that already has an open form session reopens only the tab.
export async function applyOne(storage, url, details = {}, {open = spawn, term = terminals, run = pipeline.run, id = () => crypto.randomUUID().slice(0, 8)} = {}) {
  const opened = openOne(url, open);
  if (!opened.ok) return opened;
  const fresh = !term.list().some(s => s.url === url.split('#')[0] && s.kind === 'form' && !s.outcome);
  const session = term.startForm({id: id(), url: url.split('#')[0], title: details?.title || '', company: details?.company || '',
    location: details?.location || '', workMode: details?.workMode || ''});
  if (fresh) run(storage, ['src.ai.apply_batch', '--mark-applying', url.split('#')[0]]).catch(() => {});
  return {ok: true, session};
}

const NO_CHROME = 'No supported browser was found. Install Chrome or Edge (with the Job Pilotto extension) to fill applications.';

// How to open URLs in the browser that has the extension (Chrome, Edge, Brave, Vivaldi): see browser-launch.js.
// `prefer` is that browser's app name. null when none is installed.
export const chromeCommand = browserCommand;

// The browser a form would open in now (the extension's, else Chrome, else Edge…), as an app name, for the wording of the install steps.
export function launchBrowser(find = extensionInstall.installed, command = browserCommand) {
  return extensionBrowser(find) || browserOf(command(['x'], process.platform, process.env, fs.existsSync)) || 'Google Chrome';
}

// The browser the Job Pilotto extension is installed in, enabled, for a form to open in: the copy loaded from the app's own
// folder first. '' when none is found (Chrome, then Edge, is tried).
export function extensionBrowser(find = extensionInstall.installed) {
  try {
    const found = find({folder: path.join(pipeline.REPO, 'extension')}).filter(copy => copy.enabled);
    return (found.find(copy => copy.current) || found[0])?.app || '';
  } catch { return ''; }
}

// Where the Claude Code installer and Homebrew put `claude`: an app opened from the Finder has no shell PATH.
// On Windows: claude.exe (native installer, ~/.local/bin) or claude.cmd (npm, %APPDATA%\npm).
export function claudeBinary(env = process.env, exists = fs.existsSync, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const home = env.USERPROFILE && platform === 'win32' ? env.USERPROFILE : os.homedir();
  const dirs = [...String(env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean), p.join(home, '.local', 'bin'),
    p.join(home, '.claude', 'local'), ...(platform === 'win32' ? [env.APPDATA && p.join(env.APPDATA, 'npm')].filter(Boolean)
      : ['/opt/homebrew/bin', '/usr/local/bin'])];
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  return dirs.flatMap(dir => names.map(name => p.join(dir, name))).find(file => exists(file)) || '';
}

// Git for Windows: Claude Code on Windows runs its commands in its bash. Where the installer puts it, or
// where CLAUDE_CODE_GIT_BASH_PATH says.
export function gitBash(env = process.env, exists = fs.existsSync) {
  return [env.CLAUDE_CODE_GIT_BASH_PATH, env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe')].filter(Boolean).find(file => exists(file)) || '';
}

// Signed in to Claude Code: its settings file names the Claude account after `claude` → /login.
export function claudeSignedIn(home = os.homedir(), read = fs.readFileSync) {
  try { return !!JSON.parse(read(path.join(home, '.claude.json'), 'utf8')).oauthAccount; } catch { return false; }
}

// The Claude in Chrome extension (Chrome Web Store id), found in any Chrome profile's Extensions folder. Whether it's
// signed in can't be seen from here; installed is what we can check.
export const CLAUDE_IN_CHROME = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
export function chromeProfiles(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  return path.join(home, '.config', 'google-chrome');
}
export function claudeInChrome(root = chromeProfiles(), list = dir => fs.readdirSync(dir)) {
  try {
    return list(root).some(profile => { try { return list(path.join(root, profile, 'Extensions')).includes(CLAUDE_IN_CHROME); } catch { return false; } });
  } catch { return false; }
}

// What Apply with Claude needs that only the user can set up, for the wizard's checklist.
export function claudePrereqs(platform = process.platform, {binary = claudeBinary, signedIn = claudeSignedIn, bash = gitBash, chrome = claudeInChrome} = {}) {
  return {claude: !!binary(), signedIn: signedIn(), git: platform === 'win32' ? !!bash() : null, windows: platform === 'win32', chrome: chrome()};
}

// Apply with Claude works when Claude Code is installed (with Git for Windows there) and Notion holds the kits.
// Sessions start from lib/claude-session.js: Terminal on the Mac, a console window on Windows.
export function claudeReady(storage, binary = claudeBinary, platform = process.platform, bash = gitBash) {
  if (!binary()) return {ok: false, error: 'Apply with Claude needs Claude Code: install it from claude.com/claude-code, or use Fill in Chrome.'};
  if (platform === 'win32' && !bash()) return {ok: false, error: 'Apply with Claude on Windows needs Git for Windows (git-scm.com), which Claude Code uses. Or use Fill in Chrome.'};
  if (!storage.secret('NOTION_TOKEN')) return {ok: false, error: 'Apply with Claude reads the kit from Notion. Connect Notion in Settings first, or use Fill in Chrome.'};
  return {ok: true};
}

// The job's kit in Notion (answers and cover letter): a Claude session has nothing to fill from without it.
export async function hasKit(storage, url, run = pipeline.run) {
  const lines = [];
  const {code} = await run(storage, ['src.ai.apply_batch', '--has-kit', url], line => lines.push(line));
  return code === 0 ? {ok: true} : {ok: false, error: `No application kit for this job yet: draft it first with ⋯ → Prepare only. ${lines.slice(-1)[0] || ''}`.trim()};
}

// The N best jobs with a kit that aren't started yet (Kit ready, or Saved with a kit), from Notion.
// The best n jobs with a kit: their URLs, with the title and company of each (details) for its session card.
export async function nextWithKits(storage, n, run = pipeline.run) {
  const {code, stdout} = await run(storage, ['src.ai.apply_batch', '--next', String(n), '--details']);
  // One JSON line per job (--details); a plain link line (an older pipeline) is read as a job without details.
  const jobs = code === 0 ? stdout.split(/\r?\n/).map(line => line.trim()).map(line => { try { return JSON.parse(line); } catch { return {url: line}; } })
    .filter(job => /^https?:\/\//.test(job?.url || '')) : [];
  const urls = jobs.map(job => job.url);
  urls.details = Object.fromEntries(jobs.map(({url, ...rest}) => [url, rest]));
  return urls;
}

// One job, from its row: a Claude session in its own window takes it from the posting to a filled form.
// Sessions run inside the app unless Settings says Terminal windows, or the terminal module can't load.
export async function inApp(storage, available = terminals.available) {
  return storage.settings().sessionsInApp !== false && await available();
}

// The app opens no tab for an Apply with Claude session. claude-in-chrome acts only on tabs in its own group and
// cannot see one the app opened (tabs_context_mcp: "No tab group exists for this session"), so Claude made a second
// tab, without the mark, beside the app's (1 Oct 2026). The session opens the one tab itself, with #jobpilotto-fill.
const openForm = () => {};

export async function claudeOne(storage, url, launch = session.launch, binary = claudeBinary, kit = hasKit, details = null) {
  if (!/^https?:\/\//.test(url || '')) return {ok: false, error: 'This job has no link to open.'};
  const ready = claudeReady(storage, binary);
  if (!ready.ok) return ready;
  const drafted = await kit(storage, url);
  if (!drafted.ok) return drafted;
  // A launcher passed in (tests, the Terminal fallback) is used as given; the app's default is the in-app terminal.
  if (launch === session.launch && await inApp(storage)) {
    const [started] = await session.launchInApp(storage, [url.split('#')[0]], {claude: binary(), open: openForm, details: details ? {[url.split('#')[0]]: details} : {}});
    return {ok: true, session: started};
  }
  await launch(storage, [url.split('#')[0]], {claude: binary(), open: openForm});
  return {ok: true};
}

// A session that isn't running (the app was closed and reopened): Claude again, in its conversation.
export async function resumeSession(storage, id, binary = claudeBinary) {
  const ready = claudeReady(storage, binary);
  if (!ready.ok) return ready;
  return session.resumeInApp(storage, id, {claude: binary()});
}

// `prepare` drafts a missing kit (the app's prepareKit): with it, a batch with fewer than N ready jobs drafts the rest first.
export async function start(storage, {n, mode}, open = spawn, list = pipeline.jobs, launch = session.launch, next = nextWithKits, prepare = null) {
  n = Math.max(1, Math.min(10, Number(n) || 1));
  if (mode === 'agents') {
    const ready = claudeReady(storage);
    if (!ready.ok) return ready;
    let urls = await next(storage, n);
    let drafted = 0;
    if (urls.length < n && prepare) {
      const result = await draftMissing((await list(storage)).jobs, n - urls.length, prepare);
      if (result.cloud) return {ok: false, error: ON_GITHUB};
      drafted = result.done;
      if (drafted) urls = await next(storage, n);
    }
    if (!urls.length) return {ok: false, error: NO_KITS};
    const here = launch === session.launch && await inApp(storage);
    (here ? session.launchInApp(storage, urls, {claude: claudeBinary(), open: openForm, details: urls.details || {}}) : launch(storage, urls, {claude: claudeBinary(), open: openForm})).catch(() => {});
    n = urls.length;
    const first = drafted ? `Drafted ${drafted} kit${drafted === 1 ? '' : 's'} first. ` : '';
    return {ok: true, inApp: here, message: first + (here
      ? `Starting ${n} Claude session(s) in the app, a few seconds apart. Each shows in Application sessions at the bottom; you're notified when one needs you. It stops before Submit for your review.`
      : `Starting ${n} Claude session(s), one window per job. Each reads sign-up emails itself, asks you in its window for a CAPTCHA, and stops before Submit for your review.`)};
  }
  let {jobs} = await list(storage);
  let chosen = pick(jobs, n);
  let drafted = 0;
  if (chosen.length < n && prepare) {
    const result = await draftMissing(jobs, n - chosen.length, prepare);
    if (result.cloud) return {ok: false, error: ON_GITHUB};
    drafted = result.done;
    if (drafted) { ({jobs} = await list(storage)); chosen = pick(jobs, n); }
  }
  if (!chosen.length) return {ok: false, error: NO_KITS};
  // The marker tells the extension to fill each tab by itself as it loads, all tabs in parallel.
  const chrome = chromeCommand(chosen.map(job => `${job.url.split('#')[0]}#${FILL_MARK}`), process.platform, process.env, fs.existsSync, extensionBrowser());
  if (!chrome) return {ok: false, error: NO_CHROME};
  open(...chrome, {detached: true, stdio: 'ignore'}).unref();
  return {ok: true, jobs: chosen.map(job => `${job.title} · ${job.company}`),
    message: `${drafted ? `Drafted ${drafted} kit${drafted === 1 ? '' : 's'} first. ` : ''}Opened ${chosen.length} job(s) in Chrome; each fills itself in a few seconds. Review every tab and submit yourself. ` +
      '(If a form sits behind an "Apply" button, open it and click ✈️ → Fill with AI.)'};
}
