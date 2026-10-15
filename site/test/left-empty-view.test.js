// The look of "Why fields were left empty": each row's tone, the stacked headline, the bars, the pills, the empty and thin states, and the weights table of the Resolution section.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BUCKETS, splitGaps} from '../src/answer-gaps.js';
import {GROUPS, leftEmptySection, tally, withRequired} from '../src/left-empty.js';
import {BUCKET_TONE, GROUP_TONE, LEFT_EMPTY_CSS, bucketsTable, headlineBar} from '../src/left-empty-view.js';

const model = {side: 'lab', days: 14, sample: null, ...withRequired(tally({no_answer: 60, real_click: 10, unread: 5, other: 1}), 200, 124), gaps: splitGaps({'salary:no_answer:gap': 5, 'legal:no_answer:design': 3, 'contact:proposed:gap': 2})};

test('every group and bucket has a tone, and every tone has a colour from the page tokens only', () => {
  for (const group of GROUPS) assert.ok(GROUP_TONE[group.key], `${group.key} has a tone`);
  for (const bucket of BUCKETS) assert.ok(BUCKET_TONE[bucket.key], `${bucket.key} has a tone`);
  assert.deepEqual(GROUP_TONE, {answer: 'gap', read: 'bad', control: 'bad', other: 'none'});
  assert.deepEqual(BUCKET_TONE, {suggested: 'wait', purpose: 'held', gap: 'gap'});
  assert.doesNotMatch(LEFT_EMPTY_CSS, /#[0-9a-f]{3,8}\b|rgb\(/i, 'no raw colour: tokens only');
  for (const tone of new Set([...Object.values(GROUP_TONE), ...Object.values(BUCKET_TONE), 'good'])) assert.match(LEFT_EMPTY_CSS, new RegExp(`\\.t-${tone}[,{]`), `${tone} is drawn`);
});

test('each row of both tables carries its tone, a share bar and its words as pills', () => {
  const html = leftEmptySection(model, {wrap: 'bare'});
  for (const [key, tone] of Object.entries(GROUP_TONE)) assert.ok(html.includes(`class="row t-${tone}"><td>${GROUPS.find(group => group.key === key).title}`), `group ${key} is ${tone}`);
  for (const bucket of BUCKETS) assert.ok(html.includes(`class="row t-${BUCKET_TONE[bucket.key]}"><td>${bucket.title}`), `bucket ${bucket.key}`);
  assert.match(html, /<span class="bar" aria-hidden="true"><i style="width:79%"><\/i><\/span>79%/, 'one bar per share, drawn on the same 100% scale');
  assert.match(html, /<span class="wpill t-gap">no_answer<span class="cnt">60<\/span><\/span>/);
  assert.match(html, /<span class="wpill t-held">consent \/ legal<span class="cnt">3<\/span><\/span>/);
});

test('the headline is one stacked bar and a legend; its sentence stays for the screen reader; the intro is one line and the rest folds', () => {
  const bar = headlineBar(model);
  assert.match(bar, /aria-label="200 required fields · 62% filled · 30% left with no answer · 5% lost to controls · 3% not read"/);
  assert.equal((bar.match(/<i class="t-/g) || []).length, 5, 'filled, no answer, controls, not read, other');
  const html = leftEmptySection(model, {wrap: 'bare'});
  assert.match(html, /<details><summary>How this is counted<\/summary>[^]*fill_reasons/);
  assert.doesNotMatch(html.split('<details>')[0], /fill_reasons/, 'the line above the fold is short');
});

test('empty states: no left fields, no meaning words, thin real use shows counts without bars', () => {
  const empty = leftEmptySection({side: 'lab', days: 14, total: 0, groups: [], sample: null, gaps: {total: 0, buckets: []}}, {wrap: 'bare'});
  assert.match(empty, /No left fields reported in this period/);
  assert.match(empty, /No meaning words yet/);
  const thin = leftEmptySection({...model, side: 'real', sample: {forms: 2, installs: 1, enough: false}}, {wrap: 'bare'});
  assert.doesNotMatch(thin, /class="bar"|\d+%/, 'counts only');
  assert.match(bucketsTable(model.gaps, true), /class="row t-wait muted"/);
});
