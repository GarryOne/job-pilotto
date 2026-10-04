// Writes .heal/body.md, the UI-fix pull request's text (lib/pr-body.mjs): node pr-body.mjs --number N --files "a b" [--dir .heal]. Needs gh and git; run from the repository root.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {prBody} from './lib/pr-body.mjs';

const args = process.argv.slice(2), at = name => args[args.indexOf(name) + 1];
const dir = args.includes('--dir') ? at('--dir') : '.heal', number = at('--number');
const files = String(at('--files') || '').split(/\s+/).filter(Boolean);
const run = (cmd, list) => { try { return execFileSync(cmd, list, {encoding: 'utf8'}); } catch { return ''; } };
const labels = (() => { try { return JSON.parse(run('gh', ['issue', 'view', number, '--json', 'labels'])).labels; } catch { return []; } })();
run('git', ['add', '-N', '--', ...files]);   // so a new test file shows in the numbers
let added = 0, removed = 0;
for (const line of run('git', ['diff', '--numstat', 'HEAD', '--', ...files]).split('\n')) { const [a, r] = line.split('\t'); added += Number(a) || 0; removed += Number(r) || 0; }
const text = fs.existsSync(path.join(dir, 'pr-body.md')) ? fs.readFileSync(path.join(dir, 'pr-body.md'), 'utf8').split('\n').slice(1).join('\n') : '';
const candidate = JSON.parse(fs.readFileSync(path.join(dir, 'candidate.json'), 'utf8'));
fs.writeFileSync(path.join(dir, 'body.md'), prBody({number, labels, text, shot: candidate.screenshot || '', files, added, removed, tests: files.filter(file => /^(tests\/|desktop\/test\/)/.test(file))}));
console.log(`${path.join(dir, 'body.md')}: ${files.length} file(s), +${added} -${removed}`);
