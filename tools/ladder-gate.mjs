#!/usr/bin/env node
// The ladder gate (docs/flows/ladder.md): a push that touches a flow file, the page-kind decision, a ladder fixture, the baseline or the scorer replays every fixture offline (stored answers through
// the real pageKind, no model, seconds) and is blocked when one got WORSE than desktop/e2e/ladder-baseline.json. Called by tools/pre-push-check.sh, beside the journey gate.
// Usage: node tools/ladder-gate.mjs [--base origin/main]. Exit 0: passed or nothing to check; 1: a fixture got worse. Guard: desktop/test/ladder-gate.test.js.
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWN = /^desktop\/(e2e\/ladder-fixtures\/|e2e\/ladder-baseline\.json$|e2e\/lib\/ladder-|lib\/(page-kind|account-judge|form-judge)\.js$|lib\/ladder\/|test\/ladder-ratchet\.test\.js$)/;

export const touchedLadderFiles = (changed, flowFiles) => { const flows = new Set(flowFiles); return changed.map(file => file.trim()).filter(file => flows.has(file) || OWN.test(file)); };

async function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  let changed = [];
  try { changed = execFileSync('git', ['-C', repo, 'diff', '--name-only', `${base}..HEAD`], {encoding: 'utf8'}).split('\n').filter(Boolean); } catch { return 0; }
  const {FLOW_FILES} = await import(path.join(repo, 'desktop/e2e/flows.mjs'));
  const touched = touchedLadderFiles(changed, FLOW_FILES);
  if (!touched.length) return 0;
  const desktop = path.join(repo, 'desktop');
  if (!fs.existsSync(path.join(desktop, 'shared'))) spawnSync('node', ['scripts/stage.mjs'], {cwd: desktop, stdio: 'ignore'});   // the app's lib imports shared/
  const started = Date.now();
  const run = spawnSync('node', ['--test', 'test/ladder-ratchet.test.js'], {cwd: desktop, encoding: 'utf8'});
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status === 0) { console.log(`ladder gate: every fixture is no worse than the baseline (${seconds} s; touched: ${touched.length})`); return 0; }
  const failures = String(run.stdout || '').split('\n').filter(line => /^not ok|^\s+(\+|-) |^\s+0: /.test(line)).join('\n');
  console.error(`ladder gate: a page decision got worse than the baseline (${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', …' : ''} changed):\n${failures}\nreproduce: cd desktop && npm run ladder-score -- --offline\nif on purpose: npm run ladder-score -- --offline --update-baseline "<why>" (docs/flows/ladder.md)`);
  return 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
