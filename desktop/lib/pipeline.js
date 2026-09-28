// Runs the existing Python pipeline (src/) for this user: their folder, their keys, their models.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {cadence} from './cadence.js';
import {ROOT} from './root.js';

export const REPO = ROOT;
export const MODELS = {enrich: 'claude-haiku-4-5', score: 'claude-sonnet-5', kit: 'claude-sonnet-5', insight: 'claude-sonnet-5'};
const DEFAULT_CONFIG = ['search.json', 'preferences.json', 'sources.json', 'scout_seeds.json'];

// The packaged app's own Python (with the anthropic package), else the repo's virtualenv, else python3.
export function python() {
  for (const candidate of [path.join(REPO, 'python', 'bin', 'python3'), path.join(REPO, '.venv', 'bin', 'python')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'python3';
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
const SYSTEM = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SSL_CERT_FILE'];

export function pipelineEnv(storage, parent = process.env) {
  const settings = storage.settings();
  const env = {
    ...Object.fromEntries(SYSTEM.filter(name => parent[name]).map(name => [name, parent[name]])),
    PYTHONUNBUFFERED: '1',
    JOB_PILOTTO_NO_DOTENV: '1',
    JOB_PILOTTO_SOURCE: 'Job Pilotto app',  // the Source of Applications rows the app creates
    JOB_PILOTTO_CONFIG_DIR: storage.path('config'),
    JOB_PILOTTO_DATA_DIR: storage.path('data'),
    JOB_PILOTTO_CV_PATH: storage.path('cv.pdf'),
  };
  // With Notion connected, the Profile and standard answers are read from Notion (the user edits them
  // there); the local files are only for running without Notion.
  if (!storage.secret('NOTION_TOKEN')) {
    env.JOB_PILOTTO_PROFILE_FILE = storage.path('profile.md');
    env.JOB_PILOTTO_ANSWERS_FILE = storage.path('answers.md');
  }
  for (const name of ['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY']) {
    const value = storage.secret(name);
    if (value) env[name] = value;
  }
  if (env.ANTHROPIC_API_KEY) {
    env.JOB_PILOTTO_ENRICH_MODEL = MODELS.enrich;
    env.JOB_PILOTTO_SCORE_MODEL = MODELS.score;
    env.JOB_PILOTTO_KIT_MODEL = MODELS.kit;
    env.JOB_PILOTTO_INSIGHT_MODEL = MODELS.insight;
    env.JOB_PILOTTO_MAIL_MODEL = MODELS.enrich;
  }
  if (settings.telegramChatId) env.TELEGRAM_CHAT_ID = String(settings.telegramChatId);
  for (const [key, value] of Object.entries(settings.notionIds || {})) if (value) env[key] = value;
  return env;
}

// Run `python -m <args>` in the repo; resolve with {code, stdout}; each output line goes to onLine.
export function run(storage, args, onLine = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python(), ['-m', ...args], {cwd: REPO, env: pipelineEnv(storage)});
    let stdout = '', buffer = '';
    const lines = chunk => {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop();
      parts.filter(Boolean).forEach(onLine);
    };
    child.stdout.on('data', data => { stdout += data; lines(String(data)); });
    child.stderr.on('data', data => lines(String(data)));
    child.on('error', reject);
    child.on('close', code => { if (buffer) onLine(buffer); resolve({code, stdout}); });
  });
}

export async function jobs(storage) {
  const {code, stdout} = await run(storage, ['src.desktop', 'jobs']);
  if (code !== 0) throw new Error('Could not read the job list');
  return JSON.parse(stdout.trim().split('\n').pop());
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
  const args = ['src', 'daily', '--mode', mode, ...(telegram ? ['--send'] : [])];
  if (inputs.job) args.push('--job', String(inputs.job), '--action', String(inputs.action || 'applied'));
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
export function runs(storage) { try { return JSON.parse(storage.readText('runs.json')) || []; } catch { return []; } }
let current = null;
export const running = () => current;

export function refresh(storage, onLine, mode = 'run', trigger = 'you') {
  return tracked(storage, 'search', trigger, onLine, tee => searchOnce(storage, tee, mode), record => {
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
  return ['src.ai.mail', '--days', String(days), ...(telegram ? ['--send'] : [])];
}
export function checkMail(storage, onLine, trigger = 'you') {
  let off = false;
  return tracked(storage, 'mail', trigger, onLine, async tee => {
    const {code, stdout} = await run(storage, mailArgs(storage), tee);
    off = /Gmail \+ Calendar is off/.test(stdout);
    // lastMailAt paces the schedule (a failed or "not connected" check waits for the next time too);
    // lastMailOkAt sets how far back the next check looks.
    const at = new Date().toISOString();
    storage.saveSettings({lastMailAt: at, ...(code === 0 && !off ? {lastMailOkAt: at} : {})});
    return {ok: code === 0};
  }, (record, log) => {
    const start = log.indexOf('Updates:');
    const updates = start < 0 ? [] : log.slice(start + 1).filter(line => /^\S/.test(line) && !/^Mail: /.test(line));
    return {off, updates, summary: log.filter(line => /^Mail: /.test(line)).pop() || null};
  });
}

// One tracked task (a search or a Gmail check): `running()` shows it while it runs, and it's kept in
// runs.json afterwards (kind, trigger, times, ok, log and what summarize() adds) for the activity bar.
function tracked(storage, kind, trigger, onLine, work, summarize) {
  return serial(async () => {
    const log = [];
    const record = {id: Date.now(), kind, trigger, startedAt: new Date().toISOString()};
    current = {...record, step: 'Starting'};
    const tee = line => {
      log.push(line);
      if (!/^\s|^Warning/.test(line) && line.length < 120) current = {...current, step: line};
      onLine(line);
    };
    let ok = false;
    try {
      ok = (await work(tee)).ok;
    } catch (error) {
      tee(`${kind === 'mail' ? 'Gmail check' : 'Search'} failed: ${error.message}`);
    } finally {
      Object.assign(record, {endedAt: new Date().toISOString(), ok, log: log.slice(-400), ...summarize(record, log)});
      storage.writeText('runs.json', JSON.stringify([record, ...runs(storage)].slice(0, RUN_HISTORY)));
      current = null;
    }
    return {ok, run: record};
  });
}

function searchOnce(storage, onLine, mode) {
  return (async () => {
    const ai = !!storage.secret('ANTHROPIC_API_KEY');
    onLine('Searching job boards (jobs.ch, TechTree)…');
    await run(storage, ['src', 'discover', '--pages', '1', '--max-companies', '40'], onLine);
    onLine('Checking employer career pages' + (ai ? ', then reading and scoring new jobs…' : '…'));
    const {code} = await run(storage, dailyArgs(storage, {mode}), onLine);
    storage.saveSettings({lastSearchAt: new Date().toISOString(), lastSearchOk: code === 0});
    return {ok: code === 0};
  })();
}

export async function setStatus(storage, url, status) {
  const {stdout} = await run(storage, ['src.desktop', 'status', url, status]);
  return JSON.parse(stdout.trim().split('\n').pop() || '{}');
}
