// The spec-proof gate (tools/spec-proof.mjs): a box a pull request ticks in a spec's "## Progress" names its proof file, and the PR contains that file
// (or names the commit on main that changed it, or says "proof: none: <why>"). Boxes ticked before the PR are never asked. Fake specs and ranges, no git.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newlyTicked, proofProblems} from '../../tools/spec-proof.mjs';

const spec = (...lines) => ['# A spec', '', '## Progress', ...lines, '', '## Notes', '- [x] not a progress box (proof: nothing)'].join('\n');

test('newly ticked: a box ticked by this PR, in the Progress section only; one ticked before is not new', () => {
  const base = spec('- [x] Done before', '- [ ] Step two', '- [ ] Step three');
  const head = spec('- [x] Done before', '- [x] Step two (proof: tools/a.mjs)', '- [ ] Step three');
  assert.deepEqual(newlyTicked(base, head), ['- [x] Step two (proof: tools/a.mjs)']);
  assert.deepEqual(newlyTicked('', spec('- [x] New spec box')), ['- [x] New spec box']);
  assert.deepEqual(newlyTicked(base, base), []);
  assert.deepEqual(newlyTicked('# no progress', '# no progress\n- [x] a list elsewhere'), []);
});

const ask = (lines, {changed = [], onMain = {}, exists = () => true} = {}) => proofProblems([{file: 'docs/superpowers/specs/s.md', base: spec(...lines.map(line => line.replace('[x]', '[ ]'))), head: spec(...lines)}],
  {changed: new Set(changed), touchedBy: (sha, file) => (onMain[sha] || []).includes(file), exists});

test('a ticked box with no proof, or a proof file the PR does not change, is a problem', () => {
  assert.match(ask(['- [x] Step two'])[0], /names no proof/);
  assert.match(ask(['- [x] Step two (proof: tools/a.mjs)'])[0], /tools\/a\.mjs is not changed by this pull request/);
  assert.deepEqual(ask(['- [x] Step two (proof: tools/a.mjs)'], {changed: ['tools/a.mjs']}), []);
  assert.deepEqual(ask(['- [x] Two proofs (proof: tools/a.mjs, desktop/test/a.test.js)'], {changed: ['tools/a.mjs', 'desktop/test/a.test.js']}), []);
  assert.match(ask(['- [x] Gone (proof: tools/a.mjs)'], {changed: ['tools/a.mjs'], exists: () => false})[0], /tools\/a\.mjs does not exist/);
});

test('a proof landed earlier names its commit on main, which must change that file; "none" needs a reason', () => {
  assert.deepEqual(ask(['- [x] Landed (proof: tools/a.mjs @abc1234)'], {onMain: {abc1234: ['tools/a.mjs']}}), []);
  assert.match(ask(['- [x] Landed (proof: tools/a.mjs @abc1234)'], {onMain: {abc1234: ['tools/b.mjs']}})[0], /commit abc1234 on main does not change tools\/a\.mjs/);
  assert.deepEqual(ask(['- [x] Owner\'s OK (proof: none: an owner decision, no file)']), []);
  assert.match(ask(['- [x] Owner\'s OK (proof: none)'])[0], /needs a reason/);
});

test('a PR that ticks nothing is never asked, whatever it changes', () => {
  assert.deepEqual(proofProblems([{file: 'docs/x.md', base: spec('- [ ] a'), head: spec('- [ ] a', '- [ ] b')}], {changed: new Set(), touchedBy: () => false, exists: () => true}), []);
});
