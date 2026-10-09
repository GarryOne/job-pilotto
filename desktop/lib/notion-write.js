// Notion, writing pages: Markdown to blocks, rewriting a page in place (patch plan, delete passes, leftover sweep), appending answers,
// bullets and headings' siblings, finding or creating a page beside another. Re-exported by notion.js.
// Guarded by desktop/test/notion.test.js, notion-existing-page.test.js, notion-truth.test.js and strategy-rebuild.test.js.
// ---------- writing a page from Markdown (headings, lists, paragraphs, tables, **bold**, `code`) ----------
import {log} from './log.js';
import {call, listBlocks, listChildren, liveOnly, normalise, searchAll, titleOf} from './notion-core.js';
const rich = text => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map(piece => {
  const bold = piece.startsWith('**'), code = piece.startsWith('`');
  const content = bold ? piece.slice(2, -2) : code ? piece.slice(1, -1) : piece;
  return {type: 'text', text: {content: content.slice(0, 2000)}, annotations: {bold, code}};
});

export function markdownBlocks(text) {
  const blocks = [];
  let table = [];
  const flush = () => {
    const rows = table.filter(row => !/^\|\s*:?-/.test(row)).map(row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    if (rows.length) {
      const width = Math.max(...rows.map(r => r.length));
      blocks.push({type: 'table', table: {table_width: width, has_column_header: true, has_row_header: false,
        children: rows.map(r => ({type: 'table_row', table_row: {cells: [...r, ...Array(width - r.length).fill('')].map(rich)}}))}});
    }
    table = [];
  };
  // CRLF too: the Search settings page is the engine's stdout, which Python writes with \r\n on Windows; a kept \r made every bullet differ from
  // the page (Notion drops it), so each save rewrote the whole page (7 Oct 2026, the Windows strategy suite).
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('|')) { table.push(line); continue; }
    flush();
    if (!line.trim()) continue;
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading) { const type = `heading_${heading[1].length}`; blocks.push({type, [type]: {rich_text: rich(heading[2])}}); }
    else if (/^\s*[-*]\s+/.test(line)) blocks.push({type: 'bulleted_list_item', bulleted_list_item: {rich_text: rich(line.replace(/^\s*[-*]\s+/, ''))}});
    else if (/^\s*\d+\.\s+/.test(line)) blocks.push({type: 'numbered_list_item', numbered_list_item: {rich_text: rich(line.replace(/^\s*\d+\.\s+/, ''))}});
    else blocks.push({type: 'paragraph', paragraph: {rich_text: rich(line.trim())}});
  }
  flush();
  return blocks;
}

// Replace a page's content with the Markdown (its old text blocks go to Notion's trash, recoverable; KEPT blocks stay).
// Replace a page's content: delete its blocks, then append the new ones. onProgress(done, total) counts
// both. A block that's already gone (e.g. removed by an earlier, interrupted save) is skipped.
// One rewrite of a page at a time. Two at once both read the same old blocks, both delete them and both append, so the page ends up with
// every section twice (the doubled search settings of 1 Oct 2026). A later write waits for the earlier one on the same page.
const pageWrites = new Map();
export function writePage(token, pageId, markdown, fetcher, onProgress) {
  const run = (pageWrites.get(pageId) || Promise.resolve()).catch(() => {}).then(() => writePageNow(token, pageId, markdown, fetcher, onProgress));
  pageWrites.set(pageId, run);
  run.catch(() => {}).then(() => { if (pageWrites.get(pageId) === run) pageWrites.delete(pageId); });
  return run;
}
// Notion answers "Can't edit block that is archived" to a DELETE of a block that is still on the page (seen 2 Oct 2026: two thirds of a page's
// blocks, the rest deleted fine), so an old copy survived and the new one was appended beside it: every Search settings section twice, and the
// two copies merged into one setting list. So a delete is never trusted: the page is read again, and what is still there is deleted again
// (a few passes) before anything is appended.
const isAlive = async (token, id, fetcher) => {
  try {
    const block = await call(token, 'GET', `blocks/${id}`, null, fetcher);
    return !block.archived && !block.in_trash;
  } catch (error) {
    if (error.status === 404 || /archived|could not find/i.test(error.message)) return false;
    throw error;
  }
};
const DELETE_PASSES = 4;
export const rewriteTuning = {waitMs: 1500};   // between delete passes (a test sets 0)
// What a block says, to tell an unchanged block from a changed one: its type and its text with bold and code. A block that can't be compared that
// way (a table, one with children, one the listing gave no content for) never matches, so it is always replaced.
const COMPARABLE = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item'];
// Blocks that are not the page's text (the Profile's 📎 CV file, a child page such as ⚙️ Search settings, a linked database): Markdown cannot say
// them, so a rewrite never deletes them (deleting a child page's block archives the page itself) and the new text goes in around them.
// The same list as src/stores/notion_texts.py KEPT (desktop/test/notion-write-kept.test.js checks they agree).
export const KEPT = ['child_page', 'child_database', 'link_to_page', 'file', 'pdf', 'image', 'video', 'audio', 'embed', 'bookmark',
  'synced_block', 'column_list', 'table_of_contents', 'breadcrumb'];
export const isKept = block => KEPT.includes(block?.type);
const textOnly = blocks => blocks.filter(block => !isKept(block));
export function blockSignature(block) {
  const body = block?.[block?.type];
  if (!COMPARABLE.includes(block?.type) || block.has_children || !Array.isArray(body?.rich_text)) return null;
  return JSON.stringify([block.type, body.rich_text.map(part => [part.text?.content ?? part.plain_text ?? '', !!part.annotations?.bold, !!part.annotations?.code])]);
}
// Only what changed (owner, 7 Oct 2026: one place removed from ⚙️ Search settings took 71 s, its 107 blocks deleted and written again one by
// one): the blocks the page and the new content share, in order (their longest common run), stay; the others are deleted, and each run of new
// blocks goes in after the kept (or just inserted) block before it. null when a new block would come before every kept one (Notion inserts only
// after a block): the page is rewritten whole. A kept block (KEPT) stays where it is and anchors the new blocks after it.
export function patchPlan(old, blocks) {
  const was = old.map(blockSignature), now = blocks.map(blockSignature);
  const same = (i, j) => was[i] !== null && was[i] === now[j];
  const lcs = Array.from({length: was.length + 1}, () => new Array(now.length + 1).fill(0));
  for (let i = was.length - 1; i >= 0; i--) for (let j = now.length - 1; j >= 0; j--) lcs[i][j] = same(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const remove = [], inserts = [];
  let i = 0, j = 0, after = null, run = null;
  while (i < was.length || j < now.length) {
    if (i < was.length && isKept(old[i])) { after = old[i].id; run = null; i++; }
    else if (i < was.length && j < now.length && same(i, j)) { after = old[i].id; run = null; i++; j++; }
    else if (j < now.length && (i >= was.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      if (!after) return null;
      if (!run) inserts.push(run = {after, blocks: []});
      run.blocks.push(blocks[j]); j++;
    } else { remove.push(old[i].id); i++; }
  }
  return {remove, inserts};
}
async function patchPage(token, pageId, blocks, old, fetcher, onProgress) {
  const plan = patchPlan(old, blocks);
  if (!plan) return false;
  const total = plan.remove.length + plan.inserts.reduce((sum, run) => sum + Math.ceil(run.blocks.length / 100), 0);
  let done = 0;
  for (const id of plan.remove) {
    try { await call(token, 'DELETE', `blocks/${id}`, null, fetcher); }
    catch (error) { if (!(error.status === 404 || /archived/i.test(error.message))) throw error; }
    onProgress(++done, total);
  }
  for (const run of plan.inserts) {
    let after = run.after;
    for (let k = 0; k < run.blocks.length; k += 100) {
      const reply = await call(token, 'PATCH', `blocks/${pageId}/children`, {children: run.blocks.slice(k, k + 100), after}, fetcher);
      after = reply?.results?.at(-1)?.id || after;
      onProgress(++done, total);
    }
  }
  // Trusted only when the page now reads exactly as the new content (Notion's list can lag, a delete can not stick): else the whole rewrite.
  const read = textOnly(await listBlocks(token, pageId, fetcher)), now = read.map(blockSignature);
  const at = now.length === blocks.length ? now.findIndex((signature, k) => signature === null || signature !== blockSignature(blocks[k])) : Math.min(now.length, blocks.length);
  if (at < 0) return true;
  // Where it differed, never what it says: the first block that did not read back, its type each way, and the counts (the Windows \r of 7 Oct 2026 took a CI run to find).
  log('notion', 'page patch read back differently', {page: String(pageId).slice(0, 8), at, sent: blocks.length, read: read.length, sentType: blocks[at]?.type || '', readType: read[at]?.type || ''});
  return false;
}
async function writePageNow(token, pageId, markdown, fetcher, onProgress = () => {}) {
  const blocks = markdownBlocks(markdown);
  const before = await listBlocks(token, pageId, fetcher);
  {
    const started = Date.now();
    if (await patchPage(token, pageId, blocks, before, fetcher, onProgress)) {
      log('notion', 'page patched', {page: String(pageId).slice(0, 8), blocks: blocks.length, changed: (plan => plan ? plan.remove.length + plan.inserts.reduce((sum, run) => sum + run.blocks.length, 0) : null)(patchPlan(before, blocks)), ms: Date.now() - started});
      return blocks.length;
    }
    if (patchPlan(before, blocks)) log('notion', 'page patch did not read back as written: rewritten whole', {page: String(pageId).slice(0, 8)});
  }
  const batches = Math.ceil(blocks.length / 100);
  let old = textOnly(patchPlan(before, blocks) ? await listBlocks(token, pageId, fetcher) : before);   // a patch tried and failed changed the page: read it again
  const total = old.length + batches;
  let done = 0;
  for (let pass = 1; old.length; pass++) {
    for (const block of old) {
      try {
        await call(token, 'DELETE', `blocks/${block.id}`, null, fetcher);
      } catch (error) {
        if (!(error.status === 404 || /archived/i.test(error.message))) throw error;
      }
      onProgress(Math.min(++done, total - batches), total);
    }
    old = textOnly(await listBlocks(token, pageId, fetcher));
    if (old.length && pass >= DELETE_PASSES) {
      // A block can stay in a page's list after it is gone (Notion's list lags, and a deleted block answers "archived"): only a block that
      // is still alive means the page was not emptied.
      const alive = [];
      for (const block of old) if (await isAlive(token, block.id, fetcher)) alive.push(block);
      if (alive.length) throw new Error(`Notion kept ${alive.length} old block(s) of the page after ${pass} deletes; the page was not rewritten`);
      old = [];
    }
    if (old.length) await new Promise(resolve => setTimeout(resolve, rewriteTuning.waitMs * pass));
  }
  const added = new Set();
  for (let i = 0; i < blocks.length; i += 100) {
    const reply = await call(token, 'PATCH', `blocks/${pageId}/children`, {children: blocks.slice(i, i + 100)}, fetcher);
    for (const block of reply?.results || []) added.add(block.id);
    onProgress(++done, total);
  }
  await sweepLeftovers(token, pageId, added, fetcher);
  return blocks.length;
}
// Notion can list a page's blocks from before its previous rewrite: the first read missed blocks, nothing of them was deleted and the
// new content landed beside the old (a setting then read "5" above the new "3"). Once the new blocks are in, list again and delete
// whatever is not one of them; a few rounds, because the second listing can lag too. (Skipped when Notion did not return the new ids.)
async function sweepLeftovers(token, pageId, added, fetcher) {
  if (!added.size) return;
  for (let round = 0; round < 4; round++) {
    const stale = (await listChildren(token, pageId, fetcher)).filter(block => !added.has(block.id) && !isKept(block));
    if (!stale.length) return;
    for (const block of stale) {
      try { await call(token, 'DELETE', `blocks/${block.id}`, null, fetcher); }
      catch (error) { if (!(error.status === 404 || /archived/i.test(error.message))) throw error; }
    }
  }
}

// One "Question — Answer" line at the end of a page (the standard answers).
export async function appendAnswer(token, pageId, question, answer, fetcher) {
  const text = `${question} — ${answer}`.slice(0, 1900);
  await call(token, 'PATCH', `blocks/${pageId}/children`, {children: [{object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: {rich_text: [{type: 'text', text: {content: text}}]}}]}, fetcher);
}

// The 🧠 Form knowledge page: created once next to the Profile page (same parent), then reused.
// The page with this title that already sits beside `besideId` (same parent folder), or null. Emoji and case do not matter. A workspace that is connected
// again (a reinstall, a second Mac, a reset) already has these pages: finding them keeps the person's own content and never makes a duplicate.
export async function findPageBeside(token, besideId, title, fetcher) {
  const beside = await call(token, 'GET', `pages/${besideId}`, null, fetcher);
  const parentId = beside.parent?.page_id;
  if (!parentId) return null;
  const want = normalise(title), same = id => String(id || '').replace(/-/g, '') === parentId.replace(/-/g, '');
  // The parent's own child list first: Notion's search lags behind a page made a moment ago, and a reconnect in that window made a second copy.
  let cursor;
  do {
    const listed = await call(token, 'GET', `blocks/${parentId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, null, fetcher);
    const hit = (listed.results || []).find(block => block.type === 'child_page' && normalise(block.child_page?.title || '') === want);
    if (hit) return hit.id.replace(/-/g, '');
    cursor = listed.has_more ? listed.next_cursor : null;
  } while (cursor);
  const [, pages] = liveOnly([], await searchAll(token, 'page', fetcher));
  const found = pages.find(item => same(item.parent?.page_id) && normalise(titleOf(item)) === want);
  return found ? found.id.replace(/-/g, '') : null;
}

// Creates the page beside `besideId` only when there is none yet.
export async function ensurePage(token, besideId, title, intro, fetcher) {
  const existing = await findPageBeside(token, besideId, title, fetcher);
  if (existing) return existing;
  const beside = await call(token, 'GET', `pages/${besideId}`, null, fetcher);
  const parent = beside.parent?.page_id ? {page_id: beside.parent.page_id} : null;
  if (!parent) throw new Error('The Profile page has no parent page to put Form knowledge next to');
  const icon = title.split(' ')[0], name = title.slice(icon.length).trim();
  const page = await call(token, 'POST', 'pages', {parent, icon: {type: 'emoji', emoji: icon},
    properties: {title: {title: [{text: {content: name}}]}},
    children: [{object: 'block', type: 'paragraph', paragraph: {rich_text: [{type: 'text', text: {content: intro}}]}}]}, fetcher);
  return page.id.replace(/-/g, '');
}

export async function appendBullets(token, pageId, lines, fetcher) {
  const children = lines.map(line => ({object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: {rich_text: [{type: 'text', text: {content: line.slice(0, 1900)}}]}}));
  for (let i = 0; i < children.length; i += 100) {
    await call(token, 'PATCH', `blocks/${pageId}/children`, {children: children.slice(i, i + 100)}, fetcher);
  }
}

export const pageUrl = id => `https://www.notion.so/${String(id).replace(/-/g, '')}`;
