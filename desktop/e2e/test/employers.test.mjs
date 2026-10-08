// The employers suite's checks and its Sonnet judge are only worth anything if they fail on a wrong input: each test feeds a deliberately broken one.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {blank, byQuality, duplicates, EXPECTED, parseRunLine, rowProblems} from '../lib/employers.mjs';
import {buildRequest, judge, parseVerdicts, problems} from '../lib/judge.mjs';
import {flatten} from '../lib/notion.mjs';

const good = {Company: 'E2E Nimbus', 'Feed status': 'Feed found', ATS: 'greenhouse', Slug: 'e2e-nimbus', Feed: 'https://x', Quality: 76, Cities: 'Zurich', 'Relevant roles': 4,
  'In preferred places': 4, Notes: '5 postings; 4 SRE-type; 4 in preferred places', Origin: 'Tier 1 seed', Tier: 'Tier 1', Checked: '2026-10-02', Added: '2026-10-02', Active: true};

test('a complete row passes, and each broken one is named', () => {
  assert.deepEqual(rowProblems(good, 'found'), []);
  assert.match(rowProblems({...good, Notes: ''}, 'found').join(), /"Notes" is empty/);
  assert.match(rowProblems({...good, Cities: 'undefined'}, 'found').join(), /"Cities" is empty/);
  assert.match(rowProblems({...good, Notes: '5 postings; undefined SRE-type'}, 'found').join(), /says/);
  assert.match(rowProblems({...good, Quality: 0}, 'found').join(), /outside 1 to 100/);
  assert.match(rowProblems({...good, Quality: null}, 'found').join(), /"Quality" is empty/);
  assert.match(rowProblems({...good, 'In preferred places': 9}, 'found').join(), /more roles in preferred places/);
  assert.match(rowProblems({...good, Slug: null}, 'found').join(), /"Slug" is empty/);
});

test('a manual-watch row needs its careers link, a no-feed row only its name and status', () => {
  const quiet = {Company: 'E2E Quiet', 'Feed status': 'Manual watch', Careers: 'https://quiet.e2e.test/careers', Origin: 'Tier 1 seed (no public feed)', Tier: 'Tier 1', Checked: '2026-10-02'};
  assert.deepEqual(rowProblems(quiet, 'manual'), []);
  assert.match(rowProblems({...quiet, Careers: null}, 'manual').join(), /"Careers" is empty/);
  assert.deepEqual(rowProblems({Company: 'E2E Ghost', 'Feed status': 'No public feed', Origin: 'Tier 1 seed', Tier: 'Tier 1', Checked: '2026-10-02'}, 'none'), []);
  assert.match(rowProblems({Company: 'E2E Ghost', 'Feed status': 'No public feed'}, 'none').join(), /"Origin" is empty/);
});

test('blank means empty, whitespace or a leaked "undefined"', () => {
  for (const value of [null, undefined, '', '  ', 'undefined', 'NULL', NaN]) assert.equal(blank(value), true, String(value));
  for (const value of ['Zurich', 0, 76, false]) assert.equal(blank(value), false, String(value));
});

test("the run line is read as numbers, and a line that says neither is not guessed at", () => {
  assert.deepEqual(parseRunLine('checked 7 · 🆕 2 new sources'), {checked: 7, added: 2});
  assert.deepEqual(parseRunLine('checked 0 · 🆕 0 new sources'), {checked: 0, added: 0});
  assert.deepEqual(parseRunLine('New employer sources · 7 checked · 2 new sources'), {checked: 7, added: 2});   // the card wording of 5 Oct 2026
  assert.equal(parseRunLine('New employer sources (AI cost $0.003)'), null, 'a headline with no counts says neither');
  assert.deepEqual(parseRunLine('checked 7 · 1 new source'), {checked: 7, added: 1});
  assert.deepEqual(parseRunLine('2 new feeds'), {checked: null, added: 2});
  assert.equal(parseRunLine('Done.'), null);
  assert.equal(parseRunLine(''), null);
  assert.equal(parseRunLine(undefined), null);
});

test('duplicates are found by name, ignoring case; quality orders best first; the expectations cover every kind of candidate', () => {
  assert.deepEqual(duplicates([{Company: 'E2E Orbit'}, {Company: 'e2e orbit '}, {Company: 'E2E Nimbus'}]), ['e2e orbit']);
  assert.deepEqual(duplicates([{Company: 'A'}, {Company: 'B'}]), []);
  assert.deepEqual(byQuality([{Company: 'low', Quality: 10}, {Company: 'high', Quality: 80}]), ['high', 'low']);
  assert.deepEqual([...new Set(Object.values(EXPECTED).map(item => item.status))].sort(), ['duplicate', 'excluded', 'found', 'low', 'manual', 'none']);
});

test('a Notion row is flattened to plain values', () => {
  const row = flatten({id: 'x', properties: {Company: {type: 'title', title: [{plain_text: 'E2E '}, {plain_text: 'Nimbus'}]}, Quality: {type: 'number', number: 76}, Active: {type: 'checkbox', checkbox: true},
    'Feed status': {type: 'select', select: {name: 'Feed found'}}, Notes: {type: 'rich_text', rich_text: []}, Feed: {type: 'url', url: null}, Checked: {type: 'date', date: {start: '2026-10-02'}}}});
  assert.deepEqual(row, {_id: 'x', Company: 'E2E Nimbus', Quality: 76, Active: true, 'Feed status': 'Feed found', Notes: '', Feed: null, Checked: '2026-10-02'});
});

test('the judge: a request without temperature, a verdict only in the fixed shape, and a rejection or silence is never a pass', () => {
  const request = buildRequest({person: 'an SRE in Zurich', items: [{name: 'A'}]});
  assert.equal(request.model, process.env.E2E_JUDGE_MODEL || 'claude-haiku-5-5', 'Haiku unless a suite asks (7 Oct 2026, "$30 a week")');
  assert.ok(!('temperature' in request));
  assert.match(request.messages[0].content, /SRE in Zurich[\s\S]*"name": "A"/);
  const verdicts = parseVerdicts('ok: ' + JSON.stringify({items: [{name: 'A', makes_sense: true, reason: 'fits'}, {name: 'B', makes_sense: 'yes'}, {makes_sense: false}, null, {name: 'C', makes_sense: false, reason: 'sales roles in Berlin'}]}));
  assert.deepEqual(verdicts.map(item => item.name), ['A', 'C']);
  assert.deepEqual(parseVerdicts('no json'), []);
  assert.deepEqual(problems(['A'], verdicts), []);
  assert.match(problems(['C'], verdicts).join(), /sales roles in Berlin/);
  assert.match(problems(['B'], verdicts).join(), /no verdict on B/);
  assert.match(problems(['A'], []).join(), /no verdict/);
});

test('the judge call fails loudly when the request is rejected', async () => {
  const rejected = async () => ({ok: false, status: 400, json: async () => ({error: {message: '`temperature` is deprecated for this model'}})});
  await assert.rejects(judge({key: 'k', person: 'p', items: [], fetchImpl: rejected}), /rejected \(400\).*temperature/);
  const answered = async () => ({ok: true, status: 200, json: async () => ({content: [{type: 'text', text: '{"items":[{"name":"A","makes_sense":false,"reason":"wrong city"}]}'}]})});
  assert.deepEqual(await judge({key: 'k', person: 'p', items: [], fetchImpl: answered}), [{name: 'A', makes_sense: false, reason: 'wrong city'}]);
});
