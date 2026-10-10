#!/usr/bin/env node
// The journey gate (spec: docs/superpowers/specs/2026-10-10-application-journey.md, step 4): a push that touches a flow file (desktop/e2e/flows.mjs FLOW_FILES)
// runs the journey tests (JOURNEY_TESTS: the applying scenarios as event sequences, no browser, seconds) and is blocked when one fails. The area suites
// run only the tests that import a changed file, so an extension-only change never reached them. Called by tools/pre-push-check.sh.
// Usage: node tools/journey-gate.mjs [--base origin/main]. Exit 0: passed or nothing to check; 1: a journey test failed. Guard: desktop/test/journey-gate.test.js.
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function touchedFlowFiles(changed, flowFiles) {
  const flows = new Set(flowFiles);
  return changed.map(file => file.trim()).filter(file => flows.has(file) || /^desktop\/test\/(journeys|application-journey|journey-identity|extension-tab-identity)\.test\.js$/.test(file));
}

async function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  let changed = [];
  try { changed = execFileSync('git', ['-C', repo, 'diff', '--name-only', `${base}..HEAD`], {encoding: 'utf8'}).split('\n').filter(Boolean); } catch { return 0; }
  const {FLOW_FILES, JOURNEY_TESTS} = await import(path.join(repo, 'desktop/e2e/flows.mjs'));
  const touched = touchedFlowFiles(changed, FLOW_FILES);
  if (!touched.length) return 0;
  const desktop = path.join(repo, 'desktop');
  if (!fs.existsSync(path.join(desktop, 'shared'))) spawnSync('node', ['scripts/stage.mjs'], {cwd: desktop, stdio: 'ignore'});   // the app's lib imports shared/
  const started = Date.now();
  const run = spawnSync('node', ['--test', ...JOURNEY_TESTS], {cwd: desktop, encoding: 'utf8'});
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status === 0) { console.log(`journey gate: ${JOURNEY_TESTS.length} test files passed in ${seconds} s (flow files touched: ${touched.length})`); return 0; }
  const failures = String(run.stdout || '').split('\n').filter(line => /^not ok|^# fail/.test(line)).join('\n');
  console.error(`journey gate: a journey scenario failed (${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', …' : ''} changed):\n${failures}\nreproduce: cd desktop && node --test ${JOURNEY_TESTS.join(' ')}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
