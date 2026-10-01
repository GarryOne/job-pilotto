// "Apply to N jobs": pick the N best open jobs and start applying.
//   chrome: open them as tabs in Google Chrome; the Job Pilotto extension fills each, you submit.
//   agents: one Claude session per job in Terminal (tools/apply-batch-claude.sh), driving Chrome with
//     Claude in Chrome; it follows a job board's Apply to the employer's site, signs up there if asked,
//     and fills every page. Recommended when Claude Code is installed; needs Notion kits.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pipeline from './pipeline.js';
import * as session from './claude-session.js';
import * as terminals from './terminals.js';

export const FILL_MARK = 'jobpilotto-fill'; // must match extension/background.js

// Only jobs with a drafted kit (their form is already answered), best first.
export function pick(jobs, n) {
  return jobs.filter(job => ['unreviewed', 'saved'].includes(job.status) && job.url && job.kit)
    .sort((a, b) => (b.status === 'saved') - (a.status === 'saved') || (b.fit ?? -1) - (a.fit ?? -1))
    .slice(0, n);
}

// One job, from its row: open it in Chrome with the fill marker, so the extension fills the form by itself.
export function openOne(url, open = spawn) {
  if (!/^https?:\/\//.test(url || '')) return {ok: false, error: 'This job has no link to open.'};
  const chrome = chromeCommand([`${url.split('#')[0]}#${FILL_MARK}`]);
  if (!chrome) return {ok: false, error: NO_CHROME};
  open(...chrome, {detached: true, stdio: 'ignore'}).unref();
  return {ok: true};
}

const NO_CHROME = 'Google Chrome was not found. Install it (with the Job Pilotto extension) to fill applications.';

// How to open URLs in Chrome: `open -a` on the Mac; on Windows chrome.exe itself (no shell, so a URL's & stays
// part of the URL), from where the installer puts it. null when Chrome isn't installed.
export function chromeCommand(urls, platform = process.platform, env = process.env, exists = fs.existsSync) {
  if (platform !== 'win32') return ['open', ['-a', 'Google Chrome', ...urls]];
  const chrome = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean)
    .map(dir => path.win32.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(file => exists(file));
  return chrome ? [chrome, urls] : null;
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
  return code === 0 ? {ok: true} : {ok: false, error: `No application kit for this job yet: press Prepare first. ${lines.slice(-1)[0] || ''}`.trim()};
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

export async function start(storage, {n, mode}, open = spawn, list = pipeline.jobs, launch = session.launch, next = nextWithKits) {
  n = Math.max(1, Math.min(10, Number(n) || 1));
  if (mode === 'agents') {
    const ready = claudeReady(storage);
    if (!ready.ok) return ready;
    const urls = await next(storage, n);
    if (!urls.length) return {ok: false, error: 'No job has an application kit yet. Press Prepare on the jobs you like first (about 20 s each).'};
    const here = launch === session.launch && await inApp(storage);
    (here ? session.launchInApp(storage, urls, {claude: claudeBinary(), open: openForm, details: urls.details || {}}) : launch(storage, urls, {claude: claudeBinary(), open: openForm})).catch(() => {});
    n = urls.length;
    return {ok: true, inApp: here, message: here
      ? `Starting ${n} Claude session(s) in the app, a few seconds apart. Each shows in Application sessions at the bottom; you're notified when one needs you. It stops before Submit for your review.`
      : `Starting ${n} Claude session(s), one window per job. Each reads sign-up emails itself, asks you in its window for a CAPTCHA, and stops before Submit for your review.`};
  }
  const {jobs} = await list(storage);
  const chosen = pick(jobs, n);
  if (!chosen.length) return {ok: false, error: 'No job has an application kit yet. Press Prepare on the jobs you like first (about 20 s each).'};
  // The marker tells the extension to fill each tab by itself as it loads, all tabs in parallel.
  const chrome = chromeCommand(chosen.map(job => `${job.url.split('#')[0]}#${FILL_MARK}`));
  if (!chrome) return {ok: false, error: NO_CHROME};
  open(...chrome, {detached: true, stdio: 'ignore'}).unref();
  return {ok: true, jobs: chosen.map(job => `${job.title} · ${job.company}`),
    message: `Opened ${chosen.length} job(s) in Chrome; each fills itself in a few seconds. Review every tab and submit yourself. ` +
      '(If a form sits behind an "Apply" button, open it and click ✈️ → Fill with AI.)'};
}
