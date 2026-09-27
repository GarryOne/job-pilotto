// Runs the existing Python pipeline (src/) for this user: their folder, their keys, their models.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const MODELS = {enrich: 'claude-haiku-4-5', score: 'claude-sonnet-5', kit: 'claude-sonnet-5'};
const DEFAULT_CONFIG = ['search.json', 'preferences.json', 'sources.json', 'scout_seeds.json'];

// The repo's virtualenv has the anthropic package; otherwise the system python3.
export function python() {
  const venv = path.join(REPO, '.venv', 'bin', 'python');
  return fs.existsSync(venv) ? venv : 'python3';
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

// Find new jobs: job boards, then employer feeds + Google Jobs, then AI facts and fit scores
// when an Anthropic key is set. Messages go to onLine as the pipeline prints them.
export async function refresh(storage, onLine) {
  const ai = !!storage.secret('ANTHROPIC_API_KEY');
  onLine('Searching job boards (jobs.ch, TechTree)…');
  await run(storage, ['src', 'discover', '--pages', '1', '--max-companies', '40'], onLine);
  onLine('Checking employer career pages' + (ai ? ', then reading and scoring new jobs…' : '…'));
  const args = ['src', 'daily', '--mode', 'run', ...(ai ? ['--enrich-max', '100', '--score-max', '60'] : [])];
  const {code} = await run(storage, args, onLine);
  return {ok: code === 0};
}

export async function setStatus(storage, url, status) {
  const {stdout} = await run(storage, ['src.desktop', 'status', url, status]);
  return JSON.parse(stdout.trim().split('\n').pop() || '{}');
}
