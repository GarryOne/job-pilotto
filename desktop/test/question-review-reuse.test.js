// The review drawer's "Reuse for matching questions" (owner's mockup, 17 Oct 2026): on by default; off keeps the answer with that one application only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {formatFor} from '../renderer/question-kind.js';

const body = install();
const calls = [];
for (const id of ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-chip', 'questions-chip-text', 'questions-review', 'questions-manage', 'review-drawer-layer', 'review-drawer-backdrop', 'review-panel']) {
  const node = globalThis.document.createElement('div'); node.id = id; body.append(node);
}
const LIST = ['Notice period', 'Why us?'].map((question, i) => ({key: `k${i}`, question, company: 'Acme AG', format: formatFor({})}));
globalThis.window.pilot = new Proxy({
  openQuestions: async () => ({list: LIST.map(q => ({...q})), hidden: []}),
  answerQuestion: async (...args) => { calls.push(args); return {ok: true, homeName: args[3]?.jobOnly ? 'this application (Acme AG)' : ''}; },
}, {get: (all, key) => all[key] || (() => null)});
const review = await import('../renderer/pages/question-review.js');
const panel = () => globalThis.document.getElementById('review-panel');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const type = value => { const input = panel().querySelector('#qr-control'); input.value = value; input.dispatch('input'); };

test('the switch is on by default, worded as the mockup, and an answer given with it on is reused as before', async () => {
  await review.openQuestionReview();
  const reuse = panel().querySelector('#qr-reuse');
  assert.equal(reuse.checked, true);
  assert.match(panel().textContent, /Reuse for matching questions/);
  assert.match(panel().textContent, /Job-specific details stay with this application/);
  type('3 months');
  panel().querySelector('#qr-confirm').click();
  await flush();
  assert.equal(calls[0].length, 3, 'no job-only option when reuse is on');
  assert.deepEqual(calls[0].slice(0, 2), ['k0', '3 months']);
});

test('off: the answer is sent for this application only, with the company that asked, and the drawer says so', async () => {
  const reuse = panel().querySelector('#qr-reuse');
  reuse.checked = false;
  reuse.dispatch('change');
  assert.match(panel().textContent, /Used for this application only/);
  type('Because of the platform');
  panel().querySelector('#qr-confirm').click();
  await flush();
  assert.deepEqual(calls[1].slice(0, 2), ['k1', 'Because of the platform']);
  assert.deepEqual(calls[1][3], {jobOnly: true, company: 'Acme AG'});
  assert.match(panel().textContent, /Saved to this application \(Acme AG\)/);
});
