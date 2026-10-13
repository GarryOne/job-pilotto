#!/usr/bin/env node
// `node e2e/ladder-label-moves.mjs <evidence root>...`: gives the ladder fixtures an expected MOVE only from what a run confirmed (spec 2026-10-12-one-next-move.md box 7): a pool run that
// pressed a listed control on the fixture's page and then reached a form (lib/ladder-move-labels.mjs). Roots: the pool's evidence folders (a CI pool artifact's smoke-reports/, the Mac's
// QA smoke-reports/), read-only. Prints the labels and the presses no candidate carries (the list lacked the control: a blind-spot finding); --write stores the labels in the fixtures'
// expect (verb, candidates, confirmed). A fixture that already has a move keeps it unless --force. Never a label by hand: a fixture's move says which run confirmed it.
import fs from 'node:fs';
import path from 'node:path';
import {DIR, loadFixtures} from './lib/ladder-fixtures.mjs';
import {confirmedPresses, evidenceDirs, labelMoves, runName} from './lib/ladder-move-labels.mjs';

const args = process.argv.slice(2), roots = args.filter(item => !item.startsWith('--'));
if (!roots.length) { console.error('usage: node e2e/ladder-label-moves.mjs <evidence root>... [--write] [--force]'); process.exit(2); }
const fixtures = loadFixtures();
const runs = evidenceDirs(roots).map(dir => ({run: runName(dir), presses: confirmedPresses(dir)})).filter(item => item.presses.length);
const {labels, unlisted} = labelMoves(fixtures, runs);
console.log(`${runs.length} runs with a press that reached a form; ${labels.length} fixtures labelled, ${unlisted.length} presses on a fixture's page that no candidate lists`);
for (const label of labels) console.log(`  ${label.id.padEnd(40)} press ${JSON.stringify(label.candidates).padEnd(8)} confirmed by ${label.confirmed.by} ${label.confirmed.run} ${label.confirmed.version}`);
if (unlisted.length) console.log('Pressed, then a form, but not in the numbered list (a blind spot to confirm with the picture):');
for (const item of unlisted) console.log(`  ${item.id.padEnd(40)} "${item.label}" (${item.run})`);
if (!args.includes('--write')) { console.log('(dry run: --write stores the labels)'); process.exit(0); }
let written = 0;
for (const label of labels) {
  const fixture = fixtures.find(item => item.id === label.id), {file, ...kept} = fixture;
  if (kept.expect.verb && !args.includes('--force')) continue;
  const expect = {...kept.expect, verb: label.verb, candidates: label.candidates, confirmed: label.confirmed};
  fs.writeFileSync(path.join(DIR, file), `${JSON.stringify({...kept, expect}, null, 1)}\n`);
  written++;
}
console.log(`${written} fixtures written`);
