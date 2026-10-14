// What "Confirmed offline" reads from the pool's recordings and from git (verify-plan.mjs): every record of each row (not only the newest), the live outcome in its app log,
// and the main commits with the extension versions they stamped, so a recording's build can be found (lib/verify-judge.mjs buildOf). Guard: e2e/test/verify-records.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {outputOfLog, parseLive} from './smoke.mjs';

const json = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// Every record of every row, oldest first: {name, dir, startMs, at, log, outcome (the live run's: reached, filled, left)}. byUrl: pool row by posting address, as replay-records.mjs newestPerRow.
export function recordsByRow(root, byUrl = new Map()) {
  const rows = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const here = path.join(dir, entry.name), record = json(path.join(here, 'record.json'));
      if (!record) { walk(here); continue; }
      let log = ''; try { log = fs.readFileSync(path.join(here, 'app.log'), 'utf8'); } catch { /* an old record has none */ }
      const first = record.entries?.find(item => item.type === 'document')?.url || record.url, live = log.trim() ? parseLive(outputOfLog(log, first)) : null;
      const name = record.name || byUrl.get(String(record.url || '').split('#')[0]) || new URL(record.url).host;
      if (!rows.has(name)) rows.set(name, []);
      rows.get(name).push({name, dir: here, rel: path.relative(root, here), startMs: record.startMs, at: new Date(record.startMs).toISOString(), log, outcome: live ? {reached: live.reached, filled: live.filled, left: live.left} : null});
    }
  };
  walk(root);
  for (const list of rows.values()) list.sort((a, b) => a.startMs - b.startMs);
  return rows;
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const defaultGit = (...args) => execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20});

// The main commits {hash, at} oldest first, and the extension versions {version, hash, at}: the base of the manifest, then the count of commits that changed extension/ (desktop/scripts/extension-stamp.mjs).
export function mainHistory(git = defaultGit, ref = 'HEAD') {
  const lines = out => out.split('\n').filter(Boolean).map(line => { const [hash, at] = line.split(' '); return {hash, at}; });
  const commits = lines(git('log', '--reverse', '--format=%H %cI', ref)), changed = lines(git('log', '--reverse', '--format=%H %cI', ref, '--', 'extension'));
  let base = '0.9'; try { base = JSON.parse(git('show', `${ref}:extension/manifest.json`)).version.match(/^\d+\.\d+/)[0]; } catch { /* keep the base */ }
  return {commits, versions: changed.map((item, index) => ({version: `${base}.${index + 1}`, ...item}))};
}
