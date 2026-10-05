// Recent activity: Today's list and Find new employers as small cards (renderer/run-cards.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseRunMessage} from '../renderer/run-cards.js';

test("Today's list: counts and one line per match", () => {
  const card = parseRunMessage(`✈️ Job Pilotto · 🆕 0 new · top 10 of 37
37 open · 2 🇨🇭 · 18 applied · 59 filtered · 139 low fit
🎯 Best matches
1. Software Engineer, Cloud Infrastructure (https://jobs.ashbyhq.com/openai/29c2) · 🎯 78
   OpenAI · London, UK · Senior
2. Staff Software Engineer - Databases SRE | UK | Remote (https://job-boards.greenhouse.io/grafanalabs/jobs/61) · 🎯 76
   Grafana Labs · United Kingdom (Remote)`);
  assert.deepEqual([card.kind, card.fresh, card.open, card.local, card.applied], ['digest', 0, 37, 2, 18]);
  assert.deepEqual(card.items.map(item => [item.title, item.company, item.fit]),
    [['Software Engineer, Cloud Infrastructure', 'OpenAI', 78], ['Staff Software Engineer - Databases SRE', 'Grafana Labs', 76]]);
});

test('Find new employers: counts, one line per employer, the closing note', () => {
  const card = parseRunMessage(`🔎 Source scout · checked 15 · 🆕 7 new sources
1. Notion · Ashby · quality 64 · ⭐ Tier 1
   4 SRE-type roles · 3 in your places
   San Francisco
2. Delivery Hero · Smartrecruiters · quality 24 · ⭐ Tier 1
   1 SRE-type roles · 1 in your places
4 without public feed · 4 low relevance · 26 feeds crawled · 616 candidates queued`);
  assert.deepEqual([card.kind, card.checked, card.fresh], ['scout', 15, 7]);
  assert.deepEqual(card.items.map(item => [item.company, item.ats, item.roles, item.yours, item.tier]),
    [['Notion', 'Ashby', 4, 3, 'Tier 1'], ['Delivery Hero', 'Smartrecruiters', 1, 1, 'Tier 1']]);
  assert.match(card.note, /^4 without public feed/);
});

test('any other message stays text', () => {
  assert.equal(parseRunMessage('Weekly report: 9 applications'), null);
});

test('a jobs check from GitHub: no brand name, jobs without a fit (an AI limit reached) still make a card', () => {
  // 29 Sep 2026: "✈️ · 🆕 173 new" (the brand variable unset on GitHub) and jobs left unscored showed as raw text.
  const card = parseRunMessage(`✈️ · 🆕 173 new · top 10 of 50
173 open · 85 🇨🇭 · 19 applied · 5 low fit
🆕 New since last run
1. DevOps Engineer (https://jobs.ch/1)
   Consult & Pepper · Winterthur · 🌍 Remote?
2. Site Reliability Engineer / Software Engineer · 🎯 71
   Intelliact · Zürich`);
  assert.deepEqual([card.kind, card.fresh, card.open, card.local, card.applied], ['digest', 173, 173, 85, 19]);
  assert.deepEqual(card.items.map(item => [item.title, item.company, item.fit, item.url]),
    [['DevOps Engineer', 'Consult & Pepper', null, 'https://jobs.ch/1'], ['Site Reliability Engineer / Software Engineer', 'Intelliact', 71, '']]);
});

test('a digest counts the jobs in your places with 📍 (older digests used 🇨🇭)', () => {
  const card = parseRunMessage('✈️ Job Pilotto · 🆕 1 new · top 10 of 24\n24 open · 7 📍 · 2 applied\n🆕 New since last run\n1. Data Analyst (https://x.example/1)\n   Acme · Amsterdam');
  assert.equal(card.local, 7);
});

// 5 Oct 2026: a jobs check that ended while Recent activity was open showed its digest as raw Telegram text. A run recorded
// on this Mac has a log but no message; the window keeps the message it saw, and the card must be drawn from that.
test('a run without a message of its own is drawn from the result the window kept', async () => {
  const {cardText} = await import('../renderer/run-cards.js');
  const kept = ['✈️ Job Pilotto · 🆕 4 new · top 4 of 4', '4 open · 4 📍', '🆕 New since last run',
    '1. Senior Site Reliability Engineer, no-credit (Site Reliability / Data Analyst) (https://boards.e2e.test/job/1791157083)',
    '   E2E Acme · Zurich, Switzerland or Amsterdam, Netherlands'].join('\n');
  const local = {id: 7, kind: 'search', log: ['…'], ok: true};
  const card = parseRunMessage(cardText(local, kept));
  assert.equal(card?.kind, 'digest');
  assert.deepEqual(card.items.map(item => [item.company, item.url]), [['E2E Acme', 'https://boards.e2e.test/job/1791157083']]);
  assert.equal(cardText({...local, message: 'its own'}, kept), 'its own');   // the page's message wins
  assert.equal(cardText({...local, live: true}, kept), null);                // a running job has no card yet
  assert.equal(cardText(null, kept), null);
});

// A carded run kind showing its message as plain text is a fallback the window marks for the e2e checks (uicheck.mjs card-fallback).
test('a multi-line message of a carded kind shown as text is a fallback; a short note or another kind is not', async () => {
  const {isFallback} = await import('../renderer/run-cards.js');
  const three = 'line one\nline two\nline three';
  assert.equal(isFallback('search', three), true);
  assert.equal(isFallback('weekly', three), true);
  assert.equal(isFallback('search', 'No new jobs since your last check.'), false);
  assert.equal(isFallback('add', three), false);       // Logged activity has no card: its text is the answer
  assert.equal(isFallback('search', ''), false);
});
