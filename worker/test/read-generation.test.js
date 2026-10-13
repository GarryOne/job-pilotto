// An async answer is applied only if it is still about the tab's current read (extension/read-gen.js; pool run 38325158956, HelloFresh: a digest ask started for the page's first, empty
// read landed after a second read had judged the form and was filling it, and "no form" (door 1) was reported mid-fill). One generation per tab, one check; every late-answer site of
// fill-flow.js consider() asks it. Guards the next async step too: a new `await` of an ask in consider() without the check fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {beginRead, forgetReads, isCurrent} from '../../extension/read-gen.js';

const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
const consider = flow.slice(flow.indexOf('export async function consider('));

test('a newer read of the tab makes the older one stale; another tab is not touched; a forgotten tab starts again', () => {
  const first = beginRead(1), other = beginRead(2);
  assert.equal(isCurrent(1, first), true);
  const second = beginRead(1);
  assert.equal(isCurrent(1, first), false, 'the first read is late now');
  assert.equal(isCurrent(1, second), true);
  assert.equal(isCurrent(2, other), true, 'a read of another tab is its own');
  forgetReads(1);
  assert.equal(isCurrent(1, second), false, 'a closed tab has no current read');
});

test('class: every ask consider() waits on is checked right after, and the read is begun once the call is not skipped', () => {
  assert.match(consider, /if \(started\.has\(key\)\) return;\s*started\.add\(key\);\s*notePage\([^\n]*\n\s*const gen = beginRead\(tab\.id\);/, 'a call that returns at once is not a read');
  const waits = [...consider.matchAll(/await (kindAsk|outcomeLook|climbOnUnsure\(|climbOnStall\()/g)];
  assert.ok(waits.length >= 4, `${waits.length} awaited asks found: the list of late-answer sites changed, update this test`);
  for (const wait of waits) {
    const after = consider.slice(wait.index, wait.index + 520);
    assert.match(after, /late\(tab, gen,/, `the ask awaited at "${consider.slice(wait.index, wait.index + 60).replace(/\s+/g, ' ')}" is not checked with late(tab, gen, ...)`);
  }
});

test('the late answer is logged, not silent, and the tab\'s reads are forgotten with the tab', () => {
  assert.match(flow, /const late = \(tab, gen, what\) => \{[^}]*decide\('fill', 'late answer dropped: a newer read of this tab answered'/);
  assert.match(fs.readFileSync(new URL('../../extension/read-gen.js', import.meta.url), 'utf8'), /tabs\?\.onRemoved\?\.addListener\(forgetReads\)/);
});
