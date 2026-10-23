// Report-only PR check: which e2e suites quote UI text this PR removes (lib/pr-suites.mjs). Prints a table for the job summary; always exits 0 (owner, 24 Oct 2026: report-only for 2 weeks).
//   node pr-suites.mjs --base origin/main
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {removedStrings, suitesExpecting, report} from './lib/pr-suites.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv[process.argv.indexOf('--base') + 1] || 'origin/main';
const git = args => execFileSync('git', args, {cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
try {
  const changedFiles = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
  const strings = removedStrings(git(['diff', '-U0', `${base}...HEAD`, '--', '../']));
  const sources = {};
  for (const dir of ['suites', 'lib']) for (const name of fs.readdirSync(path.join(here, dir))) if (name.endsWith('.mjs')) sources[`${dir}/${name}`] = fs.readFileSync(path.join(here, dir, name), 'utf8');
  const out = report({strings, hits: suitesExpecting(strings, sources), changedFiles, sources});
  console.log(out.text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### E2E suites that quote removed UI text (report only)\n\n${out.text}\n`);
} catch (error) {
  console.log(`pr-suites: could not read the diff (${error.message.split('\n')[0]}); nothing reported`);
}
