// The Actions card for a run with no result: every way to reach it has one outcome line, a pill that matches the cause and a button for the next step (21 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {runPill, noResultHead} from '../renderer/run-status.js';

const base = {kind: 'search', live: false, endedAt: '2026-10-21T03:14:00Z', startedAt: '2026-10-21T02:44:00Z'};
const kind = {name: 'Find jobs'};
const variants = {
  interrupted: [{...base, ok: false, interrupted: true}, 'Interrupted', 'warn', 'Run again'],
  'failed, no message': [{...base, ok: false}, 'Failed', 'bad', 'Run again'],
  'finished, result not saved': [{...base, ok: true}, 'No result', 'neutral', 'Read again'],
};

test('each no-result variant: one outcome line, the pill by cause, a next-step button', () => {
  for (const [name, [run, pillLabel, tone, button]] of Object.entries(variants)) {
    const head = noResultHead(run, kind);
    assert.ok(head.title && head.summary, `${name}: a title and one summary`);
    assert.doesNotMatch(head.summary, /·|No result was saved/, `${name}: no joined raw sentence, no duplicate "No result was saved"`);
    assert.equal(head.fix.label, button, `${name}: the next step`);
    const [label, pillTone] = head.pill || runPill(run);
    if (pillLabel) assert.equal(label, pillLabel, `${name}: pill`);
    assert.notEqual(label, 'Needs a look', `${name}: not the red catch-all`);
    assert.equal(head.tone, tone === 'neutral' ? 'info' : tone === 'warn' ? 'warn' : 'bad', `${name}: the box's tone by cause`);
    assert.equal(pillTone === 'bad', head.tone === 'bad', `${name}: only a real failure has a red pill`);
  }
});

test('the Actions card draws the shared box and never the old loose paragraphs', () => {
  const card = fs.readFileSync(new URL('../renderer/pages/activity-run-card.js', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /No result was saved for this run/);
  assert.match(card, /problemBox\(/);
});
