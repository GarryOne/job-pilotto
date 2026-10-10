#!/usr/bin/env node
// `node e2e/ladder-digest-score.mjs`: a measurement of rung 3 on the ladder fixtures: does the numbered digest (lib/ladder/rung3-digest.js prompt + each fixture's `candidates`) answer the non-form pages right? The real model on the plan path
// (Claude Code; ANTHROPIC_API_KEY must be unset), one call per fixture whose page is not a form or an account. Rates per source, never blended; the wrong-and-confident list. Not a gate: the digest is not wired yet.
//   [--only <id>] [--ids a,b,c] [--tier small|main|big] [--json]
//   --real   only real pages (recorded + captured), none invented or reconstructed: the set the prompt may be judged on (owner's coordinator, 10 Oct 2026: no more tuning on invented fixtures)
//   --half tune|held|both   a fixed split by the sha1 of the id (even/odd first byte): `tune` prints per-fixture lines, `held` prints only counts (no ids) so a prompt is not tuned on it; `both` = tune detail + held counts
import {createHash} from 'node:crypto';
import {pickEngine} from './lib/engine.mjs';
import {loadFixtures} from './lib/ladder-fixtures.mjs';
import {SOURCE_GROUP, assertNoApiSpend} from './lib/ladder-score.mjs';
import {scoringClient} from './lib/ladder-score-path.mjs';
import {DIGEST_OUTCOME, digestRow, digestRowLine} from './lib/ladder-digest-row.mjs';
import {askDigest} from '../lib/ladder/rung3-digest.js';
import {model} from '../lib/ai/models.js';
import {pageSketch} from '../lib/page-kind.js';

const args = process.argv.slice(2), arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const engine = pickEngine({family: 'claude'});
assertNoApiSpend({env: process.env, engine});
const client = scoringClient();   // the app's own adapter, as the page-kind score (lib/ladder-score-path.mjs)
const halfOf = id => (createHash('sha1').update(id).digest()[0] % 2 === 0 ? 'tune' : 'held');
const wantHalf = arg('--half') || 'both';
// Start dialogs (expect.digest) are never asked the digest, so they are not measured here.
const fixtures = loadFixtures().filter(f => f.candidates && DIGEST_OUTCOME[f.expect.outcome] && !f.expect.digest && (!args.includes('--real') || ['recorded', 'captured'].includes(f.source))
  && (!arg('--only') || f.id === arg('--only')) && (!arg('--ids') || arg('--ids').split(',').includes(f.id)) && (wantHalf === 'both' || halfOf(f.id) === wantHalf));
const modelName = arg('--tier') ? model(arg('--tier')) : undefined;
const rows = [];
const lanes = Array.from({length: 4}, (_, lane) => fixtures.filter((_, index) => index % 4 === lane));
await Promise.all(lanes.map(async lane => { for (const f of lane) {
  const answer = await askDigest(client, pageSketch(f.sketch), f.candidates, modelName ? {model: modelName} : {});
  rows.push(digestRow(f, answer));
} }));
rows.sort((a, b) => a.id.localeCompare(b.id));
if (args.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
for (const r of rows) r.half = halfOf(r.id);
const pad = (text, width) => String(text).padEnd(width).slice(0, width);
console.log(`digest score (live, plan path, ${modelName || 'small tier'}), ${rows.length} fixtures with candidates`);
for (const r of rows.filter(r => r.half === 'tune')) console.log(digestRowLine(r));
const by = {};
const count = list => `${list.filter(r => r.status === 'hit').length}/${list.length} hit, ${list.filter(r => r.status === 'wrong-confident').length} wrong-and-confident`;
console.log(`tune half: ${count(rows.filter(r => r.half === 'tune'))}`);
console.log(`held-out half (counts only): ${count(rows.filter(r => r.half === 'held'))}`);
for (const r of rows) { const group = SOURCE_GROUP[r.source]; const e = by[group] ||= {total: 0, hits: 0}; e.total++; if (r.status === 'hit') e.hits++; }
console.log('Hit rate per source (never blended):');
for (const [group, e] of Object.entries(by)) console.log(`  ${pad(group, 14)} ${e.hits}/${e.total}`);
const wrong = rows.filter(r => r.status === 'wrong-confident' && r.half === 'tune');
console.log(`Wrong and confident (tune half only): ${wrong.length}`);
for (const r of wrong) console.log(`  ${r.id}: want ${r.expected}, got ${r.outcome} at ${r.confidence.toFixed(2)}`);
