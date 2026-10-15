// The PR replay gate's pick (replay-pick.mjs) and its workflow (owner, 14 Oct 2026: at most 10 rows, the quickest, diverse, in 2-3 min, report only, $0).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {MAX, pickRows, split} from '../replay-pick.mjs';

const row = (seconds, site, same = true) => ({same, seconds, site});

test('only rows 100% same as live in the baseline, quickest first, one per site before a second, at most MAX', () => {
  const baseline = {rows: {a: row(80, 'x.io'), b: row(40, 'x.io'), c: row(60, 'y.io'), d: row(30, 'z.io', false), e: row(null, 'w.io')}};
  assert.deepEqual(pickRows(baseline), ['b', 'c', 'e', 'a']);
  const many = {rows: Object.fromEntries(Array.from({length: 30}, (_, i) => [`r${i}`, row(i, `s${i}.io`)]))};
  assert.equal(pickRows(many).length, MAX);
  assert.deepEqual(pickRows({}), [], 'no baseline: nothing (never an uncounted row that cannot be judged)');
});

test('the rows spread over at most 10 runners: a full pick is one row per runner', () => {
  assert.deepEqual(split(['a', 'b', 'c', 'd', 'e', 'f', 'g']), [['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g']]);
  assert.equal(split(Array.from({length: MAX}, (_, i) => `r${i}`)).length, MAX);
  assert.equal(split(Array.from({length: 13}, (_, i) => `r${i}`)).length, 10);
  assert.deepEqual(split(['a', 'b']), [['a'], ['b']]);
  assert.deepEqual(split([]), []);
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
  assert.doesNotMatch(flow, /ANTHROPIC|OPENAI|claude -p|secrets: inherit/);
  const settings = fs.readFileSync(new URL('../../../tools/pr-settings.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /replay\\ gate/, 'not required: a workflow paths skip never reports');
});
