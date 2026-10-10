#!/usr/bin/env node
// `npm run ladder-score`: how well the page-kind rungs decide on the ladder fixtures (e2e/ladder-fixtures). Prints per fixture expected vs got, the rung that decides today, hit rates PER SOURCE
// (real / reconstructed / invented, never one blended number), per rung, and the wrong-and-confident list.
//   (no flag)   the real model on the plan path (Claude Code; ANTHROPIC_API_KEY must be unset: no API spend), one call per fixture
//   --record    live, and write the model's answers into the fixtures as their stored answer (what --offline and the push gate replay)
//   --missing   (with --record) only the fixtures that have no stored answer yet, so a new fixture does not re-record the others
//   --offline   replay the stored answers through the real pageKind, no model: deterministic, seconds (the gate: test/ladder-ratchet.test.js)
//   --update-baseline "<why>"   (with --offline) rewrite e2e/ladder-baseline.json from this score and add the dated reason: the ratchet's only way to accept a change
//   --only <id> | --source <recorded|captured|reconstructed|invented> | --json
import fs from 'node:fs';
import path from 'node:path';
import {pickEngine} from './lib/engine.mjs';
import {BASELINE_FILE, nextBaseline, readBaseline} from './lib/ladder-baseline.mjs';
import {DIR, loadFixtures} from './lib/ladder-fixtures.mjs';
import {assertNoApiSpend, scoreFixtures, summarize} from './lib/ladder-score.mjs';
import {modelClient} from './lib/model.mjs';

const args = process.argv.slice(2), arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const offline = args.includes('--offline'), record = args.includes('--record');
let fixtures = loadFixtures();
if (arg('--only')) fixtures = fixtures.filter(f => f.id === arg('--only'));
if (arg('--source')) fixtures = fixtures.filter(f => f.source === arg('--source'));
if (args.includes('--missing')) fixtures = fixtures.filter(f => !f.answer);   // with --record: only the fixtures with no stored answer yet

let clientFor;
if (!offline) {
  const engine = pickEngine({family: 'claude'});
  assertNoApiSpend({env: process.env, engine});
  const client = modelClient({key: '', engine: () => engine});
  clientFor = () => client;
}
// Live: four calls at a time. Rows come back in fixture order.
const lanes = Array.from({length: offline ? 1 : 4}, (_, lane) => fixtures.filter((_, index) => index % (offline ? 1 : 4) === lane));
const rows = (await Promise.all(lanes.map(lane => scoreFixtures(lane, {clientFor})))).flat().sort((a, b) => a.id.localeCompare(b.id));

if (record) {
  for (const row of rows) if (row.answer?.kind) {
    const fixture = fixtures.find(f => f.id === row.id), {file, ...kept} = fixture;
    fs.writeFileSync(path.join(DIR, file), `${JSON.stringify({...kept, answer: row.answer}, null, 1)}\n`);
  }
}
if (arg('--update-baseline')) {
  if (!offline || arg('--only') || arg('--source')) { console.error('--update-baseline needs --offline and the whole set (no --only/--source)'); process.exit(1); }
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(nextBaseline(rows, readBaseline(), arg('--update-baseline')), null, 1)}\n`);
  console.log(`baseline written: ${rows.length} fixtures, reason "${arg('--update-baseline')}"`);
}
const summary = summarize(rows);
if (args.includes('--json')) { console.log(JSON.stringify({rows, summary}, null, 1)); process.exit(0); }

const pad = (text, width) => String(text).padEnd(width).slice(0, width);
console.log(`ladder-score (${offline ? 'offline: stored answers' : record ? 'live, recording answers' : 'live, plan path'}), ${rows.length} fixtures`);
console.log(`${pad('fixture', 36)} ${pad('source', 13)} ${pad('expected', 14)} ${pad('got', 8)} ${pad('conf', 5)} rung status`);
for (const row of rows) console.log(`${pad(row.id, 36)} ${pad(row.source, 13)} ${pad(row.expected, 14)} ${pad(row.outcome || '-', 8)} ${pad(row.confidence.toFixed(2), 5)} ${pad(row.rung, 4)} ${row.status}${row.trap ? '  (trap)' : ''}${row.digestOk === null ? '' : `  [digest ${row.digest || 'route only'}: ${row.digestOk ? 'as expected' : 'NOT as expected'}; route ${row.route || '-'}]`}`);
console.log('\nHit rate per source (never blended; "hit" = exact or accepted):');
for (const [source, entry] of Object.entries(summary.bySource)) console.log(`  ${pad(source, 14)} ${entry.hits}/${entry.total} hit, ${entry.exact} exact`);
console.log('Per rung that decides today (0 = structure rule after an unsure answer, 1 = kept answer, 2 = AI sketch):');
for (const [rung, entry] of Object.entries(summary.byRung).sort()) console.log(`  ${pad(rung, 14)} ${entry.hits}/${entry.total} hit`);
console.log(`Wrong and confident (answer >= 0.8, outside the accepted outcomes): ${summary.wrongConfident.length}`);
for (const row of summary.wrongConfident) console.log(`  ${row.id}: expected ${row.expected}, got ${row.outcome} at ${row.confidence.toFixed(2)}`);
if (summary.noAnswer.length) console.log(`No stored answer yet: ${summary.noAnswer.map(row => row.id).join(', ')} (run: npm run ladder-score -- --record)`);
