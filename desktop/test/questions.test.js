// "Answer once" reads real questions only: ❓ where an answer goes, on a line or in a table's Answer cell.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as questions from '../lib/questions.js';
import {createStorage} from '../lib/storage.js';

const rt = text => [{plain_text: text, text: {content: text}, annotations: {bold: false}}];
function page() {
  const rows = [['Question', 'Answer'], ['Notice period', '3 months'],
    ['If a salary field is optional', '❓ to confirm — leave blank, or always fill'], ['Pronunciation', '❓ Optional']];
  const top = [
    {id: 'note', type: 'paragraph', paragraph: {rich_text: rt('Fields marked ❓ to confirm are blanks or guesses — replace them.')}, has_children: false},
    {id: 'line', type: 'bulleted_list_item', bulleted_list_item: {rich_text: rt('Visa sponsorship needed: ❓ (asked by Acme)')}, has_children: false},
    {id: 'table', type: 'table', table: {has_column_header: true}, has_children: true}];
  const cells = rows.map((r, i) => ({id: `row${i}`, type: 'table_row', table_row: {cells: r.map(rt)}}));
  const patched = [];
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const reply = data => ({ok: true, json: async () => data});
    if (route === 'blocks/answers/children') return reply({results: top, has_more: false});
    if (route === 'blocks/table/children') return reply({results: cells, has_more: false});
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      patched.push([route, body]);
      const row = cells.find(c => `blocks/${c.id}` === route);
      if (row) row.table_row.cells = body.table_row.cells.map(c => rt(c[0].text.content));
      return reply({});
    }
    return reply({results: [], has_more: false});
  };
  return {fetcher, patched, cells};
}
function storage() {
  const s = createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
  s.setSecret('NOTION_TOKEN', 'ntn');
  s.saveSettings({notionIds: {NOTION_ANSWERS_PAGE_ID: 'answers'}});
  return s;
}

test('a note that mentions ❓ is not a question; ❓ lines and ❓ table answers are', async () => {
  const {fetcher} = page();
  const open = await questions.list(storage(), fetcher);
  assert.deepEqual(open.map(q => [q.question, q.company, q.hint]), [
    ['Visa sponsorship needed', 'Acme', undefined],
    ['If a salary field is optional', '', 'leave blank, or always fill'],
    ['Pronunciation', '', '']]);
});

test('answering a table question writes the Answer cell; skip keeps the row as "leave blank"', async () => {
  const {fetcher, cells} = page();
  const s = storage();
  const [, salary, pronunciation] = await questions.list(s, fetcher);
  assert.deepEqual(await questions.answer(s, salary.key, 'Always fill: CHF 130,000', fetcher), {ok: true});
  assert.deepEqual(await questions.answer(s, pronunciation.key, '', fetcher), {ok: true});
  assert.deepEqual(cells[2].table_row.cells.map(c => c[0].plain_text), ['If a salary field is optional', 'Always fill: CHF 130,000']);
  assert.equal(cells[3].table_row.cells[1][0].plain_text, questions.SKIPPED);
  assert.equal((await questions.list(s, fetcher)).length, 1);  // only the ❓ line is left
});

test('which lines are questions', () => {
  for (const yes of ['Notice period: ❓', 'Visa: ❓ (asked by Acme)', 'Work permit — ❓', '❓']) assert.ok(questions.isQuestionLine(yes), yes);
  for (const no of ['Fields marked ❓ to confirm are guesses', '❓ Possible CV gaps', 'grade still ❓ to confirm if a form asks']) {
    assert.ok(!questions.isQuestionLine(no), no);
  }
});

test('the Standard answers tab reads the page as groups: table rows, guidance lists, and ❓ lines to answer', async () => {
  const table = (id, rows) => ({id, type: 'table', table: {has_column_header: true}, has_children: true, rows});
  const blocks = [
    {id: 'intro', type: 'paragraph', paragraph: {rich_text: rt('Standard answers for job application forms.')}},
    {id: 'h1', type: 'heading_1', heading_1: {rich_text: rt('Eligibility')}},
    table('t1', [['Question', 'Answer'], ['Authorised to work in Switzerland?', 'Yes — B permit'], ['If a salary field is optional', '❓ to confirm']]),
    {id: 'h2', type: 'heading_1', heading_1: {rich_text: rt('Cover letter style')}},
    {id: 'b1', type: 'bulleted_list_item', bulleted_list_item: {rich_text: rt('Length: 130–170 words.')}},
    {id: 'b2', type: 'bulleted_list_item', bulleted_list_item: {rich_text: rt('Sign-off: just the name.')}},
    {id: 'q1', type: 'bulleted_list_item', bulleted_list_item: {rich_text: rt('Email: ❓ (asked by Acme)')}},
  ];
  const fetcher = async url => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const reply = data => ({ok: true, json: async () => data});
    if (route === 'blocks/answers/children') return reply({results: blocks, has_more: false});
    const found = blocks.find(block => route === `blocks/${block.id}/children`);
    return reply({results: (found?.rows || []).map((cells, i) => ({id: `r${i}`, type: 'table_row', table_row: {cells: cells.map(rt)}})), has_more: false});
  };
  const groups = await questions.standardAnswers(storage(), fetcher);
  assert.deepEqual(groups.map(group => group.category), ['Eligibility', 'Cover letter style']);
  assert.deepEqual(groups[0].items, [
    {question: 'Authorised to work in Switzerland?', answer: 'Yes — B permit', open: false},
    {question: 'If a salary field is optional', answer: '❓ to confirm', open: true}]);
  assert.deepEqual(groups[1].items.map(item => [item.question, item.answer, !!item.open]),
    [['Cover letter style', 'Length: 130–170 words.\nSign-off: just the name.', false], ['Email', 'Asked by Acme', true]]);
});

test('remember: a session\'s ❓ answered with one tick answers the open line, else adds "Question: answer"', async () => {
  const {fetcher: base} = page();
  const writes = [];
  const fetcher = (url, init = {}) => {
    if (init.method === 'PATCH') writes.push([url.replace('https://api.notion.com/v1/', ''), init.body]);
    return base(url, init);
  };
  const s = storage();
  assert.deepEqual(await questions.remember(s, 'Visa sponsorship needed', 'Yes', fetcher), {ok: true});
  assert.equal(writes.at(-1)[0], 'blocks/line');
  assert.match(writes.at(-1)[1], /Visa sponsorship needed: Yes/);
  await questions.remember(s, "Bachelor's degree result", '8.5 / 10', fetcher);
  assert.equal(writes.at(-1)[0], 'blocks/answers/children');
  assert.match(writes.at(-1)[1], /Bachelor's degree result: 8\.5 \/ 10/);
  assert.equal((await questions.remember(s, 'Anything', ' ', fetcher)).ok, false);
});
