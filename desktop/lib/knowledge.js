// 🧠 Form knowledge: what Job Pilotto learned from your form fills (learn.js), used by every later kit and fill.
// With Notion connected, the Notion page is the only copy: one bullet per note, which you can read, fix or
// delete there ("[job-boards.greenhouse.io · option] How did you hear: … → "Careers Website""). Notion is required.
import * as learn from './learn.js';
import * as notion from './notion.js';

const INTRO = 'What Job Pilotto learned from your form fills, used by every later kit and fill. Fix or delete a line to change what it does.';
export const line = n => `[${n.scope} · ${n.kind}] ${n.field}: ${n.note}${n.value ? ` → "${n.value}"` : ''}`;
// A bullet back to a note; lines written before kinds were recorded read as answers (with a value) or meanings.
export function parse(text) {
  const match = text.match(/^\[([^\]]+)\]\s*(.+?):\s(.+?)(?:\s→\s"(.*)")?$/);
  if (!match) return null;
  const [scope, kind] = match[1].split(/\s*·\s*/);
  const value = match[4] || '';
  return {scope, kind: kind || (value ? 'answer' : 'meaning'), field: match[2], note: match[3], value};
}

const target = storage => {
  const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
  if (!token || !ids.NOTION_PROFILE_PAGE_ID) throw new Error('Connect Notion first: form knowledge lives there.');
  return {token, ids};
};

export async function notes(storage, fetcher) {
  const t = target(storage);
  if (!t.ids.NOTION_KNOWLEDGE_PAGE) return [];
  return (await notion.textBlocks(t.token, t.ids.NOTION_KNOWLEDGE_PAGE, fetcher))
    .map(block => ({...parse(block.text), block})).filter(n => n.field);
}

async function page(storage, t, fetcher) {
  if (t.ids.NOTION_KNOWLEDGE_PAGE) return t.ids.NOTION_KNOWLEDGE_PAGE;
  const id = await notion.ensurePage(t.token, t.ids.NOTION_PROFILE_PAGE_ID, learn.PAGE_TITLE, INTRO, fetcher);
  storage.saveSettings({notionIds: {...storage.settings().notionIds, NOTION_KNOWLEDGE_PAGE: id}});
  return id;
}

// New notes: a note for the same site + field replaces the old line in place; the rest are appended.
export async function add(storage, fresh, fetcher) {
  const t = target(storage);
  const id = await page(storage, t, fetcher);
  const existing = new Map((await notes(storage, fetcher)).map(n => [learn.knowledgeKey(n), n]));
  const append = [];
  for (const note of fresh) {
    const old = existing.get(learn.knowledgeKey(note));
    if (old) await notion.setBlockText(t.token, old.block, line(note), fetcher);
    else append.push(line(note));
  }
  if (append.length) await notion.appendBullets(t.token, id, append, fetcher);
}
