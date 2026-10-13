#!/usr/bin/env node
// `npm run ladder-score -- --moves`: the next move, both ways, on the ladder fixtures that carry a confirmed expected move (spec 2026-10-12-one-next-move.md box 7; lib/ladder-move-score.mjs).
// Today: the stored rung-2 answer through the real pageKind (offline, deterministic). The fallback: the one question's digest (lib/ladder/rung3-digest.js) on the plan path (Claude Code,
// ANTHROPIC_API_KEY unset: $0), one call per fixture. Per source, never blended; dead ends (today stops) counted per source; the wrong-and-confident list.
//   [--offline] today only, no model   [--only <id>]   [--json]
import {pickEngine} from './lib/engine.mjs';
import {loadFixtures} from './lib/ladder-fixtures.mjs';
import {fallbackMove, summarizeMoves, todayMove} from './lib/ladder-move-score.mjs';
import {assertNoApiSpend, scoreFixtures} from './lib/ladder-score.mjs';
import {scoringClient} from './lib/ladder-score-path.mjs';
import {askDigest} from '../lib/ladder/rung3-digest.js';
import {pageSketch} from '../lib/page-kind.js';

const args = process.argv.slice(2), arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const offline = args.includes('--offline');
const fixtures = loadFixtures().filter(f => f.expect.verb && (!arg('--only') || f.id === arg('--only')));
const todayRows = new Map((await scoreFixtures(fixtures, {})).map(row => [row.id, row]));
let client = null;
if (!offline) { const engine = pickEngine({family: 'claude'}); assertNoApiSpend({env: process.env, engine}); client = scoringClient(); }
const rows = [];
const lanes = Array.from({length: 4}, (_, lane) => fixtures.filter((_, index) => index % 4 === lane));
await Promise.all(lanes.map(async lane => { for (const f of lane) {
  const stored = todayRows.get(f.id);
  const answer = client ? await askDigest(client, pageSketch(f.sketch), f.candidates) : null;
  rows.push({id: f.id, source: f.source, want: `${f.expect.verb} ${JSON.stringify(f.expect.candidates)}`, confirmed: `${f.expect.confirmed.by} ${f.expect.confirmed.run}`,
    today: stored.status === 'no-answer' ? 'no-answer' : todayMove(f, stored.button), button: stored.button || '',
    fallback: answer ? fallbackMove(f, answer) : '-', said: answer ? `${answer.error ? `error: ${answer.error}` : `${answer.verb} ${JSON.stringify(answer.numbers ?? [])}`} ${(answer.confidence ?? 0).toFixed(2)}` : ''});
} }));
rows.sort((a, b) => a.id.localeCompare(b.id));
const summary = summarizeMoves(rows.filter(row => row.today !== 'no-answer'));
if (args.includes('--json')) { console.log(JSON.stringify({rows, summary}, null, 1)); process.exit(0); }
const pad = (text, width) => String(text ?? '').padEnd(width).slice(0, width);
console.log(`ladder moves (${offline ? 'today only, offline' : 'both ways: today offline, the fallback live on the plan path'}), ${rows.length} fixtures with a confirmed move`);
console.log('today = the button rung 2 names (its stored answer through pageKind); the shared Apply phrases of rung 0 are not replayed here, so a "stop" may be pressed by them in a run');
console.log(`${pad('fixture', 40)} ${pad('source', 9)} ${pad('want', 12)} ${pad('today', 9)} ${pad('fallback', 15)} said`);
for (const row of rows) console.log(`${pad(row.id, 40)} ${pad(row.source, 9)} ${pad(row.want, 12)} ${pad(row.today, 9)} ${pad(row.fallback, 15)} ${row.said}`);
const counts = bucket => Object.entries(bucket).map(([key, n]) => `${key} ${n}`).join(', ') || '-';
console.log('\nPer source (never blended): fixtures, dead ends (today stops), today / the fallback alone / today with the fallback at its stops');
for (const [group, entry] of Object.entries(summary.bySource)) {
  console.log(`  ${pad(group, 14)} ${entry.fixtures} fixtures, ${entry.deadEnds} dead ends`);
  console.log(`    today:          ${counts(entry.today)}`);
  if (!offline) console.log(`    fallback alone: ${counts(entry.fallback)}\n    with fallback:  ${counts(entry.both)}`);
}
if (!offline) console.log(`Wrong and confident (the fallback would act on another control): ${summary.wrongConfident.length}${summary.wrongConfident.length ? `: ${summary.wrongConfident.join(', ')}` : ''}`);
