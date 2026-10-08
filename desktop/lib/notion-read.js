// Notion, reading pages: the kept page trees (re-read only when Notion says the page changed), text blocks and readable text, edits to one
// block or table cell, and the copy of the current strategy kept before a new one replaces it. Re-exported by notion.js.
// Guarded by desktop/test/notion-cache.test.js, notion.test.js and notion-fresh.test.js.
// ---------- text blocks of a page (the standard answers' ❓ lines, the 🧠 Form knowledge bullets) ----------
import {call, listChildren, trees, reading, CHECKED_MS, SETTLE_MS, MAX_AGE_MS} from './notion-core.js';
const plainOf = block => (block[block.type]?.rich_text || []).map(t => t.plain_text).join('');
// Every block with text, in page order, down to toggles and nested lists (2 levels): [{id, type, text, parent}].

async function readTree(token, id, fetcher, depth = 0) {
  const blocks = await childrenOf(token, id, fetcher);
  for (const block of blocks) {
    if (block.has_children && depth < 2 && !['child_page', 'child_database'].includes(block.type)) {
      block.children = await readTree(token, block.id, fetcher, depth + 1);
    }
  }
  return blocks;
}
// A page's blocks, two levels deep (children in block.children). cache: on for real Notion calls, off for test fakes.
export async function pageTree(token, pageId, fetcher = globalThis.fetch, {cache = fetcher === globalThis.fetch} = {}) {
  if (!cache) return readTree(token, pageId, fetcher);
  const key = `${token}|${pageId}`;
  if (reading.has(key)) return reading.get(key);
  const job = (async () => {
    const kept = trees.get(key), started = Date.now();
    const young = kept && started - kept.readAt < MAX_AGE_MS;
    if (young && started - kept.checkedAt < CHECKED_MS) return kept.blocks;
    let edited = '';
    try { edited = (await call(token, 'GET', `pages/${pageId}`, null, fetcher)).last_edited_time || ''; } catch { /* not a page: read it */ }
    const settled = edited && Date.now() - Date.parse(edited) > SETTLE_MS;
    if (young && settled && kept.edited === edited) { kept.checkedAt = Date.now(); return kept.blocks; }
    const blocks = await readTree(token, pageId, fetcher);
    trees.set(key, {edited, blocks, checkedAt: Date.now(), readAt: started});
    return blocks;
  })().finally(() => reading.delete(key));
  reading.set(key, job);
  return job;
}
// The text blocks of a page (and of its toggles and lists), with the block each sits in.
export async function textBlocks(token, pageId, fetcher, options) {
  const found = [];
  const walk = (blocks, parent) => {
    for (const block of blocks) {
      if (block[block.type]?.rich_text) found.push({id: block.id, type: block.type, text: plainOf(block), parent});
      if (block.children) walk(block.children, block.id);
    }
  };
  walk(await pageTree(token, pageId, fetcher, options), pageId);
  return found;
}
// Readable text of a page: paragraphs, headings, lists, toggles and table rows ("a | b"), as the AI prompts use it.
export async function pageText(token, pageId, fetcher, options) {
  const lines = [];
  const plain = items => (items || []).map(item => item.plain_text || '').join('');
  const walk = blocks => {
    for (const block of blocks) {
      const body = block[block.type] || {};
      if (block.type === 'table_row') lines.push(body.cells.map(plain).join(' | '));
      else if (body.rich_text) lines.push(plain(body.rich_text));
      if (block.children) walk(block.children);
    }
  };
  walk(await pageTree(token, pageId, fetcher, options));
  return lines.filter(Boolean).join('\n');
}
export async function setBlockText(token, block, text, fetcher) {
  await call(token, 'PATCH', `blocks/${block.id}`, {[block.type]: {rich_text: [{type: 'text', text: {content: text.slice(0, 1900)}}]}}, fetcher);
}
export const deleteBlock = (token, id, fetcher) => call(token, 'DELETE', `blocks/${id}`, null, fetcher);
// One cell of a table row, the other cells kept as they are (their links and bold included): a Profile goal row (lib/goals.js).
export async function setRowCell(token, row, index, text, fetcher) {
  const cells = row.table_row.cells.map((cell, i) => (i === index ? [{type: 'text', text: {content: text.slice(0, 1900)}}]
    : cell.map(item => ({type: 'text', text: {content: item.plain_text || '', ...(item.href ? {link: {url: item.href}} : {})}, annotations: item.annotations}))));
  await call(token, 'PATCH', `blocks/${row.id}`, {table_row: {cells}}, fetcher);
}
// Bullets inserted right after one block (e.g. under a section heading).
export async function insertBulletsAfter(token, pageId, afterId, lines, fetcher) {
  const children = lines.map(line => ({object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: {rich_text: [{type: 'text', text: {content: line.slice(0, 1900)}}]}}));
  if (children.length) await call(token, 'PATCH', `blocks/${pageId}/children`, {children, after: afterId}, fetcher);
}
export async function appendHeading(token, pageId, text, fetcher) {
  const page = await call(token, 'PATCH', `blocks/${pageId}/children`, {children: [{object: 'block', type: 'heading_2',
    heading_2: {rich_text: [{type: 'text', text: {content: text}}]}}]}, fetcher);
  return page.results?.[0]?.id;
}

// ---------- keeping the current strategy before it's replaced ----------
const TEXT_TYPES = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item',
  'to_do', 'toggle', 'quote', 'callout', 'code']);
const plainRich = items => (items || []).map(item => ({type: 'text', text: {content: item.plain_text || '', ...(item.href ? {link: {url: item.href}} : {})},
  annotations: item.annotations}));
const childrenOf = (token, id, fetcher) => listChildren(token, id, fetcher);
// A block the page's list still shows although it is gone (2 Oct 2026: a table of the Profile, 404 "Could not find block"): skipped, never fatal.
const isGone = error => error.status === 404 || /could not find block|archived/i.test(error.message);
// A page's blocks as blocks that can be created elsewhere (text, lists, tables, dividers; nested ones included).
async function copyable(token, id, fetcher, depth = 0) {
  const out = [];
  for (const block of await childrenOf(token, id, fetcher)) {
    const body = block[block.type] || {};
    if (TEXT_TYPES.has(block.type)) {
      const copy = {rich_text: plainRich(body.rich_text)};
      for (const key of ['checked', 'language', 'is_toggleable']) if (key in body) copy[key] = body[key];
      if (block.has_children && depth < 2) {
        try { copy.children = await copyable(token, block.id, fetcher, depth + 1); } catch (error) { if (!isGone(error)) throw error; continue; }
      }
      out.push({object: 'block', type: block.type, [block.type]: copy});
    } else if (block.type === 'divider') {
      out.push({object: 'block', type: 'divider', divider: {}});
    } else if (block.type === 'table') {
      let kids;
      try { kids = await childrenOf(token, block.id, fetcher); } catch (error) { if (!isGone(error)) throw error; continue; }
      const rows = kids.map(row => ({object: 'block', type: 'table_row',
        table_row: {cells: row.table_row.cells.map(plainRich)}}));
      out.push({object: 'block', type: 'table', table: {table_width: body.table_width, has_column_header: body.has_column_header,
        has_row_header: body.has_row_header, children: rows}});
    }
  }
  return out;
}
// "🗂 Previous strategy — <when>" next to the Profile: the current Profile, standard answers and search
// settings, copied before a new strategy replaces them. Returns the new page's id.
export async function snapshotStrategy(token, ids, when, fetcher) {
  const beside = await call(token, 'GET', `pages/${ids.NOTION_PROFILE_PAGE_ID}`, null, fetcher);
  const parent = beside.parent?.page_id;
  if (!parent) throw new Error('The Profile page has no parent page to keep the copy next to');
  const heading = text => ({object: 'block', type: 'heading_1', heading_1: {rich_text: [{type: 'text', text: {content: text}}]}});
  const page = await call(token, 'POST', 'pages', {parent: {page_id: parent}, icon: {type: 'emoji', emoji: '🗂'},
    properties: {title: {title: [{text: {content: `Previous strategy — ${when}`}}]}},
    children: [{object: 'block', type: 'callout', callout: {icon: {type: 'emoji', emoji: '💡'}, rich_text: [{type: 'text', text: {content:
      'Your strategy as it was before you replaced it in the Job Pilotto app. Nothing here is used; copy anything back you want to keep.'}}]}}]}, fetcher);
  for (const [label, id] of [['Profile', ids.NOTION_PROFILE_PAGE_ID], ['Standard answers', ids.NOTION_ANSWERS_PAGE_ID],
    ['Search settings', ids.NOTION_SEARCH_SETTINGS_PAGE]]) {
    if (!id) continue;
    const blocks = [heading(label), ...await copyable(token, id, fetcher)];
    for (let i = 0; i < blocks.length; i += 100) {
      await call(token, 'PATCH', `blocks/${page.id}/children`, {children: blocks.slice(i, i + 100)}, fetcher);
    }
  }
  return page.id.replace(/-/g, '');
}

