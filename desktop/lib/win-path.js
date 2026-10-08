// The PATH Windows has stored for this user and machine (the registry), not the one this app was started with.
// An app keeps the PATH it was launched with: a program installed after that (winget, npm with its own prefix, nvm)
// is on the registry's PATH at once but not on process.env.PATH until the app restarts, so "I installed it, it is not found".
// Guarded by test/win-path.test.js. Windows only: elsewhere it returns [] without running anything.
import {execFileSync} from 'node:child_process';

const KEYS = ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'];

// `reg query` output -> the directories of its Path value, with %NAME% filled in from env.
export function parseRegPath(output, env = process.env) {
  const lookup = name => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || '';
  const line = String(output).split(/\r?\n/).map(l => /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i.exec(l)).find(Boolean);
  return line ? line[1].split(';').map(dir => dir.trim().replace(/%([^%]+)%/g, (_, name) => lookup(name))).filter(Boolean) : [];
}

let cache = {at: 0, dirs: []};
export function registryPathDirs({env = process.env, platform = process.platform, run = execFileSync, now = Date.now} = {}) {
  if (platform !== 'win32') return [];
  if (now() - cache.at < 30000) return cache.dirs;   // claudeBinary is asked often; the registry changes rarely
  const dirs = KEYS.flatMap(key => {
    try { return parseRegPath(run('reg.exe', ['query', key, '/v', 'Path'], {encoding: 'utf8', timeout: 5000, windowsHide: true}), env); } catch { return []; }
  });
  cache = {at: now(), dirs};
  return dirs;
}
