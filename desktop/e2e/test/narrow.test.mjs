// The narrow-window pass (lib/layout.mjs visitNarrow): resizes, visits, downgrades what it finds to warnings, always restores the size.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {visitNarrow} from '../lib/layout.mjs';
import {expectedFor} from '../lib/vision.mjs';

function fakeCtx({railed = true} = {}) {
  const calls = {sizes: [], clicks: []};
  const ctx = {findings: [], app: {evaluate: async (_fn, size) => { calls.sizes.push(size); return [1280, 820]; }},
    page: {waitForFunction: async () => { if (!railed) throw new Error('timeout'); }, click: async selector => { calls.clicks.push(selector); }}};
  return {ctx, calls};
}

test('it visits each page at 1024 px, files what it finds as warnings and puts the window back', async () => {
  const {ctx, calls} = fakeCtx();
  const take = async (c, name) => { c.findings.push({view: name, severity: 'severe', kind: 'page-overflow', detail: 'x'}); };
  await visitNarrow(ctx, ['focus', 'jobs'], {take});
  assert.deepEqual(calls.sizes, [[1024, 640], [1280, 820]]);
  assert.deepEqual(calls.clicks, ['.nav[data-view="focus"]', '.nav[data-view="jobs"]']);
  assert.deepEqual(ctx.findings.map(f => [f.view, f.severity]), [['focus-narrow', 'warning'], ['jobs-narrow', 'warning']], 'a narrow-only problem never fails a journey');
});

test('the window is restored even when a page cannot be photographed', async () => {
  const {ctx, calls} = fakeCtx();
  await assert.rejects(visitNarrow(ctx, ['focus'], {take: async () => { throw new Error('boom'); }}), /boom/);
  assert.deepEqual(calls.sizes.at(-1), [1280, 820]);
});

test('a sidebar that does not become a rail is a finding, not a crash', async () => {
  const {ctx} = fakeCtx({railed: false});
  await visitNarrow(ctx, [], {take: async () => {}});
  assert.match(ctx.findings[0].detail, /did not become an icon rail at 1024 px/);
});

test('the AI review judges a narrow page against the same expectation as the wide one', () => {
  assert.equal(expectedFor('jobs-narrow'), expectedFor('jobs'));
});
