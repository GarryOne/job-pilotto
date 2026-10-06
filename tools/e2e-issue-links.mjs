// Pre-push check (tools/pre-push-check.sh): a push that changes an e2e suite names its open failed-step issues (desktop/e2e/lib/issue-links.mjs).
//   node tools/e2e-issue-links.mjs [--base origin/main]      exit 1 and the list when one is not named; no gh or no network: skipped (exit 0)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {openFailures, suitesOf, unnamed, unnamedMessage} from '../desktop/e2e/lib/issue-links.mjs';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});

const files = git('diff', '--name-only', `${base}...HEAD`, '--', 'desktop/e2e/suites', 'desktop/e2e/lib').split('\n').filter(Boolean);
if (!files.length) process.exit(0);
const dir = path.join(root, 'desktop/e2e/suites');
const suites = Object.fromEntries(fs.readdirSync(dir).filter(file => file.endsWith('.mjs')).map(file => [file.slice(0, -4), fs.readFileSync(path.join(dir, file), 'utf8')]));
const touched = suitesOf(files, suites);
if (!touched.length) process.exit(0);
let issues;
try {
  issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--label', 'auto-ui', '--label', 'kind:test-failure', '--state', 'open', '--limit', '100', '--json', 'number,title,labels'],
    {cwd: root, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore']}));
} catch { process.exit(0); }   // no gh, no network: never block on the lookup
const missing = unnamed(openFailures(issues, touched), git('log', '--format=%B%x00', `${base}..HEAD`).split('\0'));
if (missing.length) { console.log(unnamedMessage(missing)); process.exit(1); }
