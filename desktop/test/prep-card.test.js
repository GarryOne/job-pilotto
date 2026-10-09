// The Focus prep card: a kit from an earlier call is not "ready" (30 Sep 2026, Huxley's follow-up showed the first kit).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {COST_HINT, prepCard} from '../renderer/prep-card.js';
import {ai} from '../renderer/ai-name.js';

const TODAY = '2026-09-30';
const item = extra => ({kind: 'prepare', meta: ['Principal SRE', '…'], page_id: 'h1', notion_url: 'https://notion.so/h1', ...extra});

test('a kit from an earlier call: "Build new prep kit" first, the earlier kit only in the ⋯ menu, and why', () => {
  const card = prepCard(item({prep_at: '2026-09-29', prep_stale: true, prep_why: 'reviewed', prep_since: '2026-09-30'}), TODAY);
  assert.equal(card.primary.label, 'Build new prep kit');
  assert.equal(card.primary.run, 'build');
  assert.equal(card.primary.title, ai(COST_HINT));  // what it does is said before you press it, naming the chosen AI
  assert.match(card.primary.title, /^Claude Sonnet builds it/);
  assert.doesNotMatch(COST_HINT, /\$/);
  assert.match(card.meta[1], /^Kit from 29 Sept? · your call today was reviewed since$/);
  assert.equal(card.more.length, 1);
  assert.match(card.more[0].label, /^Open earlier kit \(built 29 Sept?\)$/);
  assert.equal(card.more[0].run, 'open');
  assert.ok(!JSON.stringify(card).includes('Open prep kit'));  // never offered as if it were for this round
});

test('a stale kit names the day of the review, or of the booking', () => {
  const reviewed = prepCard(item({prep_at: '2026-09-29T07:00:00+00:00', prep_stale: true, prep_why: 'reviewed', prep_since: '2026-09-30'}), '2026-10-01');
  assert.match(reviewed.meta[1], /^Kit from 29 Sept? · your call on 30 Sept? was reviewed since$/);
  const booked = prepCard(item({prep_at: '2026-09-29', prep_stale: true, prep_why: 'booked', prep_since: '2026-09-30'}), '2026-10-01');
  assert.match(booked.meta[1], /the interview was booked or moved on 30 Sept?$/);
});

test('a current kit: "Open prep kit", rebuilding stays in the ⋯ menu', () => {
  const card = prepCard(item({prep_at: '2026-09-30T15:00:00+00:00', prep_stale: false}), TODAY);
  assert.equal(card.primary.label, 'Open prep kit');
  assert.equal(card.primary.run, 'open');
  assert.equal(card.meta[1], '✓ prep kit ready · built today');
  assert.deepEqual(card.more.map(m => [m.label, m.run]), [['Build the prep kit again', 'build']]);
});

test('no kit yet builds one; a build in progress joins it', () => {
  assert.equal(prepCard(item({}), TODAY).primary.label, 'Build prep kit');
  assert.deepEqual(prepCard(item({}), TODAY).meta, ['Principal SRE', '…']);
  const busy = prepCard(item({building: true, prep_at: '2026-09-29', prep_stale: true}), TODAY);
  assert.equal(busy.primary.label, 'Building…');
  assert.equal(busy.meta[1], 'building the prep kit…');
});
