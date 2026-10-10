#!/usr/bin/env node
// `node e2e/ladder-digest-score.mjs`: a measurement of rung 3 on the ladder fixtures: does the numbered digest (lib/digest.js prompt + each fixture's `candidates`) answer the non-form pages right? The real model on the plan path
// (Claude Code; ANTHROPIC_API_KEY must be unset), one call per fixture whose page is not a form or an account. Rates per source, never blended; the wrong-and-confident list. Not a gate: the digest is not wired yet.
//   [--only <id>] [--ids a,b,c] [--tier small|main|big] [--json]
//   --real   only real pages (recorded + captured), none invented or reconstructed: the set the prompt may be judged on (owner's coordinator, 10 Oct 2026: no more tuning on invented fixtures)
//   --half tune|held|both   a fixed split by the sha1 of the id (even/odd first byte): `tune` prints per-fixture lines, `held` prints only counts (no ids) so a prompt is not tuned on it; `both` = tune detail + held counts
import {createHash} from 'node:crypto';
import {pickEngine} from './lib/engine.mjs';
import {loadFixtures} from './lib/ladder-fixtures.mjs';
import {SOURCE_GROUP, SURE, assertNoApiSpend} from './lib/ladder-score.mjs';
import {modelClient} from './lib/model.mjs';
import {askDigest} from '../lib/digest.js';
import {model} from '../lib/ai/models.js';
import {pageSketch} from '../lib/page-kind.js';

const args = process.argv.slice(2), arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
// What the digest should say for a ladder outcome (a posting with an Apply control is "form": press it).
const DIGEST_OUTCOME = {posting: ['form', 'link'], email: ['email'], phone: ['phone'], in_person: ['in_person'], expired: ['expired'], login_wall: ['login_wall'], other: ['other']};
const engine = pickEngine({family: 'claude'});
assertNoApiSpend({env: process.env, engine});
const client = modelClient({key: '', engine: () => engine});
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
  const want = DIGEST_OUTCOME[f.expect.outcome], hit = !answer.error && want.includes(answer.outcome);
  rows.push({id: f.id, source: f.source, trap: !!f.trap, expected: want[0], outcome: answer.error ? `error: ${answer.error}` : answer.outcome, verb: answer.verb, numbers: answer.numbers, confidence: answer.confidence ?? 0, dropped: answer.dropped,
    status: hit ? 'hit' : !answer.error && (answer.confidence ?? 0) >= SURE ? 'wrong-confident' : 'miss', chosen: (answer.chosen || []).map(item => `${item.n}:${item.kind}`)});
} }));
rows.sort((a, b) => a.id.localeCompare(b.id));
if (args.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
for (const r of rows) r.half = halfOf(r.id);
const pad = (text, width) => String(text).padEnd(width).slice(0, width);
console.log(`digest score (live, plan path, ${modelName || 'small tier'}), ${rows.length} fixtures with candidates`);
for (const r of rows.filter(r => r.half === 'tune' || wantHalf === 'held' && false)) console.log(`${pad(r.id, 36)} ${pad(r.source, 13)} want ${pad(r.expected, 10)} got ${pad(r.outcome, 10)} ${pad(r.verb || '-', 11)} ${pad(JSON.stringify(r.numbers || []), 8)} ${pad((r.confidence || 0).toFixed(2), 5)} ${r.status}${r.dropped ? ` (dropped: ${r.dropped})` : ''}${r.trap ? ' (trap)' : ''}`);
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
