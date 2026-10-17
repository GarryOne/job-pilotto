// A search with new jobs and no digest still shows a result card (the owner's 17 Oct run showed only its header line), and the failure note is said once.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newJobItems, newJobsCard} from '../renderer/new-jobs-card.js';
import {readableLog} from '../renderer/human-log.js';
import {activitySource} from './activity-source.js';

const LINES = ['Added 2 new job(s): Paris 2', 'New job: Site Reliability Engineer | Acme | https://x.test/1', 'New job: Platform | Pipe | Co | https://x.test/2'];

test('the new jobs are read from the log: title, company, link, never scored', () => {
  assert.deepEqual(newJobItems(LINES).map(i => [i.title, i.company, i.url, i.fit, i.section]), [
    ['Site Reliability Engineer', 'Acme', 'https://x.test/1', null, 'new'], ['Platform | Pipe', 'Co', 'https://x.test/2', null, 'new']]);
});

test('every state of a finished search with new jobs and no digest draws a card; others do not', () => {
  const ok = {ok: true, new: 8};
  assert.equal(newJobsCard(ok, LINES).fresh, 8);
  assert.equal(newJobsCard(ok, LINES).items.length, 2);
  assert.deepEqual(newJobsCard(ok, []).items, [], 'an older run: its count, no rows');
  assert.equal(newJobsCard(ok, []).kind, 'digest');
  for (const run of [{ok: true, new: 0}, {ok: true}, {ok: false, new: 8}, {ok: true, new: 8, live: true}, null]) assert.equal(newJobsCard(run, LINES), null);
});

test('the renderer uses it for a search only when no digest parsed, and the step list leaves the partial note to the line under the card', () => {
  const source = activitySource();
  assert.match(source, /\(shownText \? parseRunMessage\(shownText\) : null\) \|\| \(kindOf\(run\) === 'search' \? newJobsCard\(run, lines\) : null\)/);
  assert.match(source, /stepNote\(stepWarnings\)/);
  assert.doesNotMatch(source, /stepNote\(detailWarnings\)/);
  assert.match(source, /const stepWarnings = partial \? split\.rest : detailWarnings;/);
});

test('the readable log names a new job in words', () => {
  assert.deepEqual(readableLog(['New job: SRE | Acme | https://x.test/1']), ['➕ SRE · Acme']);
});
