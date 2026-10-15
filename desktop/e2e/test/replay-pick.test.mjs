// The PR replay gate's pick (replay-pick.mjs) and its workflow (owner, 14 Oct 2026: at most 10 rows, the quickest, diverse, in 2-3 min, report only, $0).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {GROUPS, MAX, kindOf, pickPinned, pickRows, pickedCount, split, startHosts} from '../replay-pick.mjs';
import {load, pinned} from '../lib/replay-ratchet.mjs';

const row = (seconds, site, same = true) => ({same, seconds, site});

test('only rows 100% same as live in the baseline, quickest first, one per site before a second, at most MAX', () => {
  const baseline = {rows: {a: row(80, 'x.io'), b: row(40, 'x.io'), c: row(60, 'y.io'), d: row(30, 'z.io', false), e: row(null, 'w.io')}};
  assert.deepEqual(pickRows(baseline), ['b', 'c', 'e', 'a']);
  const many = {rows: Object.fromEntries(Array.from({length: 30}, (_, i) => [`r${i}`, row(i, `s${i}.io`)]))};
  assert.equal(pickRows(many).length, MAX);
  assert.deepEqual(pickRows({}), [], 'no baseline: nothing (never an uncounted row that cannot be judged)');
});

test('the rows spread over at most 4 runners, 3 rows each when 12 are picked', () => {
  assert.equal(GROUPS, 4);
  assert.equal(split(Array.from({length: MAX}, (_, i) => `r${i}`)).length, 4);
  assert.deepEqual(split(Array.from({length: MAX}, (_, i) => `r${i}`)).map(group => group.length), [3, 3, 3, 3]);
  assert.deepEqual(split(['a', 'b']), [['a'], ['b']]);
  assert.deepEqual(split([]), []);
});

const hosts = new Map([['G1', 'boards.greenhouse.io'], ['G2', 'job-boards.eu.greenhouse.io'], ['R1', 'x.recruitee.com'], ['C1', 'www.one.example'], ['C2', 'www.two.example']]);

test('a PR picks ONE row per kind of form: the platform, or its own name for a site on no platform; the quickest of a kind; at most MAX kinds', () => {
  assert.equal(kindOf('G1', hosts), 'Greenhouse');
  assert.equal(kindOf('G2', hosts), 'Greenhouse');
  assert.equal(kindOf('C1', hosts), 'C1', 'a custom site is its own kind');
  assert.equal(kindOf('not in the pool', hosts), 'not in the pool');
  const names = ['G1', 'G2', 'R1', 'C1', 'C2'];
  assert.deepEqual(pickPinned(names, {seconds: {G1: 90, G2: 40, R1: 70, C1: 60, C2: 50}, hosts}), ['G2', 'C2', 'C1', 'R1'], 'the quickest Greenhouse row; kinds quickest first');
  const many = Array.from({length: 20}, (_, i) => `c${i}`);
  assert.equal(pickPinned(many, {hosts: new Map()}).length, MAX);
  assert.equal(pickedCount(names, hosts), 4);
  assert.equal(pickedCount(many, new Map()), MAX);
});

test('on the real pinned rows no two picked rows share a kind while a kind goes unpicked, and the workflow name says k of n', () => {
  const pins = pinned(load()), pool = startHosts(), picked = pickPinned(pins, {hosts: pool}), kinds = new Set(pins.map(name => kindOf(name, pool)));
  const pickedKinds = picked.map(name => kindOf(name, pool));
  assert.equal(new Set(pickedKinds).size, pickedKinds.length, 'two picked rows share a kind');
  assert.equal(picked.length, Math.min(MAX, kinds.size), 'a kind goes unpicked while the cap is not reached');
  assert.ok(picked.every(name => pins.includes(name)));
  const flow = fs.readFileSync(new URL('../../../.github/workflows/site-replays-pr.yml', import.meta.url), 'utf8');
  assert.match(flow, new RegExp(`^name: CI · Site replays · PR \\(${pickedCount(pins, pool)} of ${pins.length} pinned rows\\)$`, 'm'), 'the name says k of n: update it in the same PR as a pin');
});

test('the PR workflow: starts for the apply flow\'s code and the replay machinery (GitHub paths), red when worse or unfinished, no AI key', () => {
  const flow = fs.readFileSync(new URL('../../../.github/workflows/site-replays-pr.yml', import.meta.url), 'utf8');
  for (const entry of ['desktop/lib/**', 'extension/**', 'desktop/e2e/lib/net-record.mjs', 'desktop/e2e/replay-gate.mjs']) assert.ok(flow.includes(`      - '${entry}'\n`), `owner, 14 Oct 2026: ${entry} starts the PR replays`);
  assert.doesNotMatch(flow, /- 'desktop\/e2e\/\*\*'/, 'never the whole harness');
  assert.doesNotMatch(flow, /ci-needed/, 'no shared pick');
  assert.match(flow, /name: site replays gate/);
  assert.doesNotMatch(flow, /runs-on: macos/, 'the PR gate runs on Linux (15 Oct 2026: Mac and Linux agree on every row same as live; Linux has 20 slots, macOS 5)');
  assert.match(flow, /install --with-deps chromium/, 'Linux needs the browser\'s system libraries');
  assert.match(flow, /a replay runner did not finish/);
  assert.match(flow, /a counted row got worse/);
  assert.match(flow, /JP_REPLAY_ONLY: \$\{\{ matrix\.group \}\}/);
  assert.doesNotMatch(flow, /LATENCY_PAD|replay-late/, 'the late-answer pass runs on the scheduled runs only (owner, 15 Oct 2026)');
  const scheduled = fs.readFileSync(new URL('../../../.github/workflows/site-replays.yml', import.meta.url), 'utf8');
  assert.match(scheduled, /LATENCY_PAD_MS: '4000'/);
  assert.match(scheduled, /late answers lost: /, 'a row that lost the answers is named in the alert');
  assert.match(scheduled, /code=1; echo "### Late answers/, 'and the run is red like a drop');
  assert.doesNotMatch(flow, /ANTHROPIC|OPENAI|claude -p|secrets: inherit/);
  const settings = fs.readFileSync(new URL('../../../tools/pr-settings.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /replay\\ gate/, 'not required: a workflow paths skip never reports');
});
