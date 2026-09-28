// "Answer once": questions Job Pilotto needs you to answer. With Notion connected they are the ❓ lines of
// your standard answers page (the source of truth), and its table rows whose Answer cell is still ❓ ("If a
// salary field is optional | ❓ to confirm — leave blank, or always fill"). The strategy draft writes lines ("Notice period: ❓"),
// and a form fill adds the required questions nothing could answer ("Visa sponsorship needed: ❓ (asked by
// Acme)"). Answering replaces the ❓ with your answer on that same line, so every later kit and fill has it;
// deleting the line in Notion works too. Notion is required (older local lists move there: lib/migrate.js).
import * as notion from './notion.js';

export const NO_ANSWER = 'no answer in the kit, Profile or your details';
export const key = question => String(question || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const ASKED = /\s*\(asked by ([^)]*)\)\s*$/;
const MARK = /❓(\s*\(asked by [^)]*\))?/;

function notionPage(storage) {
  const token = storage.secret('NOTION_TOKEN'), page = storage.settings().notionIds?.NOTION_ANSWERS_PAGE_ID;
  if (!token || !page) throw new Error('Connect Notion first: your questions live in the standard answers page.');
  return {token, page};
}
// A form's "required" marker is not part of the question ("* Nationality", "Postal Code *").
const unmarked = text => String(text || '').replace(/^[\s*]+|[\s*]+$/g, '');
// A ❓ line -> {key: block id, question, company}.
export function parseLine(block) {
  const company = block.text.match(ASKED)?.[1] || '';
  const question = unmarked(block.text.replace(ASKED, '').replace(/❓/g, '').replace(/[\s:—-]+$/, ''));
  return {key: block.id, question, company};
}
// The question part of a line: before its ":" or " — " ("Salary expectation: CHF 130,000" -> "Salary expectation").
const label = text => text.replace(ASKED, '').split(/:\s| — /)[0].replace(/❓/g, '');
export const questionLine = (question, company) => `${question}: ❓${company ? ` (asked by ${company})` : ''}`;
export const answeredLine = (text, answer) => text.replace(MARK, answer);

// A line is a question only when ❓ stands where its answer goes ("Notice period: ❓", "Visa: ❓ (asked by Acme)");
// a sentence that merely mentions ❓ ("Fields marked ❓ to confirm are guesses") is not.
export const isQuestionLine = text => /(^|[:—–-]\s*)❓(\s*\(asked by [^)]*\))?\s*$/.test(text.trim());

// Table rows [Question | Answer] whose answer cell starts with ❓, at the page's top level and one level down.
const cellText = cell => cell.map(t => t.plain_text).join('');
async function openRows(token, pageId, fetcher, depth = 0) {
  const found = [];
  let cursor;
  do {
    const page = await notion.call(token, 'GET', `blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, null, fetcher);
    for (const block of page.results) {
      if (block.type === 'table') {
        const rows = (await notion.call(token, 'GET', `blocks/${block.id}/children?page_size=100`, null, fetcher)).results;
        for (const row of rows.slice(block.table?.has_column_header ? 1 : 0)) {
          const cells = (row.table_row?.cells || []).map(cellText);
          if (cells.length >= 2 && cells[0].trim() && cells[1].trim().startsWith('❓')) found.push({row, cells});
        }
      } else if (block.has_children && depth < 1 && !['child_page', 'child_database'].includes(block.type)) {
        found.push(...await openRows(token, block.id, fetcher, depth + 1));
      }
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return found;
}
const hintOf = answer => answer.replace(/^❓\s*/, '').replace(/^(to confirm|optional)\s*[—:-]?\s*/i, '').trim();

export async function list(storage, fetcher) {
  const target = notionPage(storage);
  const blocks = await notion.textBlocks(target.token, target.page, fetcher);
  const lines = blocks.filter(block => block.text.includes('❓') && isQuestionLine(block.text)).map(parseLine).filter(q => q.question);
  const rows = (await openRows(target.token, target.page, fetcher)).map(({row, cells}) =>
    ({key: row.id, question: unmarked(cells[0].replace(/❓/g, '')), company: '', hint: hintOf(cells[1])}));
  return [...lines, ...rows];
}

// Required fields a fill couldn't answer -> new ❓ lines (skipping any question the page already has).
export async function collect(storage, run, company = '', fetcher) {
  const wanted = (run.trace || []).filter(field => field.required && field.reason === NO_ANSWER && key(field.label));
  if (!wanted.length) return 0;
  const target = notionPage(storage);
  const fresh = [];
  const known = new Set((await notion.textBlocks(target.token, target.page, fetcher)).map(block => key(label(block.text))));
  for (const field of wanted) {
    const k = key(field.label);
    if (known.has(k)) continue;
    known.add(k);
    fresh.push(unmarked(field.label));
  }
  if (!fresh.length) return 0;
  await notion.appendBullets(target.token, target.page, fresh.map(question => questionLine(question, company)), fetcher);
  return fresh.length;
}

// answer '' = skip: the line is removed (not a question to keep an answer for); in a table the row stays and its
// answer becomes "— (leave blank)", so the table keeps the question and forms leave that field empty.
export const SKIPPED = '— (leave blank)';
export async function answer(storage, questionKey, value, fetcher) {
  const target = notionPage(storage);
  const open = (await openRows(target.token, target.page, fetcher)).find(({row}) => row.id === questionKey);
  if (open) {
    const cells = open.row.table_row.cells.map((cell, i) => (i === 1 ? [{type: 'text', text: {content: (value || SKIPPED).slice(0, 1900)}}]
      : cell.map(t => ({type: 'text', text: {content: t.plain_text}, annotations: t.annotations}))));
    await notion.call(target.token, 'PATCH', `blocks/${questionKey}`, {table_row: {cells}}, fetcher);
    return {ok: true};
  }
  const block = (await notion.textBlocks(target.token, target.page, fetcher)).find(b => b.id === questionKey);
  if (!block || !block.text.includes('❓')) return {ok: false, error: 'Already answered in Notion'};
  if (value) await notion.setBlockText(target.token, block, answeredLine(block.text, value), fetcher);
  else await notion.deleteBlock(target.token, block.id, fetcher);
  return {ok: true};
}
