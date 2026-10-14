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

test('the rows spread round robin over at most 5 runners', () => {
  assert.deepEqual(split(['a', 'b', 'c', 'd', 'e', 'f', 'g']), [['a', 'f'], ['b', 'g'], ['c'], ['d'], ['e']]);
  assert.deepEqual(split(['a', 'b']), [['a'], ['b']]);
  assert.deepEqual(split([]), []);
});

test('the PR workflow: starts only when extension/ or desktop/lib/ changed (GitHub paths), red when worse or unfinished, no AI key', () => {
  const flow = fs.readFileSync(new URL('../../../.github/workflows/site-replays-pr.yml', import.meta.url), 'utf8');
  assert.match(flow, /on:\n  pull_request:\n    paths:\n      - 'extension\/\*\*'\n      - 'desktop\/lib\/\*\*'\n/, 'owner, 14 Oct 2026: only the apply flow\'s code, decided by GitHub');
  assert.doesNotMatch(flow, /ci-needed/, 'no shared pick');
  assert.match(flow, /name: replay gate/);
  assert.match(flow, /a replay runner did not finish/);
  assert.match(flow, /a counted row got worse/);
  assert.match(flow, /JP_REPLAY_ONLY: \$\{\{ matrix\.group \}\}/);
  assert.doesNotMatch(flow, /ANTHROPIC|OPENAI|claude -p|secrets: inherit/);
  const settings = fs.readFileSync(new URL('../../../tools/pr-settings.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /replay\\ gate/, 'not required: a workflow paths skip never reports');
});
