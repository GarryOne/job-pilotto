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
