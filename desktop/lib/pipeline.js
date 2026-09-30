// Runs the existing Python pipeline (src/) for this user: their folder, their keys, their models.
import * as poolShare from './pool-share.js';
import * as demo from './demo.js';
import * as requestLog from './request-log.js';
import {log as appLog} from './log.js';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {cadence} from './cadence.js';
import {ROOT} from './root.js';

export const REPO = ROOT;
export const MODELS = {enrich: 'claude-haiku-4-5', score: 'claude-sonnet-5', kit: 'claude-sonnet-5', insight: 'claude-sonnet-5'};
const DEFAULT_CONFIG = ['search.json', 'preferences.json', 'sources.json', 'scout_seeds.json'];

// The packaged app's own Python (with the anthropic package), else the repo's virtualenv, else python3.
// Windows keeps them elsewhere: python\python.exe (python-build-standalone) and .venv\Scripts\python.exe.
export function python(platform = process.platform, exists = fs.existsSync) {
  const candidates = platform === 'win32'
    ? [path.join(REPO, 'python', 'python.exe'), path.join(REPO, '.venv', 'Scripts', 'python.exe')]
    : [path.join(REPO, 'python', 'bin', 'python3'), path.join(REPO, '.venv', 'bin', 'python')];
  return candidates.find(candidate => exists(candidate)) || (platform === 'win32' ? 'python' : 'python3');
}

// First run: the user's config starts as the repo defaults (the wizard then rewrites search/preferences).
export function ensureConfig(storage) {
  for (const name of DEFAULT_CONFIG) {
    const target = storage.path(path.join('config', name));
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.copyFileSync(path.join(REPO, 'config', name), target);
    }
  }
}

// Only what a program needs to run, from the parent environment: never the developer's tokens or
// Job Pilotto settings exported in the shell the app was started from.
// On Windows, Python can't open a socket without SystemRoot, and finds the user's folders through the rest.
const SYSTEM = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SSL_CERT_FILE',
  'SystemRoot', 'SYSTEMROOT', 'windir', 'USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT'];

export function pipelineEnv(storage, parent = process.env) {
  const settings = storage.settings();
  const env = {
    ...Object.fromEntries(SYSTEM.filter(name => parent[name]).map(name => [name, parent[name]])),
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',  // files and pipes in UTF-8 on Windows too (its default is the ANSI code page)
    JOB_PILOTTO_NO_DOTENV: '1',
    JOB_PILOTTO_SOURCE: 'Job Pilotto app',  // the Source of Applications rows the app creates
    JOB_PILOTTO_CONFIG_DIR: storage.path('config'),
    JOB_PILOTTO_DATA_DIR: storage.path('data'),
    JOB_PILOTTO_CV_PATH: storage.path('cv.pdf'),
    ...(requestLog.logPath() ? {JOB_PILOTTO_NOTION_LOG: requestLog.logPath()} : {}),  // Python's Notion requests: same file
  };
  // The Profile and standard answers are read from Notion (Notion is required).
  for (const name of ['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY']) {
    const value = storage.secret(name);
    if (value) env[name] = value;
  }
  // The free AI credit (lib/ai-trial.js): the Python SDK follows ANTHROPIC_BASE_URL like the app's.
  if (settings.aiTrial) env.ANTHROPIC_BASE_URL = 'https://www.jobpilotto.workers.dev/api/ai'; else delete env.ANTHROPIC_BASE_URL;
  if (env.ANTHROPIC_API_KEY) {
    env.JOB_PILOTTO_ENRICH_MODEL = MODELS.enrich;
    env.JOB_PILOTTO_SCORE_MODEL = MODELS.score;
    env.JOB_PILOTTO_KIT_MODEL = MODELS.kit;
    env.JOB_PILOTTO_INSIGHT_MODEL = MODELS.insight;
    env.JOB_PILOTTO_MAIL_MODEL = MODELS.enrich;
  }
  Object.assign(env, poolShare.variables(storage) || {});  // "Help the pool grow": only when the user turned it on
  if (settings.telegramChatId) env.TELEGRAM_CHAT_ID = String(settings.telegramChatId);
  for (const [key, value] of Object.entries(settings.notionIds || {})) if (value) env[key] = value;
  return env;
}

// Telegram HTML (the pipeline formats its messages for Telegram) as readable text, for every place the app shows
// output: the live and saved logs, Recent activity, the Actions answer. Only Telegram's tags are removed (a log's
// own "<" stays), a link keeps its address ("text (url)"), and entities such as &#x27; become their character.
const TELEGRAM_TAG = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler|span)(?:\s[^>]*)?>/gi;
const NAMED = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
export function readable(text) {
  return String(text ?? '')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, url, label) => (label && label !== url ? `${label} (${url})` : url))
    .replace(TELEGRAM_TAG, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => code[0] === '#'
      ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10))
      : NAMED[code.toLowerCase()] ?? match);
}

// The pipeline processes running now: stopRunning() ends them cleanly when the app quits (instead of them
// failing on their next line once the app is gone).
const children = new Set();
export function stopRunning() { for (const child of children) child.kill('SIGTERM'); }

// Run `python -m <args>` in the repo; resolve with {code, stdout}; each output line goes to onLine (made readable).
// stdout itself stays as printed, for the callers that parse it.
// Every finished run is told to these (technical reports: a failed run, with its last lines; lib/telemetry.js).
const runEnd = new Set();
export const onRunEnd = listener => runEnd.add(listener);
// Demo mode (lib/demo.js): only jobs that read the demo folder run; the rest end at once, nothing sent.
let demoMode = false;
export const setDemo = on => { demoMode = !!on; };
export function run(storage, args, onLine = () => {}, extraEnv = {}) {
  if (demoMode && !demo.pipelineAllowed(args)) { onLine('Demo mode: nothing runs and nothing is sent.'); return Promise.resolve({code: 1, stdout: ''}); }
  const started = Date.now(), tail = [];
  const told = onLine;
  onLine = line => {
    tail.push(line); if (tail.length > 30) tail.shift();
    if (TIDIED.test(line)) appLog('tidy', line);  // a duplicate event the job moved to the Notion trash: never silent
    told(line);
  };
  return new Promise((resolve, reject) => {
    const child = spawn(python(), ['-m', ...args], {cwd: REPO, env: {...pipelineEnv(storage), ...extraEnv}});
    children.add(child);
    child.on('exit', () => children.delete(child));
    let stdout = '', buffer = '';
    const lines = chunk => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);  // Windows ends lines with \r\n
      buffer = parts.pop();
      parts.filter(Boolean).map(readable).forEach(onLine);
    };
    child.stdout.on('data', data => { stdout += data; lines(String(data)); });
    child.stderr.on('data', data => lines(String(data)));
    child.on('error', reject);
    child.on('close', code => {
      if (buffer) onLine(readable(buffer));
      for (const listener of runEnd) { try { listener({args, code, seconds: Math.round((Date.now() - started) / 1000), tail: [...tail]}); } catch {} }
      resolve({code, stdout});
    });
  });
}

export async function jobs(storage) {
  const {code, stdout} = await run(storage, ['src.desktop', 'jobs']);
  if (code !== 0) throw new Error('Could not read the job list');
  return JSON.parse(stdout.trim().split('\n').pop());
}

// A job applied to elsewhere: Applications row (Applied, with the date), the event, the frozen record, a Gmail
// check, and the job in the Jobs list as Applied. Waits for it, so the list can refresh; returns its one line.
// details: {title, company, text} for pages that aren't read (LinkedIn…); the AI stages then score it like a found job.
export async function addApplied(storage, url, when = '', onLine = () => {}, details = {}) {
  const inputs = {mode: 'add', job: url, note: when, jobTitle: details.title, jobCompany: details.company, jobText: details.text};
  const {code, stdout} = await run(storage, dailyArgs(storage, inputs), onLine);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  const text = readable(line);
  return {ok: code === 0 && !text.startsWith('⚠️'), text: text || 'Could not add it (see the activity log)'};
}

// A pasted message or screenshot (LinkedIn, Gmail, WhatsApp): Claude finds the job it's about and updates it in Notion,
// or adds it (src/ai/inbox.py), like /add <message> or a screenshot sent to the bot. file: the screenshot's path;
// target: '' (Claude decides), 'new', or a job URL.
// The confirmation step's answers as the engine's flags (src/daily.py add mode). company/agency '' = not named.
export function confirmedArgs(confirmed = {}) {
  const c = confirmed || {};
  const flag = (name, value) => (value ? [name, String(value)] : []);
  return [...flag('--kind', c.kind), ...flag('--channel', c.channel), ...flag('--channel-other', c.other),
    ...flag('--started', c.started), ...flag('--interview-at', c.interview),
    ...(typeof c.company === 'string' ? ['--company', c.company] : []), ...(typeof c.agency === 'string' ? ['--agency', c.agency] : []),
    ...(typeof c.firstContact === 'boolean' ? ['--first-contact', c.firstContact ? 'yes' : 'no'] : [])];
}
// Two steps, so nothing reaches Notion before you confirmed where the conversation is from and when it started:
// proposeLead reads it (the one AI call) and says what it would log; addLead with {reading, confirmed} writes it.
export async function proposeLead(storage, text, onLine = () => {}, {file = '', target = ''} = {}) {
  const {code, stdout} = await run(storage, [...dailyArgs(storage, {mode: 'add', note: text, file, target}), '--from-app', '--propose'], onLine);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  try { const proposal = JSON.parse(line); if (proposal.ok) return proposal; } catch {}
  const plain = readable(line);
  return {ok: false, text: code === 0 ? 'Could not read it (see the activity log)' : plain || 'Could not read it (see the activity log)'};
}
// reading: the path of proposeLead's result, saved as JSON; confirmed: what you confirmed (renderer/lead-confirm.js).
export async function addLead(storage, text, talking = false, onLine = () => {}, {file = '', target = '', reading = '', confirmed = null} = {}) {
  const extra = ['--from-app', ...(reading ? ['--reading', reading, ...confirmedArgs(confirmed)] : [])];
  const {code, stdout} = await run(storage, [...dailyArgs(storage, {mode: 'add', note: text, talking, file, target}), ...extra], onLine);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  const plain = readable(line);
  return {ok: code === 0 && !plain.startsWith('⚠️'), text: plain || 'Could not add it (see the activity log)'};
}

// One job's posting (title, company, description), for tailoring the CV to it.
export async function posting(storage, code) {
  const {code: exit, stdout} = await run(storage, ['src.desktop', 'posting', code]);
  if (exit !== 0) throw new Error('Could not read the job posting');
  return JSON.parse(stdout.trim().split('\n').pop());
}

// The same command .github/workflows/daily.yml runs for these inputs (mode, job, action, page, seed,
// file, note), so Telegram buttons and commands work the same from the app as from the cloud.
export function dailyArgs(storage, inputs = {}) {
  const mode = inputs.mode || 'scheduled';
  const ai = !!storage.secret('ANTHROPIC_API_KEY');
  const telegram = !!(storage.secret('TELEGRAM_BOT_TOKEN') && storage.settings().telegramChatId);
  // --log-run: every run from the app gets a row in Notion ⏰ Search runs (Notion is where the details live).
  const args = ['src', 'daily', '--mode', mode, ...(telegram ? ['--send'] : []), '--log-run'];
  if (inputs.job) args.push('--job', String(inputs.job), '--action', String(inputs.action || 'applied'));
  if (inputs.talking) args.push('--action', 'talking');
  if (inputs.target) args.push('--target', String(inputs.target));
  if (inputs.jobTitle) args.push('--job-title', String(inputs.jobTitle));
  if (inputs.jobCompany) args.push('--job-company', String(inputs.jobCompany));
  if (inputs.jobText) args.push('--job-text', String(inputs.jobText));
  if (inputs.page) args.push('--page', String(inputs.page));
  if (inputs.seed) args.push('--seed', String(inputs.seed));
  if (inputs.file) args.push('--file', String(inputs.file));
  if (inputs.note) args.push('--note', String(inputs.note));
  if (inputs.interview) args.push('--interview', String(inputs.interview));
  if (ai && ['scheduled', 'run', 'today'].includes(mode)) args.push('--enrich-max', '100', '--score-max', '60');
  const {insights, kits} = cadence(storage.settings());
  if (ai && mode === 'scheduled' && insights !== 'off') args.push('--insight');
  if (ai && kits > 0 && ['scheduled', 'run', 'today'].includes(mode)) args.push('--auto-kit-max', String(kits));
  return args;
}

// Crawls share one SQLite file: run them one at a time, like the workflow's concurrency group.
let crawling = Promise.resolve();
export function serial(task) {
  const next = crawling.then(task, task);
  crawling = next.catch(() => {});
  return next;
}

// Find new jobs: job boards, then employer feeds + Google Jobs, AI facts and fit scores (with a key),
// and the Telegram digest (when connected). mode 'scheduled' sends only when there's something new.
// Past runs for the activity bar (newest first, last 50): what (kind: 'search' when absent, or 'mail'),
// when, why, what came out, and the log.
export const RUN_HISTORY = 50;
export function saveRuns(storage, list) { storage.writeText('runs.json', JSON.stringify(list.slice(0, RUN_HISTORY))); }
export function runs(storage) { try { return JSON.parse(storage.readText('runs.json')) || []; } catch { return []; } }
let current = null;
export const running = () => current;
// Tracked tasks waiting behind the running one (oldest first), so Recent activity lists them at once.
let waiting = [], nextTicket = 0;
export const queued = () => waiting.map(({id, kind, trigger, queuedAt}) => ({id, kind, trigger, queuedAt}));

// The queue survives quitting the app: queue.json holds the running job and the waiting ones with how to start
// each again (resume: a search's mode, a task's command). The app starts the ones you started again next time
// (the schedule catches up its own). freezeQueue() keeps it as it is while the app quits.
const QUEUE_FILE = 'queue.json';
let frozen = false;
function saveQueue(storage) {
  if (frozen) return;
  const jobs = [...(current?.resume ? [{...current, interrupted: true}] : []), ...waiting]
    .map(({kind, trigger, queuedAt, startedAt, resume, interrupted}) => ({kind, trigger, queuedAt: queuedAt || startedAt, resume, ...(interrupted ? {interrupted} : {})}));
  storage.writeText(QUEUE_FILE, JSON.stringify(jobs));
}
export function freezeQueue(storage) { saveQueue(storage); frozen = true; }
// The jobs saved when the app last quit (and forgets them: they're started again, or dropped).
export function takeQueue(storage) {
  let jobs = [];
  try { jobs = JSON.parse(storage.readText(QUEUE_FILE)) || []; } catch {}
  storage.writeText(QUEUE_FILE, '[]');
  return jobs.filter(job => job && job.kind && job.resume);
}
// Resolves once nothing runs and nothing waits (for "Quit when done").
export async function whenIdle(poll = 2000) {
  while (current || waiting.length) await new Promise(resolve => setTimeout(resolve, poll));
}

export function refresh(storage, onLine, mode = 'run', trigger = 'you') {
  return tracked(storage, 'search', trigger, onLine, tee => searchOnce(storage, tee, mode, trigger), {mode}, record => {
    let summary = {};
    try { summary = JSON.parse(storage.readText('data/reports/last-run.json')); } catch {}
    const fresh = summary.started_at && Date.parse(summary.started_at) >= record.id - 60000;
    return fresh ? {found: summary.jobs ?? null, new: summary.new ?? 0, changed: summary.changed ?? 0,
      scored: summary.score?.done ?? summary.score?.scored ?? null, usd: summary.usd ?? 0, warnings: summary.warnings || []} : {};
  });
}

// Gmail and Calendar check (src/ai/mail.py): confirmations, replies, rejections and interviews -> Notion.
// `updates` = what it recorded (the lines it prints under "Updates:"), shown in the app and the notification.
export function mailArgs(storage, now = Date.now()) {
  const settings = storage.settings();
  const telegram = !!(storage.secret('TELEGRAM_BOT_TOKEN') && settings.telegramChatId);
  // Look back far enough to cover the time since the last check (the Mac may have been off), 2 to 14 days.
  const since = settings.lastMailOkAt ? (now - Date.parse(settings.lastMailOkAt)) / 86400000 : 0;
  const days = Math.min(14, Math.max(2, Math.ceil(since) + 1));
  return ['src.ai.mail', '--days', String(days), ...(telegram ? ['--send'] : []), '--log-run'];
}
// A check that ended normally (exit 0, so a GitHub run isn't marked crashed) without reading the mail: why, or null.
export function mailProblem(stdout) {
  if (/^Mail check skipped: the Anthropic API spend limit/m.test(stdout)) return 'not checked: the Anthropic API spend limit was reached';
  if (/The Google sign-in for Gmail and Calendar has expired/.test(stdout)) return 'not checked: the Google sign-in expired (Settings → Gmail and Calendar)';
  return null;
}
export function checkMail(storage, onLine, trigger = 'you') {
  let off = false, problem = null;
  return tracked(storage, 'mail', trigger, onLine, async tee => {
    const {code, stdout} = await run(storage, mailArgs(storage), tee, triggerEnv(trigger));
    off = /Gmail \+ Calendar is off/.test(stdout);
    problem = code === 0 ? mailProblem(stdout) : null;
    // lastMailAt paces the schedule (a failed or "not connected" check waits for the next time too);
    // lastMailOkAt sets how far back the next check looks: only a check that read the mail moves it.
    const at = new Date().toISOString();
    const ok = code === 0 && !problem;
    storage.saveSettings({lastMailAt: at, ...(ok && !off ? {lastMailOkAt: at} : {})});
    return {ok};
  }, {}, (record, log) => ({...mailResult(log), off, problem}));
}
// What a Gmail check recorded and its "Mail: …" summary line (also read from GitHub runs' logs, cloud-runs.js).
export function mailResult(log) {
  const start = log.indexOf('Updates:');
  // The update lines sit between "Updates:" and the "Mail: …" summary; what follows (the run-log link) isn't one.
  const after = start < 0 ? [] : log.slice(start + 1);
  const end = after.findIndex(line => /^Mail: /.test(line));
  const updates = (end < 0 ? after : after.slice(0, end)).filter(line => /^\S/.test(line) && !/^Cronjob run logged/.test(line));
  return {updates, summary: log.filter(line => /^Mail: /.test(line)).pop() || null};
}

// A one-off job the Actions page (or its Telegram command) starts: an insight, the weekly report, today's list,
// finding new employers. Tracked like a search, so Recent activity shows it running, then its result line
// (the one the pipeline prints, e.g. "Insight sent: Skills — …") and its Notion ⏱️ Search runs row.
export const TASKS = {
  insight: {name: 'Insight', result: /^(Insight sent: |Insight: )/},
  weekly: {name: 'Weekly report', result: /^Weekly report sent: /},
  today: {name: "Today's list", result: /^(Digest ready: |No new jobs since|Sent \d+ Telegram message)/},
  scout: {name: 'Find new employers', result: /Source scout(<\/b>)? · checked|^Source scout is off/},
};
export const taskName = kind => TASKS[kind]?.name || (kind === 'mail' ? 'Gmail check' : 'Jobs check');
// Find new employers (the scout), from the button, Telegram or the schedule; its time paces the next one.
export function scout(storage, onLine, trigger = 'you', batch = 15) {
  const send = storage.secret('TELEGRAM_BOT_TOKEN') && storage.settings().telegramChatId ? ['--send'] : [];  // no Telegram: the app shows it
  storage.saveSettings({lastScoutAt: new Date().toISOString()});
  return task(storage, 'scout', ['src', 'scout', ...send, '--log-run', '--batch', String(batch)], onLine, trigger);
}
export function task(storage, kind, args, onLine, trigger = 'you') {
  return tracked(storage, kind, trigger, onLine, async tee => {
    const {code} = await run(storage, args, tee, triggerEnv(trigger));
    return {ok: code === 0};
  }, {args}, (record, log) => ({summary: taskSummary(kind, log), message: appMessage(log)}));
}
// Without Telegram the pipeline prints its message between <<<message / message>>> (src/telegram.py to_app);
// the last one, as plain text (Telegram HTML removed), is what the app shows as the result.
export function appMessage(log) {
  const end = log.lastIndexOf('message>>>'), start = log.lastIndexOf('<<<message', end);
  if (end < 0 || start < 0) return null;
  return readable(log.slice(start + 1, end).join('\n')).trim().slice(0, 6000) || null;
}
// The result line a task printed, made readable: "Insight sent: Skills — Go in 40% (0.012 USD)" -> "Skills — Go in 40%".
export function taskSummary(kind, log) {
  const line = log.filter(entry => TASKS[kind]?.result.test(entry)).pop();
  return line ? readable(line).replace(/^(Insight sent|Weekly report sent|Insight): /, '')
    .replace(/^🔎 Source scout · /, '').replace(/\s*\([\d.]+ USD\)$/, '').trim() : null;
}

// One tracked task (a search or a Gmail check): `running()` shows it while it runs, and it's kept in
// runs.json afterwards (kind, trigger, times, ok, log and what summarize() adds) for the activity bar.
function tracked(storage, kind, trigger, onLine, work, resume, summarize) {
  // The same task already waiting: a second click joins it instead of queueing it twice.
  const twin = waiting.find(ticket => ticket.kind === kind);
  if (twin) return twin.done;
  const ticket = {id: `q${++nextTicket}`, kind, trigger, queuedAt: new Date().toISOString(), resume};
  waiting.push(ticket);
  saveQueue(storage);
  ticket.done = serial(async () => {
    waiting = waiting.filter(other => other !== ticket);
    const log = [];
    const record = {id: Date.now(), kind, trigger, startedAt: new Date().toISOString()};
    current = {...record, step: 'Starting', resume};
    saveQueue(storage);
    let inMessage = false;  // a message for the app (appMessage) isn't a progress step
    const tee = line => {
      log.push(line);
      if (line === '<<<message' || line === 'message>>>') inMessage = line === '<<<message';
      else if (!inMessage && !/^\s|^Warning/.test(line) && line.length < 120) current = {...current, step: line};
      onLine(line);
    };
    let ok = false;
    try {
      ok = (await work(tee)).ok;
    } catch (error) {
      tee(`${taskName(kind)} failed: ${error.message}`);
    } finally {
      const notionUrl = log.map(line => line.match(/^Cronjob run logged: (\S+)/)?.[1]).filter(Boolean).pop() || null;
      Object.assign(record, {endedAt: new Date().toISOString(), ok, notionUrl, log: log.slice(-400), ...summarize(record, log)});
      storage.writeText('runs.json', JSON.stringify([record, ...runs(storage)].slice(0, RUN_HISTORY)));
      current = null;
      saveQueue(storage);
    }
    return {ok, run: record};
  });
  return ticket.done;
}

// What started a run, for its Notion ⏰ Search runs row (GitHub runs say Schedule or Manual).
export const triggerEnv = trigger => ({JOB_PILOTTO_TRIGGER: trigger === 'schedule' ? 'Mac schedule' : 'Mac (you)'});

function searchOnce(storage, onLine, mode, trigger = 'you') {
  return (async () => {
    const ai = !!storage.secret('ANTHROPIC_API_KEY');
    onLine('Searching job boards (jobs.ch, TechTree)…');
    await run(storage, ['src', 'discover', '--pages', '1', '--max-companies', '40'], onLine);
    onLine('Checking employer career pages' + (ai ? ', then reading and scoring new jobs…' : '…'));
    const {code} = await run(storage, dailyArgs(storage, {mode}), onLine, triggerEnv(trigger));
    storage.saveSettings({lastSearchAt: new Date().toISOString(), lastSearchOk: code === 0});
    return {ok: code === 0};
  })();
}

// Why a rejected application was turned down (src/ai/rejection.py, Claude Sonnet 5): verdict + lesson on its
// Applications row and page. The last output line is the one-line summary.
export async function reviewRejection(storage, url, onLine = () => {}) {
  const {code, stdout} = await run(storage, ['src.ai.rejection', '--job', url], onLine, {JOB_PILOTTO_TRIGGER: 'Mac (you)'});
  const lines = stdout.trim().split('\n').filter(Boolean);
  const summary = lines.find(line => line.includes('Why rejected')) || '';
  return {ok: code === 0 && !!summary, text: summary || lines.pop() || 'The review failed (see the activity log)'};
}

// Focus (src/focus.py, no AI): what to do next, from Notion.
export async function focus(storage) {
  const {code, stdout} = await run(storage, ['src.focus']);  // the target comes from ⚙️ Search settings
  try { return {ok: code === 0, focus: JSON.parse(stdout.trim().split('\n').pop())}; }
  catch { return {ok: false, error: 'Could not read your Notion (see the activity log).'}; }
}
export async function focusDone(storage, pageId) {
  const {code} = await run(storage, ['src.focus', 'done', pageId, 'replied']);
  return {ok: code === 0};
}
// What you resolved from Focus, newest first (Notion: 📈 Application Events from the app, 💡 Insights you rated).
export async function focusHistory(storage) {
  const {code, stdout} = await run(storage, ['src.focus', 'history']);
  try { return {...JSON.parse(stdout.trim().split('\n').pop()), ok: code === 0}; }
  catch { return {ok: false, error: 'Notion could not be read. Try again.', items: []}; }
}
const lastJson = (stdout, fallback) => { try { return JSON.parse(stdout.trim().split('\n').pop()); } catch { return fallback; } };
// Interview prep kit (src/ai/prep.py): built on the job's Notion page; needs_description when the role is unknown.
export async function interviewPrep(storage, pageId, onLine = () => {}) {
  const {stdout} = await run(storage, ['src.ai.prep', 'build', pageId], onLine, triggerEnv('you'));
  return lastJson(stdout, {ok: false, text: 'The prep kit could not be built. Try again.'});
}
export async function describeJob(storage, pageId, text = '', url = '') {
  const {stdout} = await run(storage, ['src.ai.prep', 'describe', pageId, ...(text ? ['--text', text] : []), ...(url ? ['--url', url] : [])]);
  return lastJson(stdout, {ok: false, text: 'The description could not be saved to Notion. Try again.'});
}
// Duplicate 📈 Application Events are tidied automatically (src/notion/ledger.py heal): at the end of every job that
// writes events (Gmail/Calendar check, Telegram log, interview review, Focus answers), and at start-up (migrate.js).
// Only certain duplicates go (to the Notion trash, restorable 30 days); each removal is a line in logs/app.log.
export const TIDIED = /^Removed \d+ duplicate events? on /;
export async function tidyEvents(storage) {
  const {code, stdout} = await run(storage, ['src.notion.ledger', '--dedupe-events', '--auto']);
  if (code !== 0) throw new Error('could not read the events');
  return stdout.trim().split('\n').pop() || '';
}
// An email the Gmail check placed, or wasn't sure where to place: move it to a job ("new", "none" or a job URL).
export async function reassignEmail(storage, eventId, target) {
  const {stdout} = await run(storage, ['src.ai.reassign', 'move', eventId, target]);
  return lastJson(stdout, {ok: false, text: 'Notion could not be updated. Try again.'});
}
// A job's updates from the Gmail check, newest first (what "Undo an email update" lists).
export async function emailUpdates(storage, pageId) {
  const {stdout} = await run(storage, ['src.ai.reassign', 'list', pageId]);
  return lastJson(stdout, {ok: false, text: 'Notion could not be read. Try again.', items: []});
}
// Focus → "Did the interview happen?" (src/ai/interviews.py held | moved | cancelled, no AI).
export async function interviewHappened(storage, pageId, answer, {notes = '', at = ''} = {}) {
  if (!['held', 'moved', 'cancelled'].includes(answer)) return {ok: false, error: 'Unknown answer'};
  const args = ['src.ai.interviews', answer, pageId, ...(answer === 'held' && notes ? [`--notes=${notes}`] : []),
    ...(answer === 'moved' ? [`--at=${at}`] : [])];
  const {code, stdout} = await run(storage, args);
  const result = lastJson(stdout, {ok: false, error: 'Notion could not be updated. Try again.'});
  return {...result, ok: code === 0 && !!result.ok};
}
export async function feedbackAction(storage, pageId, action, text = '') {
  const {code, stdout} = await run(storage, ['src.feedback', pageId, action, ...(text ? ['--text', text] : [])]);
  try { const result = JSON.parse(stdout.trim().split('\n').pop()); return {...result, ok: code === 0 && result.ok}; }
  catch { return {ok: false, error: 'Feedback could not be saved to Notion. Try again.'}; }
}
// The reminder text (empty when nothing is worth interrupting for); send: also to Telegram.
export async function focusReminder(storage, send = false) {
  const {code, stdout} = await run(storage, ['src.focus', 'remind', ...(send ? ['--send'] : [])]);
  try { return code === 0 ? JSON.parse(stdout.trim().split('\n').pop()).text || '' : ''; } catch { return ''; }
}

// A session ended without a submission: the job goes back from Applying to Kit ready (in Notion first).
export async function unapply(storage, url) {
  const {stdout} = await run(storage, ['src.desktop', 'unapply', url]);
  return JSON.parse(stdout.trim().split('\n').pop() || '{"ok":false}');
}
export async function setStatus(storage, url, status) {
  const {stdout} = await run(storage, ['src.desktop', 'status', url, status]);
  return JSON.parse(stdout.trim().split('\n').pop() || '{}');
}
