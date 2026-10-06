// A weekly report or insight that kept only its one-line summary draws the same card as one with its message, the summary
// whole (owner's targeted fix #3, 6 Oct 2026: the result was cut short in the header and missing from the body).
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardText, summaryMessage} from '../renderer/run-cards.js';
import {parseWeekly} from '../renderer/weekly-card.js';
import {parseInsight} from '../renderer/insight-card.js';

test('a weekly summary becomes the weekly card: the first clause leads, the rest follows, nothing dropped', () => {
  const run = {kind: 'weekly', ok: true, summary: '5 interviews from 20 applications, all via recruiters; 0 of 15 non-recruiter applications got one'};
  const weekly = parseWeekly(cardText(run));
  assert.equal(weekly.headline, '5 interviews from 20 applications, all via recruiters');
  assert.equal(weekly.summary, '0 of 15 non-recruiter applications got one.');
});

test('an insight summary "Topic — finding" becomes the insight card', () => {
  const insight = parseInsight(cardText({kind: 'insight', ok: true, summary: 'Seniority — 4 of 10 applications targeted Staff/Principal roles; none passed screening'}));
  assert.equal(insight.category, 'Seniority');
  assert.equal(insight.headline, '4 of 10 applications targeted Staff/Principal roles; none passed screening');
});

test('only a finished, successful run without a message; other kinds keep their own text', () => {
  assert.equal(summaryMessage({kind: 'weekly', ok: false, summary: 'x'}), null);
  assert.equal(summaryMessage({kind: 'weekly', ok: true, message: 'm', summary: 'x'}), null);
  assert.equal(summaryMessage({kind: 'scout', ok: true, summary: '15 checked · 0 new sources'}), null);
  assert.equal(cardText({kind: 'weekly', ok: true, message: '📊 Search analysis\nA', summary: 'B'}), '📊 Search analysis\nA');
});
