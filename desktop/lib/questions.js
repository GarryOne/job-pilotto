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

// Contact fields (the same labels the fill reads from your Profile's Contact section, extension/page/fill.js
// PROFILE_LABELS): never a question for the answers page. Empty after a fill means your details didn't load (Notion
// busy, an extension error) or aren't in the Profile: 29 Sep 2026 a Canonical fill added "First Name: ❓",
// "Last Name: ❓" and "Email: ❓" to the answers page.
export const CONTACT = /first\s*name|given\s*name|vorname|prénom|last\s*name|family\s*name|surname|nachname|nom de famille|^\s*(full\s*)?name\s*\*?\s*$|full\s*name|e-?mail|phone|mobile|telefon|téléphone|linked\s*in|github|website|portfolio|personal\s*(site|page)|^\s*(current\s*)?(location|city)\b/i;

// Required fields a fill couldn't answer -> new ❓ lines (skipping any question the page already has, and contact
// fields, which come from the Profile).
export async function collect(storage, run, company = '', fetcher) {
  const wanted = (run.trace || []).filter(field => field.required && field.reason === NO_ANSWER && key(field.label) && !CONTACT.test(unmarked(field.label)));
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

// The standard answers page as the app's Standard answers tab shows it: one group per heading, each with its
// questions (table rows [Question | Answer]), its guidance lines (a list under a heading, e.g. "Cover letter
// style", shown as one item) and its ❓ lines (open: an answer is still needed). Read-only; edits happen in Notion.
export async function standardAnswers(storage, fetcher) {
  const {token, page} = notionPage(storage);
  const plain = rich => (rich || []).map(t => t.plain_text).join('');
  const groups = [];
  let group = null;
  const current = () => group || (group = {category: 'General', items: [], notes: []}, groups.push(group), group);
  let cursor;
  do {
    const list = await notion.call(token, 'GET', `blocks/${page}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, null, fetcher);
    for (const block of list.results) {
      const text = plain(block[block.type]?.rich_text).trim();
      if (block.type.startsWith('heading_')) {
        group = {category: text.replace(/\s*\(.*\)\s*$/, ''), items: [], notes: []};
        groups.push(group);
      } else if (block.type === 'table') {
        current().table = true;
        const rows = (await notion.call(token, 'GET', `blocks/${block.id}/children?page_size=100`, null, fetcher)).results;
        for (const row of rows.slice(block.table?.has_column_header ? 1 : 0)) {
          const [question = '', answer = ''] = (row.table_row?.cells || []).map(cellText);
          if (question.trim()) current().items.push({question: question.trim(), answer: answer.trim(), open: answer.trim().startsWith('❓')});
        }
      } else if (text && isQuestionLine(text)) {
        const {question, company} = parseLine({id: block.id, text});
        current().items.push({question, answer: company ? `Asked by ${company}` : '', open: true});
      } else if (text && group && /list_item|paragraph|quote|callout/.test(block.type)) {
        group.notes.push(text);
      }
    }
    cursor = list.has_more ? list.next_cursor : null;
  } while (cursor);
  // A section's guidance lines (no table there) become one item, first; a table section's lines are just its intro.
  for (const each of groups) {
    if (!each.table && each.notes.length) each.items.unshift({question: each.category, answer: each.notes.join('\n'), guidance: true});
  }
  return groups.filter(each => each.items.length).map(({category, items}) => ({category, items}));
}

// A fact Claude asked about in a session ("❓ Bachelor's degree result … Suggested: 8.5/10"), confirmed with one tick:
// it answers that open ❓ line or table row when the page has one, rewrites the line that already gives this
// question an answer, or adds "Question: answer" at the end, so the next kit and fill know it.
export async function remember(storage, question, value, fetcher) {
  const text = unmarked(question), answerText = String(value || '').trim();
  if (!text || !answerText) return {ok: false, error: 'Write an answer first'};
  const target = notionPage(storage), wanted = key(text);
  const open = (await list(storage, fetcher)).find(q => key(q.question) === wanted);
  if (open) return answer(storage, open.key, answerText, fetcher);
  const line = (await notion.textBlocks(target.token, target.page, fetcher)).find(block => /list_item|paragraph/.test(block.type) && key(label(block.text)) === wanted);
  if (line) await notion.setBlockText(target.token, line, `${text}: ${answerText}`, fetcher);
  else await notion.appendBullets(target.token, target.page, [`${text}: ${answerText}`], fetcher);
  return {ok: true};
}
