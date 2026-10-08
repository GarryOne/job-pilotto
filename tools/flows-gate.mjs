// Pre-push check (tools/pre-push-check.sh): a push that changes the flows' decision core (desktop/e2e/flows.mjs FLOW_CORE) must have passed
// the whole scenario matrix on exactly that code (npm run flows → desktop/e2e/artifacts/flows-pass.json), or say why not in a commit
// ("Flows-unverified: <why>"). Owner, 8 Oct 2026: a fix for one flow (account creation) must never quietly break another (the form).
// Other flow files are not gated (owner, same day: the matrix ran on nearly every push): their area's suites run, and the best-fit method.
//   node tools/flows-gate.mjs [--base origin/main]      exit 1 with what to do
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {FLOW_CORE, flowDigest} from '../desktop/e2e/flows.mjs';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});
const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const touched = changed.filter(file => FLOW_CORE.includes(file));
if (!touched.length) process.exit(0);
const messages = git('log', '--format=%B%x00', `${base}..HEAD`);
if (/^Flows-unverified: \S/m.test(messages)) process.exit(0);
const atHead = file => { try { return git('show', `HEAD:${file}`); } catch { return null; } };
const digest = flowDigest(atHead);
const record = path.join(root, 'desktop/e2e/artifacts/flows-pass.json');
let passed = null;
try { passed = JSON.parse(fs.readFileSync(record, 'utf8')); } catch { /* never run here */ }
if (passed?.digest === digest) process.exit(0);
console.log(`this push changes the flows' decision core (${touched.join(', ')}): run the whole scenario matrix on it first, \`cd desktop && npm run flows\`` +
  ` (docs/flows/applying.md; ${passed ? `the last pass was for other code, ${passed.digest} ≠ ${digest}` : 'no pass recorded here'}),` +
  ' or put "Flows-unverified: <why>" in the commit message.');
process.exit(1);
