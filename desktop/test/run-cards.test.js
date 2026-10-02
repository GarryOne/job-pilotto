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
