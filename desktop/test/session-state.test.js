// A session's state on the session page: ready for review, asking you, working, and how long it took.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SESSION_STATE, dockCounts, dockOrder, firstLine, isLive, isSubmitted, panelAnswered, sessionDuration, sessionReview, sessionState} from '../renderer/session-state.js';

test('a filled form waiting for you is "ready for review"; a message ending on your question is not', () => {
  const report = 'The N26 form is filled and open in Chrome. Nothing was submitted.\n\n**Left for you:**\n' +
    '- ⚠️ Any relatives or partners working at N26? (required) No source.';
  // A form question listed in the report is not Claude asking you (the N26 bug).
  assert.equal(sessionReview({status: 'input', question: report}), true);
  assert.equal(sessionReview({status: 'input', question: 'The form is filled. Shall I change the visa answer?'}), false);
  // "ready for you to review … Nothing was submitted" counts (the demo's wording).
  assert.equal(sessionReview({status: 'input', question: 'The application is ready for you to review. Nothing was submitted.'}), true);
  assert.equal(sessionReview({status: 'done'}), true);
  assert.deepEqual(sessionState({status: 'input', question: 'Race is set. Checking the resume.'}), ['Question for you', 'warn']);
  assert.deepEqual(sessionState({status: 'mystery'}), ['Ended', 'neutral']);
});

test('live: what the app says, else running until it ended', () => {
  assert.equal(isLive({live: false}), false);
  assert.equal(isLive({endedAt: '2026-09-29T00:00:00Z'}), false);
  assert.equal(isLive({}), true);
});

test('duration until it ended or waited for you', () => {
  const startedAt = '2026-09-29T10:00:00Z';
  assert.equal(sessionDuration({startedAt, needsYouSince: '2026-09-29T10:03:32Z'}), '3m 32s');
  assert.equal(sessionDuration({startedAt, endedAt: '2026-09-29T11:02:00Z'}), '1h 02m');
  assert.equal(sessionDuration({startedAt}, Date.parse('2026-09-29T10:00:42Z')), '42s');
});

test('a row shows whole sentences up to the limit, at least one', () => {
  assert.equal(firstLine('Short.'), 'Short.');
  assert.equal(firstLine('One sentence here. Two sentences here. Three.', 30), 'One sentence here.');
  assert.equal(firstLine('A single very long sentence without any stop at all', 10), 'A single very long sentence without any stop at all');
});

test('ready for review becomes "Ready to submit" (green) once the form page says every required field is filled', () => {
  assert.deepEqual(sessionState({status: 'done'}, true), ['Ready to submit', 'good']);
  assert.deepEqual(sessionState({status: 'done'}, false), ['Ready for review', 'warn']);
  assert.deepEqual(sessionState({status: 'running'}, true), ['Applying', 'info']);  // still working: not yet
});

// "Reload the tab" is a repair, not an action: it reloads a form page (losing what was typed in it since the last
// save), so it is offered only after the page's panel has failed to answer the app (1 Oct 2026).
test('only a form page that did not answer asks for the reload repair', () => {
  assert.equal(panelAnswered({went: 'tab', taken: true}), true);      // the panel answered: nothing to repair
  assert.equal(panelAnswered({went: 'chrome', taken: false}), false); // no panel: the repair applies
  assert.equal(panelAnswered({went: 'tab', taken: false}), false);    // a tab came forward, but its panel is dead
  assert.equal(panelAnswered({went: 'posting', taken: false}), false);
  assert.equal(panelAnswered(undefined), false);
  assert.equal(panelAnswered('tab'), false);  // the old string shape cannot answer "did it?" — never "answered"
});

// A session whose application was submitted says so, whatever its process last did: it is finished, not applying.
test('a submitted session reads "Submitted", not "Ready for review"', () => {
  const done = {status: 'done', endedAt: '2026-10-01T07:37:19Z', outcome: 'submitted', question: 'The form is filled; submit it yourself.'};
  assert.deepEqual(sessionState(done), SESSION_STATE.submitted);
  assert.equal(sessionState(done)[0], 'Submitted');
  // Without the outcome it is the ordinary finished session.
  assert.equal(sessionState({...done, outcome: ''})[0], 'Ready for review');
  // A running process still Applying: the outcome only speaks for a session that is over.
  assert.equal(sessionState({status: 'running', live: true, outcome: 'submitted'})[0], 'Applying');
  // A stopped process (exit 129) whose application was submitted still reads Submitted.
  const stopped = {status: 'failed', note: 'Session stopped (exit 129)', endedAt: '2026-10-01T15:15:00Z', outcome: 'submitted', live: false};
  assert.equal(isSubmitted(stopped), true);
  assert.equal(sessionState(stopped, true)[0], 'Submitted');
  assert.equal(isSubmitted({status: 'failed', outcome: '', live: false}), false);
});

test('a form session (the Apply button) says the form is open until the extension reports it complete', () => {
  const form = {kind: 'form', status: 'done', outcome: '', live: false, endedAt: null};
  assert.deepEqual(sessionState(form), ['Form open', 'info']);
  assert.deepEqual(sessionState(form, true), SESSION_STATE.submit);
  assert.deepEqual(sessionState({...form, outcome: 'submitted'}), SESSION_STATE.submitted);
  assert.deepEqual(sessionState({status: 'done', outcome: '', endedAt: null}), SESSION_STATE.done);   // a Claude session is unchanged
});

test('a form session the extension cannot reach says so (no form, or an account is needed)', () => {
  const form = {kind: 'form', status: 'done', outcome: '', live: false, endedAt: null};
  assert.deepEqual(sessionState({...form, stuck: 'no-form'}), ['Can\'t reach form', 'warn']);
  assert.deepEqual(sessionState({...form, stuck: 'account'}), ['Needs an account', 'warn']);
});

test('a waiting session whose form is complete is ready for review, whatever Claude last asked', () => {
  const asked = {status: 'input', question: 'Send me the missing details (street, NPA) or finish it in Chrome.', brief: 'Send me the missing details?', live: false};
  assert.equal(sessionReview(asked), false);  // the form page said nothing: Claude's question stands
  assert.equal(sessionReview(asked, true), true);  // every required field filled: it is moot
  assert.deepEqual(sessionState(asked, true), ['Ready to submit', 'good']);
  assert.deepEqual(sessionState(asked, false), ['Question for you', 'warn']);
});

test('the dock counts and orders sessions like the list: closed forms are not active, and sort after the open one', () => {
  const form = (id, status = 'done') => ({id, kind: 'form', status, live: false, endedAt: '2026-10-02T03:00:00Z', note: 'Form open in Chrome'});
  const items = [form('openai-1'), form('openai-2'), form('amazon'), {id: 'ue', kind: 'claude', status: 'input', live: true, question: 'Which visa?'}];
  const gone = item => ['openai-1', 'openai-2'].includes(item.id);
  assert.deepEqual(dockCounts(items, gone), {active: 1, waiting: 1});          // the open Amazon form; the question
  assert.deepEqual(dockCounts(items), {active: 3, waiting: 1});                // without the tab report: all three forms look open
  const shown = [...items].sort((a, b) => dockOrder(a, gone) - dockOrder(b, gone)).map(item => item.id);
  assert.deepEqual(shown, ['ue', 'amazon', 'openai-1', 'openai-2']);
});

test('the stage says whether the session is creating the account or filling the application form', async () => {
  const {sessionStage} = await import('../renderer/session-state.js');
  assert.equal(sessionStage({stage: 'account', accountHost: 'career55.sapsf.eu'}).text, 'Step 1 of 2 · Creating your account on career55.sapsf.eu');
  assert.equal(sessionStage({kind: 'form', stuck: 'account'}).step, 1);   // marked before stages existed
  assert.equal(sessionStage({stage: 'form', accountHost: 'career55.sapsf.eu'}).text, 'Step 2 of 2 · Filling the application form');
  assert.equal(sessionStage({stage: 'form'}).text, 'Filling the application form');   // no account step: no step numbers
  assert.equal(sessionStage({stage: 'form', outcome: 'submitted'}), null);
  assert.equal(sessionStage({}), null);
});

test('a session whose tab is gone is closed: a form seen before, a form session after its first minute, a Claude session no longer running', async () => {
  const {tabClosed} = await import('../renderer/session-state.js');
  const none = {known: true, ids: []}, now = Date.parse('2026-10-08T12:30:00Z'), old = '2026-10-08T10:08:00Z';
  assert.equal(tabClosed({id: 'c1', kind: 'claude', live: false, status: 'input'}, none, false, now), true);   // Migros: sign-up page, no fields ever
  assert.equal(tabClosed({id: 'c1', kind: 'claude', live: true, status: 'running'}, none, false, now), false);  // may not have opened its tab yet
  assert.equal(tabClosed({id: 'f1', kind: 'form', stuck: 'no-form', startedAt: old}, none, false, now), true);  // Manor
  assert.equal(tabClosed({id: 'f1', kind: 'form', startedAt: '2026-10-08T12:29:40Z'}, none, false, now), false);  // just opened by Apply
  assert.equal(tabClosed({id: 'f1', kind: 'form', startedAt: old}, {known: true, ids: ['f1']}, false, now), false);
  assert.equal(tabClosed({id: 'f1', kind: 'form', startedAt: old}, {known: false, ids: []}, true, now), false);   // the extension is not reporting
  assert.equal(tabClosed({id: 'f1', kind: 'form', outcome: 'submitted', live: false}, none, true, now), false);
  assert.equal(tabClosed({id: 'r1', kind: 'read', live: false}, none, false, now), false);
  assert.equal(tabClosed({id: 'c1', kind: 'claude', live: false, status: 'ended'}, {known: true, ids: [], unsure: ['c1']}, true, now), false);   // no tab known: never "closed"
});

test('just after the app starts, a session waiting on its Chrome tab is "checking" until the extension reports in', async () => {
  const {checkingTabs, CHECK_MS} = await import('../renderer/session-state.js');
  const claude = {id: 'c1', kind: 'claude', live: false, status: 'input'}, form = {id: 'f1', kind: 'form'};
  assert.equal(checkingTabs(claude, null, 500), true);                        // nothing heard yet
  assert.equal(checkingTabs(form, {known: false, ids: []}, 500), true);       // the extension has not reported in
  assert.equal(checkingTabs(form, {known: true, ids: []}, 500), false);       // known: closed or open, the card says which
  assert.equal(checkingTabs(form, null, CHECK_MS + 1), false);                // no answer in time: the last state again
  assert.equal(checkingTabs({...claude, live: true, status: 'running'}, null, 500), false);
  assert.equal(checkingTabs({...form, outcome: 'submitted', live: false}, null, 500), false);
});

test('Applying in the menu counts every card in the list, whatever its state; the colour is the most urgent one', async () => {
  const {applyingBadge} = await import('../renderer/session-state.js');
  const level = item => item.level;
  // 8 Oct 2026: four "Form closed" cards, the badge said 2 (only the two still flagged as questions were counted).
  assert.deepEqual(applyingBadge([{level: 0}, {level: 0}, {level: 4}, {level: 4}], level), {count: 4, tone: 'warn'});
  assert.deepEqual(applyingBadge([{level: 2}, {level: 3}, {level: 4}], level), {count: 3, tone: 'info'});
  assert.deepEqual(applyingBadge([{level: 3}, {level: 3}], level), {count: 2, tone: 'good'});
  assert.deepEqual(applyingBadge([{level: 4}], level), {count: 1, tone: 'neutral'});
  assert.deepEqual(applyingBadge([], level), {count: '', tone: 'neutral'});
});

test("a session's Chrome tab on its card: host and path, no query or www, long paths cut in the middle", async () => {
  const {tabAddress} = await import('../renderer/session-state.js');
  assert.equal(tabAddress('https://www.apply.refline.ch/845721/0412/pub/1/index.html?lang=fr'), 'apply.refline.ch/845721/0412/pub/1/index.html');
  assert.equal(tabAddress('https://jobs.coop.ch/'), 'jobs.coop.ch');
  const long = tabAddress('https://jobs.coop.ch/Coop/job/Nyon-Assistante-Assistant-du-commerce-de-d%C3%A9tail-AFP-Vaud/1405093533/');
  assert.ok(long.length <= 70 && long.startsWith('jobs.coop.ch/Coop/job/') && long.endsWith('AFP-Vaud/1405093533'), long);
  assert.equal(tabAddress(''), '');
  assert.equal(tabAddress(undefined), '');
});

test('after the first look, a session waiting on its tab says Chrome is not reporting until the extension does', async () => {
  const {chromeSilent, CHECK_MS} = await import('../renderer/session-state.js');
  const claude = {id: 'c1', kind: 'claude', live: false, status: 'input'}, form = {id: 'f1', kind: 'form'};
  assert.equal(chromeSilent(form, {known: false, ids: []}, CHECK_MS + 1), true);
  assert.equal(chromeSilent(claude, null, CHECK_MS + 1), true);                         // the app never heard back at all
  assert.equal(chromeSilent(form, {known: false, ids: []}, 500), false);                // still the first look ("Checking…")
  assert.equal(chromeSilent(form, {known: true, ids: []}, CHECK_MS + 1), false);        // reporting: closed or open, the card says which
  assert.equal(chromeSilent({...claude, live: true, status: 'running'}, null, CHECK_MS + 1), false);
  assert.equal(chromeSilent({...form, outcome: 'submitted', live: false}, null, CHECK_MS + 1), false);
});

test('Claude working on a sign-in or sign-up page says "Creating account", not "Applying"', () => {
  assert.deepEqual(sessionState({kind: 'claude', status: 'running', stage: 'account', live: true}), ['Creating account', 'info']);
  assert.notDeepEqual(sessionState({kind: 'claude', status: 'running', stage: 'form', live: true}), ['Creating account', 'info']);
  assert.deepEqual(sessionState({kind: 'form', stuck: 'account', status: 'done'}), ['Needs an account', 'warn']);
});
