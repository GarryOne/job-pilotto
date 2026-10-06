// Pre-push check (tools/pre-push-check.sh): the words this push removes from the window's code that an end-to-end suite still expects (desktop/e2e/lib/stale-expectations.mjs).
//   node tools/stale-expectations.mjs [--base origin/main]      exit 1 and a list when a suite expects removed words
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {removedWords, staleExpectations, staleMessage, staleSelectors} from '../desktop/e2e/lib/stale-expectations.mjs';

const args = process.argv.slice(2), base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const git = (...command) => execFileSync('git', command, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
const top = git('rev-parse', '--show-toplevel').trim();
let diff = '';
try { diff = git('diff', '-U0', `${base}...HEAD`, '--', 'desktop/renderer'); } catch { process.exit(0); }   // no base (a shallow clone): nothing to compare
const removed = removedWords(diff);
if (!diff.trim()) process.exit(0);
const read = file => { try { return fs.readFileSync(path.join(top, file), 'utf8'); } catch { return ''; } };
const tracked = pattern => git('ls-files', '--', ...pattern).split('\n').filter(Boolean);
const present = [...tracked(['desktop/renderer', 'desktop/lib', 'src'])].map(read).join('\n');
const suites = [...tracked(['desktop/e2e/suites', 'desktop/e2e/lib'])].filter(file => /\.mjs$/.test(file) && !/stale-expectations/.test(file)).map(file => ({file, text: read(file)}));
const windowCode = tracked(['desktop/renderer']).map(read).join('\n');
const found = [...staleExpectations({removed, present, suites}), ...staleSelectors({diff, present: windowCode, suites})];
if (found.length) { console.error(staleMessage(found)); process.exit(1); }
