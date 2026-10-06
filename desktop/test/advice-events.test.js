// Advice shown and taken (7 Oct 2026): every place that recommends a search change records it with fixed names only, never the word itself.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {adviceEvent} from '../renderer/coverage-actions.js';

test('fixed kinds only, shown once per place a session, never the role word or place', () => {
  const sent = [];
  const record = (kind, fields) => sent.push([kind, fields]);
  assert.equal(adviceEvent('shown', 'coverage', 'strategy', {record}), true);
  assert.equal(adviceEvent('shown', 'coverage', 'strategy', {record}), false, 'once a session');
  adviceEvent('taken', 'exclude', 'few-jobs', {record, source: 'photographe'});
  adviceEvent('taken', 'source', 'few-jobs', {record, source: 'brave'});
  adviceEvent('taken', 'mystery', 'few-jobs', {record});
  assert.deepEqual(sent, [['advice', {act: 'shown', advice: 'role', where: 'strategy'}], ['advice', {act: 'taken', advice: 'filter', where: 'few-jobs'}],
    ['advice', {act: 'taken', advice: 'source', where: 'few-jobs', source: 'brave'}]]);
});

test('every recommending card records shown and taken (a new card without it fails here)', () => {
  const strategy = readFileSync(new URL('../renderer/pages/strategy.js', import.meta.url), 'utf8');
  const activity = readFileSync(new URL('../renderer/pages/activity.js', import.meta.url), 'utf8');
  for (const card of strategy.matchAll(/showCard\((\w+Card)\(/g)) assert.ok(card, card[1]);   // all go through showCard, which records
  assert.match(strategy, /function showCard[\s\S]*?adviceEvent\('shown'[\s\S]*?adviceEvent\('taken'[\s\S]*?adviceEvent\('dismissed'/);
  assert.match(strategy, /sourcesCard\(verdict[\s\S]*?adviceEvent\('shown', 'source'/);
  assert.match(activity, /adviceEvent\('shown', action\.kind[\s\S]*?adviceEvent\('taken', action\.kind/);
});

test('the sources card says what a source gave people like you; the employers card lists where they got interviews', async () => {
  const {employersCard, sourcesCard} = await import('../renderer/coverage-card.js');
  const sources = sourcesCard({at: 'x', sources: [{id: 'aggregators', name: 'Adzuna and Jooble', effort: 'Two free keys', gain: 'all trades', people: 'gave a match to 8 in 10 people like you'}]});
  assert.equal(sources.chips[0].label, '+ Adzuna and Jooble · gave a match to 8 in 10 people like you');
  const card = employersCard({at: 'x', for_you: [{company: 'Studio Geneva', interview: 1, applied: 3, why: 'kind of work'}]});
  assert.equal(card.chips[0].label, 'Studio Geneva · 1 interview');
  assert.equal(employersCard({at: 'x', for_you: []}), null);
});
