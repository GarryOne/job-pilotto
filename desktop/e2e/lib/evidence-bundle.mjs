// The evidence bundle of a smoke run: everything a fixer needs to name the blocker without a re-run (job-pilotto-cc's post-mortem, 11 Oct 2026: about 40% of every
// fix was a wrong first guess because the first run did not show what the AI was asked, what it answered and what was pressed). One folder per day and shape:
// evidence.md (the four lines that matter), run.log, app.log (the app's whole log) and ai-calls.json (the live page-kind calls and the form-answer calls: fields asked and answer kinds, desktop/lib/live-capture.js).
// Also: a run that was killed or cut short did not finish, and records and uploads nothing (eb's killed Datadog run left a 23 s row). Guard: test/evidence-bundle.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {slug} from './replay-candidate.mjs';

// The run's watch ended by itself (apply-live.mjs prints this line at the end of the watch): a killed or cut-short run never prints it.
export const runFinished = ({output = '', signal = null} = {}) => !signal && /live .{0,14}: watched \d+s; frames in/.test(output);

const CUT = 320, EACH = 8;
const cut = line => line.replace(/^\S+T(\d\d:\d\d:\d\d)\.\d+Z\s*/, '$1 ').replace(/\s+/g, ' ').trim().slice(0, CUT);
// Lines of OUR OWN app's log (never page words): what was asked (page kind, with frames and the digest flag), the digest's validated answer, what was pressed, where the page went.
const PAGE_KIND = /\[extension\] page kind:/, DIGEST = /\[extension\] digest:/;
const PRESSED = /\[extension\] fill: (pressed |closed a popup|no Apply button to press|after the press)/;   // words-ok: our own log's wording, not page text
const WENT_TO = /\[extension\] (fill: (no form on this page|account page|register control|watch ended|form frame)|can't reach the form|page kind: (account|form|account-form))/;   // words-ok: our own log's wording

// -> {pageKind, digest, pressed, wentTo}: each a list of at most EACH lines, cut and shown from their time.
export function evidenceLines(appLog) {
  const lines = String(appLog || '').split('\n'), pick = pattern => lines.filter(line => pattern.test(line)).map(cut).slice(0, EACH);
  return {pageKind: pick(PAGE_KIND), digest: pick(DIGEST), pressed: pick(PRESSED), wentTo: pick(WENT_TO)};
}

const section = (title, list) => `## ${title}\n${list.length ? list.map(line => `- ${line}`).join('\n') : '- (none in the app log)'}\n`;

// -> the folder. A part that is missing (no app log, no AI calls) is skipped, never an empty file.
export function writeBundle({dir, day, shape, output = '', appLog = '', aiCalls = '', result = {}}) {
  const folder = path.join(dir, day, slug(shape)), lines = evidenceLines(appLog);
  fs.mkdirSync(folder, {recursive: true});
  const step = `reached ${result.reached || 'none'}${result.filled != null ? `, ${result.filled} filled, ${result.left} left` : ''}`;
  const text = [`# ${shape}: ${day}`, '', `${step}. Files here: run.log (the run's output), app.log (the app's whole log), ai-calls.json (the page-kind asks and answers, and which fields the AI was asked to answer).`, '',
    section('Page kind (what was asked, with frames and the digest flag)', lines.pageKind), section('The digest\'s validated answer', lines.digest),
    section('What was pressed', lines.pressed), section('Where the page went', lines.wentTo)].join('\n');
  fs.writeFileSync(path.join(folder, 'evidence.md'), text);
  fs.writeFileSync(path.join(folder, 'run.log'), output);
  if (appLog) fs.writeFileSync(path.join(folder, 'app.log'), appLog);
  if (aiCalls) fs.writeFileSync(path.join(folder, 'ai-calls.json'), aiCalls);
  return folder;
}
