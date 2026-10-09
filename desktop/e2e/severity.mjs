// The verdict pass's level on an issue already filed (ui-verdict.yml): node severity.mjs --file .heal/verdict.md --number N [--repo owner/name]
// Reads the verdict's `Severity:` line (lib/severity.mjs) and, when it differs from the issue's, rewrites the body's level (score() and the ranking read it) and the
// severity:<level> label. Prints what it did; no rating, or the same level: nothing changes.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FILED} from './lib/finder-scorecard.mjs';
import {judgedSeverity, severityOfBody, withSeverity} from './lib/severity.mjs';

const args = process.argv.slice(2), at = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const number = Number(at('--number')), repo = at('--repo') || process.env.REPO || '';
const raw = fs.existsSync(at('--file')) ? fs.readFileSync(at('--file'), 'utf8') : '';
const gh = rest => execFileSync('gh', [...rest, ...(repo ? ['--repo', repo] : [])], {encoding: 'utf8'});
if (!number || !raw) process.exit(0);
const issue = JSON.parse(gh(['issue', 'view', String(number), '--json', 'body,labels']));
const labels = issue.labels.map(label => label.name);
const of = prefix => labels.find(name => name.startsWith(prefix))?.slice(prefix.length) || '';
const was = severityOfBody(issue.body);
const now = judgedSeverity(raw, {source: of('source:'), kind: of('kind:')});
if (!now || now === was) { console.log(`#${number}: severity stays ${was || 'unset'}`); process.exit(0); }
// The filed level stays in the body (once), so the Finder's scorecard can count how often a judge changed it.
const body = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'severity-')), 'body.md');
fs.writeFileSync(body, withSeverity(issue.body, now) + (was && !FILED.test(issue.body) ? `\n<!-- severity-filed:${was} -->` : ''));
gh(['label', 'create', `severity:${now}`, '--force', '--color', now === 'high' ? 'D93F0B' : now === 'low' ? '0E8A16' : 'FBCA04']);
gh(['issue', 'edit', String(number), '--body-file', body, '--add-label', `severity:${now}`, ...(was ? ['--remove-label', `severity:${was}`] : [])]);
console.log(`#${number}: severity ${was || 'unset'} -> ${now} (the verdict pass)`);
