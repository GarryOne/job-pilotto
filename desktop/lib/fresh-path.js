// Windows: the PATH an installer just changed. A running app keeps the PATH it started with, so a CLI installed meanwhile (Codex, Claude Code) is invisible until restart; this reads the registry's PATH again.
import {execFile} from 'node:child_process';

const KEYS = [['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path'], ['HKCU\\Environment', 'Path']];

// "    Path    REG_EXPAND_SZ    C:\a;%USERPROFILE%\b" -> "C:\a;C:\Users\me\b"
export function parseRegPath(stdout, env = process.env) {
  const line = String(stdout || '').split(/\r?\n/).find(row => /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+/i.test(row));
  if (!line) return '';
  const value = line.replace(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+/i, '').trim();
  return value.replace(/%([^%]+)%/g, (whole, name) => env[Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase())] ?? whole);
}

// Adds to env.PATH the registry folders it lacks (never removes one). Returns true when it added any. No-op off Windows.
export async function refreshPath({env = process.env, platform = process.platform, run = execFile} = {}) {
  if (platform !== 'win32') return false;
  const found = [];
  for (const [key, name] of KEYS) {
    const stdout = await new Promise(resolve => {
      try { run('reg', ['query', key, '/v', name], {timeout: 5000, windowsHide: true}, (error, out) => resolve(error ? '' : out)); } catch { resolve(''); }
    });
    found.push(...parseRegPath(stdout, env).split(';').filter(Boolean));
  }
  const have = new Set(String(env.PATH || '').split(';').map(dir => dir.toLowerCase()));
  const added = [...new Set(found)].filter(dir => !have.has(dir.toLowerCase()));
  if (added.length) env.PATH = [env.PATH, ...added].filter(Boolean).join(';');
  return added.length > 0;
}
