// The user's Notion is their Job Pilotto interface. This module connects the app to their copy of the
// template: finds each database and page by title (config/notion_template.json), checks the columns
// the pipeline needs, and writes pages (the drafted Profile and standard answers).
import fs from 'node:fs';
import path from 'node:path';
import {REPO} from './pipeline.js';

const API = 'https://api.notion.com/v1/';
export const TEMPLATE = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'notion_template.json'), 'utf8'));

async function call(token, method, route, body, fetcher = globalThis.fetch) {
  const response = await fetcher(API + route, {
    method,
    headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || `Notion ${response.status}`), {status: response.status});
  return data;
}

// Titles compared without emoji, punctuation spacing or case: "💠 Applications — Job Tracker" = "Applications — Job Tracker".
export const normalise = title => title.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
const titleOf = item => (item.object === 'database' ? item.title : Object.values(item.properties || {})
  .find(p => p.type === 'title')?.title || []).map(t => t.plain_text).join('');

async function searchAll(token, kind, fetcher) {
  const found = [];
  let cursor;
  do {
    const page = await call(token, 'POST', 'search', {filter: {property: 'object', value: kind}, page_size: 100,
      ...(cursor ? {start_cursor: cursor} : {})}, fetcher);
    found.push(...page.results.filter(item => !item.archived && !item.in_trash));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return found;
}

// {ids: {NOTION_APPLICATIONS_DB: id, ...}, missing: [titles]}. A workspace may hold more than one copy
// (an old duplicate, or the owner's live pages next to the template): items are grouped by the page
// they sit in, and the group holding the most of them wins (then the most recently edited), so the
// app never mixes databases from two copies.
export async function discover(token, fetcher) {
  const [databases, pages] = await Promise.all([searchAll(token, 'database', fetcher), searchAll(token, 'page', fetcher)]);
  const wanted = [...Object.entries(TEMPLATE.databases).map(([env, title]) => [env, title, databases]),
    ...Object.entries(TEMPLATE.pages).map(([env, title]) => [env, title, pages])];
  const parentOf = item => item.parent?.page_id || item.parent?.database_id || item.parent?.type || 'workspace';
  const groups = new Map();
  for (const [env, title, items] of wanted) {
    for (const item of items.filter(i => normalise(titleOf(i)) === normalise(title))) {
      const group = groups.get(parentOf(item)) || {ids: {}, newest: ''};
      if (!group.ids[env] || item.last_edited_time > group.newestFor?.[env]) {
        group.ids[env] = item.id.replace(/-/g, '');
        group.newestFor = {...group.newestFor, [env]: item.last_edited_time};
      }
      if (item.last_edited_time > group.newest) group.newest = item.last_edited_time;
      groups.set(parentOf(item), group);
    }
  }
  const best = [...groups.values()].sort((a, b) =>
    Object.keys(b.ids).length - Object.keys(a.ids).length || b.newest.localeCompare(a.newest))[0] || {ids: {}};
  const ids = best.ids;
  const missing = wanted.filter(([env]) => !ids[env]).map(([, title]) => title);
  return {ids, missing};
}

// Columns the pipeline needs that the user's copy lacks (renamed or deleted): [{title, missing: [...]}].
export async function checkColumns(token, ids, fetcher) {
  const problems = [];
  for (const [env, required] of Object.entries(TEMPLATE.required_properties)) {
    if (!ids[env]) continue;
    const database = await call(token, 'GET', `databases/${ids[env]}`, null, fetcher);
    const missing = required.filter(name => !(name in database.properties));
    if (missing.length) problems.push({title: TEMPLATE.databases[env], missing});
  }
  return problems;
}

export async function connect(token, fetcher) {
  await call(token, 'GET', 'users/me', null, fetcher); // is the token valid at all?
  const {ids, missing} = await discover(token, fetcher);
  const problems = missing.length ? [] : await checkColumns(token, ids, fetcher);
  return {ok: !missing.length && !problems.length, ids, missing, problems};
}

// Right after the user gives the connection access, Notion shares the page's databases over a minute
// or so: while some are found and others not yet, wait and look again instead of failing.
export async function connectWaiting(token, {fetcher, onProgress = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)),
  tries = 8, every = 10000, check = connect} = {}) {
  let result;
  for (let attempt = 1; attempt <= tries; attempt++) {
    result = await check(token, fetcher);
    const found = Object.keys(result.ids).length;
    const waiting = result.missing.length && (found > 0 || attempt <= 2);  // nothing at all twice: not shared
    if (!waiting || attempt === tries) return result;
    onProgress({found, total: found + result.missing.length, ids: result.ids});
    await sleep(every);
  }
  return result;
}

// ---------- writing a page from Markdown (headings, lists, paragraphs, tables, **bold**, `code`) ----------
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
  for (const line of text.split('\n')) {
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

// Replace a page's content with the Markdown (its old blocks go to Notion's trash, recoverable).
// Replace a page's content: delete its blocks, then append the new ones. onProgress(done, total) counts
// both. A block that's already gone (e.g. removed by an earlier, interrupted save) is skipped.
export async function writePage(token, pageId, markdown, fetcher, onProgress = () => {}) {
  let cursor;
  const old = [];
  do {
    const page = await call(token, 'GET', `blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, null, fetcher);
    old.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  const blocks = markdownBlocks(markdown);
  const batches = Math.ceil(blocks.length / 100);
  const total = old.length + batches;
  let done = 0;
  for (const block of old) {
    try {
      await call(token, 'DELETE', `blocks/${block.id}`, null, fetcher);
    } catch (error) {
      if (!(error.status === 404 || /archived/i.test(error.message))) throw error;
    }
    onProgress(++done, total);
  }
  for (let i = 0; i < blocks.length; i += 100) {
    await call(token, 'PATCH', `blocks/${pageId}/children`, {children: blocks.slice(i, i + 100)}, fetcher);
    onProgress(++done, total);
  }
  return blocks.length;
}

// One "Question — Answer" line at the end of a page (the standard answers).
export async function appendAnswer(token, pageId, question, answer, fetcher) {
  const text = `${question} — ${answer}`.slice(0, 1900);
  await call(token, 'PATCH', `blocks/${pageId}/children`, {children: [{object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: {rich_text: [{type: 'text', text: {content: text}}]}}]}, fetcher);
}

// The 🧠 Form knowledge page: created once next to the Profile page (same parent), then reused.
export async function ensurePage(token, besideId, title, intro, fetcher) {
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

// ---------- text blocks of a page (the standard answers' ❓ lines, the 🧠 Form knowledge bullets) ----------
const plainOf = block => (block[block.type]?.rich_text || []).map(t => t.plain_text).join('');
// Every block with text, in page order, down to toggles and nested lists (2 levels): [{id, type, text}].
export async function textBlocks(token, pageId, fetcher, depth = 0) {
  const found = [];
  let cursor;
  do {
    const page = await call(token, 'GET', `blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, null, fetcher);
    for (const block of page.results) {
      if (block[block.type]?.rich_text) found.push({id: block.id, type: block.type, text: plainOf(block)});
      if (block.has_children && depth < 2 && !['child_page', 'child_database'].includes(block.type)) {
        found.push(...await textBlocks(token, block.id, fetcher, depth + 1));
      }
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return found;
}
export async function setBlockText(token, block, text, fetcher) {
  await call(token, 'PATCH', `blocks/${block.id}`, {[block.type]: {rich_text: [{type: 'text', text: {content: text.slice(0, 1900)}}]}}, fetcher);
}
export const deleteBlock = (token, id, fetcher) => call(token, 'DELETE', `blocks/${id}`, null, fetcher);
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
