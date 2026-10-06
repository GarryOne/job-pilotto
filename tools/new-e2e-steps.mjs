// Pre-push check (tools/pre-push-check.sh): every e2e step this push adds was seen passing, or the commit says why not (desktop/e2e/lib/new-steps.mjs).
//   node tools/new-e2e-steps.mjs [--base origin/main]      exit 1 and the list when a new step has no proof
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {addedTitles, unproven, unprovenMessage} from '../desktop/e2e/lib/new-steps.mjs';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});
const SPEC = ['desktop/e2e/suites', 'desktop/e2e/lib'];

const diff = git('diff', '-U0', `${base}...HEAD`, '--', ...SPEC);
if (!diff.trim()) process.exit(0);
const baseSource = git('ls-tree', '-r', '--name-only', base, '--', ...SPEC).split('\n').filter(file => file.endsWith('.mjs'))
  .map(file => { try { return git('show', `${base}:${file}`); } catch { return ''; } }).join('\n');
const titles = addedTitles(diff, baseSource);
if (!titles.length) process.exit(0);
const artifacts = path.join(root, 'desktop/e2e/artifacts');
const replays = fs.existsSync(artifacts) ? fs.readdirSync(artifacts).map(suite => path.join(artifacts, suite, 'replay.json')).filter(file => fs.existsSync(file))
  .map(file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }) : [];
const messages = git('log', '--format=%B%x00', `${base}..HEAD`).split('\0');
const missing = unproven(titles, {replays, messages});
if (missing.length) { console.log(unprovenMessage(missing)); process.exit(1); }
