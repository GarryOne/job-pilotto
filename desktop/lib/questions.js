// "Answer once": questions Job Pilotto needs you to answer. With Notion connected they are the ❓ lines of
// your standard answers page (the source of truth): the strategy draft writes some ("Notice period: ❓"),
// and a form fill adds the required questions nothing could answer ("Visa sponsorship needed: ❓ (asked by
// Acme)"). Answering replaces the ❓ with your answer on that same line, so every later kit and fill has it;
// deleting the line in Notion works too. Without Notion they wait in settings.json (openQuestions).
import * as notion from './notion.js';

export const NO_ANSWER = 'no answer in the kit, Profile or your details';
export const key = question => String(question || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const ASKED = /\s*\(asked by ([^)]*)\)\s*$/;
const MARK = /❓(\s*\(asked by [^)]*\))?/;

function notionPage(storage) {
  const token = storage.secret('NOTION_TOKEN'), page = storage.settings().notionIds?.NOTION_ANSWERS_PAGE_ID;
  return token && page ? {token, page} : null;
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

export async function list(storage, fetcher) {
  const target = notionPage(storage);
  if (!target) return storage.settings().openQuestions || [];
  const blocks = await notion.textBlocks(target.token, target.page, fetcher);
  return blocks.filter(block => block.text.includes('❓')).map(parseLine).filter(q => q.question);
}

// Required fields a fill couldn't answer -> new ❓ lines (skipping any question the page already has).
export async function collect(storage, run, company = '', fetcher) {
  const wanted = (run.trace || []).filter(field => field.required && field.reason === NO_ANSWER && key(field.label));
  if (!wanted.length) return 0;
  const target = notionPage(storage);
  const fresh = [];
  const known = new Set(target
    ? (await notion.textBlocks(target.token, target.page, fetcher)).map(block => key(label(block.text)))
    : (storage.settings().openQuestions || []).map(q => q.key));
  for (const field of wanted) {
    const k = key(field.label);
    if (known.has(k)) continue;
    known.add(k);
    fresh.push(unmarked(field.label));
  }
  if (!fresh.length) return 0;
  if (target) await notion.appendBullets(target.token, target.page, fresh.map(question => questionLine(question, company)), fetcher);
  else storage.saveSettings({openQuestions: [...(storage.settings().openQuestions || []),
    ...fresh.map(question => ({key: key(question), question, company, url: run.url, at: new Date().toISOString()}))]});
  return fresh.length;
}

// answer '' = skip: the line is removed (not a question to keep an answer for).
export async function answer(storage, questionKey, value, fetcher) {
  const target = notionPage(storage);
  if (!target) {
    const open = storage.settings().openQuestions || [];
    if (!open.some(q => q.key === questionKey)) return {ok: false, error: 'Already answered'};
    if (value) return {ok: false, error: 'Connect Notion first: answers are saved in your standard answers page.'};
    storage.saveSettings({openQuestions: open.filter(q => q.key !== questionKey)});
    return {ok: true};
  }
  const block = (await notion.textBlocks(target.token, target.page, fetcher)).find(b => b.id === questionKey);
  if (!block || !block.text.includes('❓')) return {ok: false, error: 'Already answered in Notion'};
  if (value) await notion.setBlockText(target.token, block, answeredLine(block.text, value), fetcher);
  else await notion.deleteBlock(target.token, block.id, fetcher);
  return {ok: true};
}
