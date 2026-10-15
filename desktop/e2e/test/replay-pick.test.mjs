// The PR replay gate's pick (replay-pick.mjs) and its workflow (owner, 14 Oct 2026: at most 10 rows, the quickest, diverse, in 2-3 min, report only, $0).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {GROUPS, MAX, kindOf, pickPinned, pickRows, pickedCount, split} from '../replay-pick.mjs';
import {formHostOf, kindFor, load, pinned} from '../lib/replay-ratchet.mjs';

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
  assert.equal(kindOf('G1', hosts, {}), 'Greenhouse');
  assert.equal(kindOf('G2', hosts, {}), 'Greenhouse');
  assert.equal(kindOf('C1', hosts, {}), 'C1', 'a custom site is its own kind');
  assert.equal(kindOf('not in the pool', hosts, {}), 'not in the pool');
  const names = ['G1', 'G2', 'R1', 'C1', 'C2'];
  assert.deepEqual(pickPinned(names, {seconds: {G1: 90, G2: 40, R1: 70, C1: 60, C2: 50}, hosts, kinds: {}}), ['G2', 'C2', 'C1', 'R1'], 'the quickest Greenhouse row; kinds quickest first');
  const many = Array.from({length: 20}, (_, i) => `c${i}`);
  assert.equal(pickPinned(many, {hosts: new Map(), kinds: {}}).length, MAX);
  assert.equal(pickedCount(names, hosts, MAX, {}), 4);
  assert.equal(pickedCount(many, new Map(), MAX, {}), MAX);
});

test('the kind of a row is the platform of the host its FORM was on, not of its start address', () => {
  assert.equal(formHostOf('x\n2026 [extension] fill: filling {"host":"job-boards.greenhouse.io","job":"/a"}\ny'), 'job-boards.greenhouse.io');
  assert.equal(formHostOf('[extension] details for apply.workable.com: 9 contact fields'), 'apply.workable.com');
  assert.equal(formHostOf('nothing'), '');
  assert.equal(kindFor({formHost: 'job-boards.greenhouse.io', startHost: 'www.databricks.com', name: 'Databricks'}), 'Greenhouse', 'a company page that fills a Greenhouse form is a Greenhouse kind');
  assert.equal(kindFor({formHost: '', startHost: 'boards.greenhouse.io', name: 'x'}), 'Greenhouse', 'no form host: the start address');
  assert.equal(kindFor({formHost: 'omegach.recruitmentplatform.com', startHost: 'a.example', name: 'Swatch'}), 'Swatch', 'a site on no platform is its own kind');
});

test('on the real pinned rows: every row has a kind, the 3 Greenhouse forms are ONE kind, no two picked rows share a kind, no kind goes unpicked under the cap, and the name says k of n', () => {
  const data = load(), pins = pinned(data), kinds = data.rows;
  assert.deepEqual(pins.filter(name => !kinds[name].kind), [], 'a pinned row without a kind: run lib/replay-ratchet.mjs pin/kinds');
  const greenhouse = ['Greenhouse board form', 'coreweave (found 2026-10-10)', 'Databricks (found 2026-10-10)'];
  assert.deepEqual(greenhouse.map(name => kinds[name]?.kind), ['Greenhouse', 'Greenhouse', 'Greenhouse'], 'the golden: these three fill a Greenhouse form');
  const pool = new Map(), picked = pickPinned(pins, {hosts: pool, kinds}), pickedKinds = picked.map(name => kinds[name].kind);
  assert.equal(new Set(pickedKinds).size, pickedKinds.length, 'two picked rows share a kind');
  assert.equal(picked.filter(name => greenhouse.includes(name)).length, 1, 'Greenhouse: 1 of 3');
  const unpicked = new Set(pins.map(name => kinds[name].kind)); for (const kind of pickedKinds) unpicked.delete(kind);
  assert.ok(unpicked.size === 0 || picked.length === MAX, 'a kind goes unpicked while the cap is not reached');
  for (const name of ['Join: form on join.com', 'Swatch Group careers']) if (pins.includes(name)) assert.ok(picked.includes(name) || picked.length === MAX, `${name} is a kind no other row covers`);
  const flow = fs.readFileSync(new URL('../../../.github/workflows/site-replays-pr.yml', import.meta.url), 'utf8');
  assert.match(flow, new RegExp(`^name: CI · Site replays · PR \\(${pickedCount(pins, pool, MAX, kinds)} of ${pins.length} pinned rows\\)$`, 'm'), 'the name says k of n: update it in the same PR as a pin');
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
  assert.match(flow, /part: \[0, 1, 2, 3\]/, 'one part per runner group: the pick is folded into each part (15 Oct 2026, fewer runner slots)');
  assert.equal(GROUPS, 4, 'the workflow matrix has GROUPS parts');
  assert.doesNotMatch(flow, /^  pick:/m, 'no separate pick job');
  assert.match(flow, /node replay-unsame\.mjs/, 'a pinned row not same is replayed once more on its runner');
  assert.match(flow, /--retry "\$RUNNER_TEMP\/retry4"/, 'and the gate counts a pass on the retry as noise');
  assert.doesNotMatch(flow, /LATENCY_PAD|replay-late/, 'the late-answer pass runs on the scheduled runs only (owner, 15 Oct 2026)');
  const scheduled = fs.readFileSync(new URL('../../../.github/workflows/site-replays.yml', import.meta.url), 'utf8');
  assert.match(scheduled, /LATENCY_PAD_MS: '4000'/);
  assert.match(scheduled, /late answers lost: /, 'a row that lost the answers is named in the alert');
  assert.match(scheduled, /code=1; echo "### Late answers/, 'and the run is red like a drop');
  assert.doesNotMatch(flow, /ANTHROPIC|OPENAI|claude -p|secrets: inherit/);
  const settings = fs.readFileSync(new URL('../../../tools/pr-settings.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /replay\\ gate/, 'not required: a workflow paths skip never reports');
});
