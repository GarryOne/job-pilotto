// The Actions page's six cards (renderer/index.html): each one is wired to something that exists, and Tune's words and guard hold.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import * as strategy from '../lib/strategy.js';
import {basisLine, proposalTitle} from '../renderer/tune-text.js';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const activity = fs.readFileSync(path.join(renderer, 'pages', 'activity.js'), 'utf8');
const main = fs.readFileSync(path.join(renderer, '..', 'main.js'), 'utf8');

const grid = html.slice(html.indexOf('<div class="task-grid">'), html.indexOf('<section class="card runs-card">'));
const cards = grid.split('<div class="task-card">').slice(1);

test('there are six cards, an even grid', () => assert.equal(cards.length, 6));

test('every card button runs a task the app knows', () => {
  const kinds = activity.match(/export const COMMAND_KIND = \{([^}]*)\}/)[1];
  for (const card of cards) {
    const command = card.match(/data-command="(\w+)"/)?.[1];
    if (!command) { assert.match(card, /id="tune-open"/, 'a card without a command is Tune'); continue; }
    assert.match(kinds, new RegExp(`\\b${command}:`), `${command} is not a tracked task (COMMAND_KIND)`);
    assert.match(main, new RegExp(`'${command}'`), `${command} is not handled by main.js`);
  }
});

test('the cards are the agreed six, and the dropped ones stay dropped', () => {
  const titles = cards.map(card => card.match(/<div class="task-words"><b>([^<]+)<\/b>/)[1].replace('&amp;', '&'));
  assert.deepEqual(titles, ['Search for new jobs', 'Find new employers', 'Check Gmail & Calendar', 'Prepare top matches',
    'Tune my strategy', 'Analyze my job search']);
});

test('Tune words: a title per kind, and the basis line says why there is nothing', () => {
  assert.equal(proposalTitle({kind: 'drop_role', label: 'bi'}), 'Stop searching for “bi”');
  assert.equal(proposalTitle({kind: 'drop_place', label: 'berlin'}), 'Stop searching in “berlin”');
  assert.equal(proposalTitle({kind: 'exclude_title', label: 'marketing'}), 'Skip job titles with “marketing”');
  assert.match(basisLine({basis: {jobs: 0}, proposals: []}), /No results to learn from yet/);
  const basis = {jobs: 49, dismissed: 4, engaged: 45, interviews: 0, min_dismissed: 5};
  assert.match(basisLine({basis, proposals: []}), /49 jobs you acted on: 4 dismissed, 45 kept or applied, 0 interviews\. Nothing to change: .*5\+ dismissals/);
  assert.doesNotMatch(basisLine({basis, proposals: [{id: 'x'}]}), /Nothing to change/);
  assert.match(basisLine({basis: {...basis, jobs: 1, interviews: 1}, proposals: []}), /1 job you acted on.*1 interview\./);
});

test('Apply writes only what the engine offers again: a made-up or stale id changes nothing', () => {
  const fresh = [{id: 'drop_role:role_keywords:\\bbi\\b', kind: 'drop_role'}, {id: 'drop_place:abroad:berlin', kind: 'drop_place'}];
  assert.deepEqual(strategy.chooseOffered(fresh, ['drop_place:abroad:berlin']), {chosen: [fresh[1]], asked: 1});
  assert.deepEqual(strategy.chooseOffered(fresh, ['exclude_title:title_exclude_keywords:\\bpython\\b']), {chosen: [], asked: 1});
  assert.deepEqual(strategy.chooseOffered(fresh, 'not a list'), {chosen: [], asked: 0});
  assert.deepEqual(strategy.chooseOffered(undefined, ['x']), {chosen: [], asked: 1});
});
