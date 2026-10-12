// The class of "can't reach" reasons (owner rule: a fix covers every sibling): every reason the extension sends (extension/ladder/endings.js STUCK_REASONS) is kept by the app as sent
// (lib/session-flow.js through application-journey.js STUCK), and each gets its own words on every screen that names one: the session chip, the steps, the journey line. The three lists of
// reasons with no Claude offer (the journey's INFORM, the renderer's INFORM_STUCK, the page panel's INFORM) stay equal. A new reason fails here until every place has it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';
import * as apply from '../lib/apply.js';
import {STUCK_REASONS} from '../../extension/ladder/endings.js';
import {INFORM, STUCK, journeyStep} from '../lib/application-journey.js';
import {createSessionFlow} from '../lib/session-flow.js';
import {INFORM_STUCK, sessionSteps} from '../renderer/session-steps-list.js';
import {sessionState} from '../renderer/session-state.js';

const URL1 = 'https://jobs.example/posting/1';

test('the app keeps the same reasons the extension sends, no more, no less', () => {
  assert.deepEqual([...STUCK].sort(), [...STUCK_REASONS].sort());
});

test('each reason the extension sends is kept on the session as sent (never turned into "no-form")', () => {
  for (const why of STUCK_REASONS) {
    terminals._reset();
    const flow = createSessionFlow({terminals, review: {olderTab: () => false, allStates: () => [], queueClose: () => {}}, apply, appLog: () => {}, startClaude: async () => ({ok: true}),
      claudeAllowed: () => false, closeTab: async () => true});
    terminals.startForm({id: 'f1', url: URL1, company: 'Example'});
    flow.stuck({url: URL1, host: 'jobs.example', why, tab: 5, session: 'f1', needs: 'A need named by the extension'});
    assert.equal(terminals.get('f1').stuck, why, why);
  }
});

test('the reasons with no Claude offer are one list in the journey, the renderer and the page panel', () => {
  assert.deepEqual(INFORM_STUCK, INFORM);
  const panel = fs.readFileSync(new URL('../../extension/panel-claude.js', import.meta.url), 'utf8').match(/const INFORM = (\[[^\]]*\])/);
  assert.ok(panel, 'extension/panel-claude.js keeps its INFORM list');
  assert.deepEqual(JSON.parse(panel[1].replace(/'/g, '"')), INFORM);
  assert.ok(INFORM.every(why => STUCK.includes(why)));
});

test('every reason has its own words: the chip, the step, the journey line', () => {
  const chips = new Map();
  for (const why of STUCK_REASONS) {
    const item = {id: 'f1', kind: 'form', status: 'running', startedAt: '2026-10-12T10:00:00Z', stuck: why, accountNeeds: 'A need named by the extension', note: ''};
    const [chip] = sessionState(item) || [];
    assert.ok(chip, `${why}: a chip`);
    chips.set(why, chip);
    const steps = sessionSteps(item);
    assert.ok(steps.some(step => step.tone === 'warn'), `${why}: a step that says the application is stopped`);
    assert.ok(journeyStep(item).step, `${why}: a journey step`);
  }
  assert.equal(chips.get('no-form'), 'Can\'t reach form');
  for (const why of STUCK_REASONS.filter(one => !['no-form', 'account', 'incomplete'].includes(one))) assert.notEqual(chips.get(why), 'Can\'t reach form', `${why}: its own chip, not the no-form one`);
  assert.equal(chips.get('site_broken'), 'Site not answering');
  assert.equal(journeyStep({stuck: 'site_broken', accountNeeds: 'The site answered with an error (503): try again later'}).needs, 'The site answered with an error (503): try again later');
});
