// 🧠 Form knowledge: what Job Pilotto learned from your form fills (learn.js), used by every later kit and fill.
// The active store's knowledge page is the only copy (lib/store: a Notion page beside the Profile, or knowledge.md on this Mac):
// one bullet per note, which you can read, fix or delete there ("[job-boards.greenhouse.io · option] How did you hear: … → "Careers Website"").
import * as learn from './learn.js';
import {openStore} from './store/index.js';

export const line = n => `[${n.scope} · ${n.kind}] ${n.field}: ${n.note}${n.value ? ` → "${n.value}"` : ''}`;
// A bullet back to a note; lines written before kinds were recorded read as answers (with a value) or meanings.
export function parse(text) {
  const match = text.match(/^\[([^\]]+)\]\s*(.+?):\s(.+?)(?:\s→\s"(.*)")?$/);
  if (!match) return null;
  const [scope, kind] = match[1].split(/\s*·\s*/);
  const value = match[4] || '';
  return {scope, kind: kind || (value ? 'answer' : 'meaning'), field: match[2], note: match[3], value};
}

const knowledgePage = (storage, fetcher) => openStore(storage, {fetcher}).page('knowledge');

export async function notes(storage, fetcher) {
  return (await knowledgePage(storage, fetcher).blocks()).map(block => ({...parse(block.text), block})).filter(n => n.field);
}

// New notes: a note for the same site + field replaces the old line in place; the rest are appended.
export async function add(storage, fresh, fetcher) {
  const page = knowledgePage(storage, fetcher);
  const existing = new Map((await notes(storage, fetcher)).map(n => [learn.knowledgeKey(n), n]));
  const append = [];
  for (const note of fresh) {
    const old = existing.get(learn.knowledgeKey(note));
    if (old) await page.setText(old.block, line(note));
    else append.push(line(note));
  }
  if (append.length) await page.append(append);
}
