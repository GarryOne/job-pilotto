// Guards the ladder score (e2e/lib/ladder-score.mjs): how a page-kind answer becomes an outcome, a status and a rung, that the rates are never blended across sources, the offline replay
// goes through the real pageKind, and the live run refuses to spend API money.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertNoApiSpend, outcomeOf, rungOf, scoreFixtures, statusOf, summarize} from '../e2e/lib/ladder-score.mjs';

const sketch = {url: 'https://x.example.ch/jobs/1', title: 'Job', headings: ['Job'], controls: [], buttons: ['Apply'], frames: [], mails: []};
const fixture = (id, source, outcome, answer, extra = {}) => ({id, source, lang: 'en', sketch, expect: {outcome, ...(extra.accept ? {accept: extra.accept} : {})}, answer, ...extra});
const answer = (kind, confidence, more = {}) => ({kind, confidence, apply_button: '', apply_button_kind: more.apply_button ? 'apply' : '', apply_route: '', account_step: '', register_control: '', signin_control: '', account_button: '', apply_by: '', apply_email: '', bot_check: false, ...more});

test('a page-kind result becomes one outcome the ladder speaks in', () => {
  assert.equal(outcomeOf({kind: 'form'}), 'form');
  assert.equal(outcomeOf({kind: 'account-form'}), 'form');
  assert.equal(outcomeOf({kind: 'account'}), 'account');
  assert.equal(outcomeOf({kind: 'posting', applyBy: ''}), 'posting');
  assert.equal(outcomeOf({kind: 'posting', applyBy: 'form'}), 'posting');
  assert.equal(outcomeOf({kind: 'posting', applyBy: 'email', applyEmail: 'a@example.com'}), 'email');
  assert.equal(outcomeOf({kind: 'posting', applyBy: 'other'}), 'other');
  assert.equal(outcomeOf({kind: 'other'}), 'other');
  assert.equal(outcomeOf({kind: 'posting', applyBy: 'form', formFrame: 0}), 'form_in_frame', 'a posting whose form the AI placed in a listed frame');
  assert.equal(outcomeOf({kind: 'posting', applyBy: 'form', formFrame: -1}), 'posting');
  assert.equal(outcomeOf({error: 'unsure (0.4)', kind: 'form'}), 'unsure');   // today an unsure answer goes DOWN to the structure rule (spec gap 1)
  assert.equal(outcomeOf({error: 'no AI'}), 'unsure');
});

test('the rung that decides today: 0 structure, 1 kept answer, 2 the AI sketch', () => {
  assert.equal(rungOf({error: 'unsure (0.4)'}), 0);
  assert.equal(rungOf({kind: 'form', by: 'remembered'}), 1);
  assert.equal(rungOf({kind: 'form', by: 'ai'}), 2);
});

test('status: exact, ok (accepted), miss, and wrong-and-confident only when the answer was sure', () => {
  const expect = {outcome: 'phone', accept: ['phone', 'other']};
  assert.equal(statusOf(expect, 'phone', 0.9), 'exact');
  assert.equal(statusOf(expect, 'other', 0.9), 'ok');
  assert.equal(statusOf(expect, 'form', 0.5), 'miss');
  assert.equal(statusOf(expect, 'form', 0.9), 'wrong-confident');
  assert.equal(statusOf(expect, 'unsure', 0), 'miss');   // unsure is never "confident"
});

test('offline replays the stored answers through the real pageKind; no model is called', async () => {
  const rows = await scoreFixtures([
    fixture('a', 'invented', 'posting', answer('posting', 0.9)),
    fixture('b', 'invented', 'email', answer('posting', 0.95, {apply_by: 'email', apply_email: 'nobody@example.com'}), {trap: true}),   // the address is not on the page: the floor drops it
  ]);
  assert.deepEqual(rows.map(row => [row.id, row.outcome, row.status, row.rung]), [['a', 'posting', 'exact', 2], ['b', 'other', 'wrong-confident', 2]]);
});

test('a fixture without a stored answer is reported, not silently counted', async () => {
  const rows = await scoreFixtures([fixture('c', 'invented', 'posting', undefined)]);
  assert.equal(rows[0].status, 'no-answer');
});

test('rates are per source, never one blended number', async () => {
  const rows = await scoreFixtures([
    fixture('r1', 'recorded', 'posting', answer('posting', 0.9)), fixture('c1', 'captured', 'posting', answer('form', 0.9)),
    fixture('x1', 'reconstructed', 'posting', answer('posting', 0.9)), fixture('i1', 'invented', 'posting', answer('posting', 0.9)),
  ]);
  const summary = summarize(rows);
  assert.deepEqual(Object.keys(summary.bySource).sort(), ['invented', 'real', 'reconstructed']);
  assert.deepEqual([summary.bySource.real.total, summary.bySource.real.hits], [2, 1]);   // recorded + captured are real pages
  assert.equal('overall' in summary || 'rate' in summary, false);
  assert.deepEqual(summary.wrongConfident.map(row => row.id), ['c1']);
});

test('a start dialog: the digest is not asked when the manual route is named and its button is listed; the expectation is checked, not assumed', async () => {
  const dialog = (extra = {}) => fixture('d', 'reconstructed', 'posting', answer('posting', 0.95, {apply_button: 'Apply Manually', apply_route: 'manual'}),
    {expect: {outcome: 'posting', accept: ['posting'], apply_route: 'manual', digest: 'not_asked', ...extra}, sketch: {...sketch, buttons: ['Apply Manually', 'Use My Last Application']}});
  const [good] = await scoreFixtures([dialog()]);
  assert.deepEqual([good.status, good.route, good.digestOk], ['exact', 'manual', true]);
  const [noManual] = await scoreFixtures([{...dialog(), answer: answer('posting', 0.95, {apply_button: '', apply_route: 'reuse_previous'})}]);
  assert.deepEqual([noManual.status, noManual.route, noManual.digestOk], ['miss', 'reuse_previous', false]);   // right kind, but the digest would have to be asked
  const [asked] = await scoreFixtures([{...dialog({digest: 'asked', apply_route: 'reuse_previous'}), answer: answer('posting', 0.95, {apply_button: '', apply_route: 'reuse_previous'})}]);
  assert.deepEqual([asked.status, asked.digestOk], ['exact', true]);
  assert.equal((await scoreFixtures([fixture('p', 'invented', 'posting', answer('posting', 0.9))]))[0].digestOk, null);   // no expectation, nothing claimed
});

const judgeSketch = {url: 'https://jobs.example.ch/konto', title: 'Konto erstellen', headings: ['Konto erstellen'], controls: [{type: 'email', label: 'E-Mail', required: true, state: 'filled'}, {type: 'checkbox', label: 'Ich akzeptiere die Nutzungsbedingungen', required: true, state: 'unchecked'}],
  buttons: ['Konto erstellen', 'Weiter'], texts: ['Bitte bestätigen Sie die Bedingungen.'], frames: []};
const judged = (id, question, outcome, answer, extra = {}) => ({id, source: 'invented', lang: 'de', question, sketch: judgeSketch, expect: {outcome}, answer, ...extra});

test('the judges are questions of rung 2: each fixture is scored through the REAL judge, per question', async () => {
  const rows = await scoreFixtures([
    judged('r1', 'account_ready', 'needs_person', {answer: 'needs_person', needs: 'Ich akzeptiere die Nutzungsbedingungen', needs_kind: 'consent', consent_required: true, bot_check: false, confidence: 0.9}),
    judged('r2', 'account_result', 'needs_code', {answer: 'needs_code', needs: '', needs_kind: 'code', consent_required: false, bot_check: false, confidence: 0.92}),
    judged('r3', 'form_step', 'middle', {answer: 'ready', needs: '', needs_kind: '', step: 'middle', next_control: 'Weiter', confidence: 0.85}),
    judged('r4', 'account_ready', 'ready', {answer: 'needs_person', needs: 'nothing the page lists', needs_kind: 'field', consent_required: false, bot_check: false, confidence: 0.9}),
    judged('r5', 'form_step', 'final', {answer: 'banana', step: 'final', confidence: 0.9}),
    judged('r6', 'form_ready', 'needs_person', {answer: 'needs_person', needs: 'Country*', needs_kind: 'choice', step: 'final', next_control: '', confidence: 0.9}),   // the form judge's answer, not its step
  ]);
  assert.deepEqual(rows.map(row => [row.id, row.question, row.outcome, row.status, row.rung]), [['r1', 'account_ready', 'needs_person', 'exact', 2], ['r2', 'account_result', 'needs_code', 'exact', 2], ['r3', 'form_step', 'middle', 'exact', 2],
    ['r4', 'account_ready', 'needs_person', 'wrong-confident', 2], ['r5', 'form_step', 'unsure', 'miss', 0], ['r6', 'form_ready', 'needs_person', 'exact', 2]]);   // a judge answer outside its fixed list is an error: unsure, rung 0
});

test('rates are per question and then per source, never blended across questions', async () => {
  const rows = await scoreFixtures([
    fixture('p1', 'invented', 'posting', answer('posting', 0.9)),
    judged('j1', 'account_ready', 'ready', {answer: 'ready', needs: '', needs_kind: '', consent_required: false, bot_check: false, confidence: 0.9}),
    judged('j2', 'form_step', 'final', {answer: 'ready', step: 'final', next_control: '', confidence: 0.9}, {source: 'recorded'}),
  ]);
  const summary = summarize(rows);
  assert.deepEqual(Object.keys(summary.byQuestion).sort(), ['account_ready', 'form_step', 'page_kind']);
  assert.deepEqual(summary.byQuestion.form_step, {real: {total: 1, hits: 1, exact: 1}});
  assert.deepEqual(summary.byQuestion.account_ready, {invented: {total: 1, hits: 1, exact: 1}});
  assert.deepEqual(summary.bySource, {invented: {total: 1, hits: 1, exact: 1}});   // bySource stays the page-kind question's
});

test('the live run refuses an API key, a CI run and any engine but the plan\'s Claude Code', () => {
  assert.throws(() => assertNoApiSpend({env: {ANTHROPIC_API_KEY: 'sk-x'}, engine: 'cli'}), /ANTHROPIC_API_KEY/);
  assert.throws(() => assertNoApiSpend({env: {CI: 'true'}, engine: 'cli'}), /CI/);
  assert.throws(() => assertNoApiSpend({env: {}, engine: 'api'}), /plan/);
  assert.doesNotThrow(() => assertNoApiSpend({env: {}, engine: 'cli'}));
});
