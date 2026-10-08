// Twin mode (JOB_PILOTTO_TWIN=1): a second copy of the app for live tests on the owner's real state (owner, 8 Oct 2026), started by
// desktop/e2e/twin.mjs on a clone of the app's folder whose Notion is the one-way "Job Pilotto – Live Test" mirror. It may read real websites
// and fill real forms (never Submit), but nothing it does reaches the owner's own app, Chrome windows, Telegram, schedules or real Notion:
// - its folder must not be the real one (JOB_PILOTTO_USER_DATA, checked at start: refused otherwise);
// - Notion: the mirror's token from JOB_PILOTTO_TWIN_NOTION_TOKEN, never a token found in the cloned secrets.json;
// - no Telegram polling, no schedules, no telemetry, no AppleScript on Chrome or Terminal (no Apply with Claude);
// - the engine sees no Keychain (src/secret_store.py isolated(): no Telegram bot, no Google sign-in).
// Guarded by desktop/test/twin.test.js.
import os from 'node:os';
import path from 'node:path';

export const isTwin = (env = process.env) => !!env.JOB_PILOTTO_TWIN;

// The owner's real folder (lib/storage.js: ~/Library/Application Support/Job Pilotto, or %APPDATA%\Job Pilotto).
// Built with that platform's own separators (path.win32 / path.posix), whatever OS runs it (CI ran the Mac case on Windows: backslashes).
export const realFolder = (home = os.homedir(), platform = process.platform, env = process.env) => (platform === 'win32'
  ? path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Job Pilotto')
  : path.posix.join(home, 'Library', 'Application Support', 'Job Pilotto'));

// Why this twin may not start, or '' when it may: it needs its own folder and the mirror's token.
export function twinRefusal(env = process.env, real = realFolder()) {
  if (!isTwin(env)) return '';
  const folder = env.JOB_PILOTTO_USER_DATA ? path.resolve(env.JOB_PILOTTO_USER_DATA) : '';
  if (!folder) return 'no JOB_PILOTTO_USER_DATA: a twin never runs on the real folder';
  if (folder === path.resolve(real)) return 'JOB_PILOTTO_USER_DATA is the real folder';
  if (!env.JOB_PILOTTO_TWIN_NOTION_TOKEN) return 'no JOB_PILOTTO_TWIN_NOTION_TOKEN (the Live Test mirror\'s token)';
  return '';
}

// A secret the twin takes from its environment instead of secrets.json: only the Notion token. null: read it as usual.
export const twinSecret = (name, env = process.env) => (isTwin(env) && name === 'NOTION_TOKEN' ? String(env.JOB_PILOTTO_TWIN_NOTION_TOKEN || '') : null);
