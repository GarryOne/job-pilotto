// The user's Notion is their Job Pilotto interface. This module connects the app to their copy of the
// template: finds each database and page by title (config/notion_template.json), checks the columns
// the pipeline needs, and writes pages (the drafted Profile and standard answers).
import fs from 'node:fs';
import path from 'node:path';
import {log} from './log.js';
import * as sharedPace from './notion-pace.js';
import * as requestLog from './request-log.js';
import {REPO} from './pipeline.js';

const API = 'https://api.notion.com/v1/';
export const TEMPLATE = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'notion_template.json'), 'utf8'));

// Notion answers 429 when a workspace sends more than ~3 requests a second (the app often reads several things at
// once) and 502/503/504 when it's briefly down: wait (its Retry-After, else 0.5, 1, 2, 4 s) and try again, so a busy
// moment never fails an unrelated read (it once left a form without your name). retries: 0 for callers that
// throttle and retry themselves (the export).
const RETRY = new Set([429, 502, 503, 504]);
let sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function useSleep(fn) { sleep = fn; }  // for tests
// The clock the pace reads (tests pass a fake one, so waits don't depend on how busy the machine is).
let clock = Date.now;
export function useClock(fn) { clock = fn || Date.now; }
// One pace for the whole app: Notion allows about 3 requests a second per integration, and fills in several tabs,
// the background polls and statistics would otherwise burst past it (429). Each call waits for its turn (spaced
// GAP_MS apart), and after a 429 every call waits out the pause Notion asked for, not only the one that got it.
// The turns are shared with the other processes on this computer that use the same connection (lib/notion-pace.js).
const GAP_MS = sharedPace.GAP_MS;
let nextSlot = 0, calmUntil = 0;
async function turn(token, now = clock) {
  const shared = await sharedPace.claim(token, now);
  const at = shared ?? Math.max(nextSlot, calmUntil, now());
  if (shared === null) nextSlot = at + GAP_MS;
  const wait = Math.max(at, calmUntil) - now();
  if (wait > 0) await sleep(wait);
}
export const _pace = {reset: token => { nextSlot = 0; calmUntil = 0; if (token) fs.rmSync(sharedPace.paceFile(token), {force: true}); },
  state: () => ({nextSlot, calmUntil})};  // tests
// How many requests the app sends, logged once a minute (app.log): "[notion] last minute: 12 requests (GET blocks 9, …)".
const counted = new Map();
let countTimer = null;
function count(method, route) {
  const kind = `${method} ${route.split(/[/?]/)[0]}`;
  counted.set(kind, (counted.get(kind) || 0) + 1);
  countTimer ??= setTimeout(() => {
    const total = [...counted.values()].reduce((a, b) => a + b, 0);
    log('notion', `last minute: ${total} requests (${[...counted].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')})`);
    counted.clear();
    countTimer = null;
  }, 60_000);
  countTimer.unref?.();
}
// pace: real Notion calls take their turn; a fake fetcher (tests) runs at once unless asked.
export async function call(token, method, route, body, fetcher = globalThis.fetch, {retries = 4, pace = fetcher === globalThis.fetch} = {}) {
  for (let attempt = 0; ; attempt++) {
    if (pace) { await turn(token); count(method, route); }
    if (method !== 'GET') forgetChecks();  // the app changed something: kept pages are checked again before use
    const started = Date.now();
    const response = await fetcher(API + route, {
      method,
      headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (pace) requestLog.write({method, route, status: response.status, ms: Date.now() - started, attempt});
    if (response.ok) return data;
    if (RETRY.has(response.status) && attempt < retries) {
      const after = Number(response.headers?.get?.('retry-after'));
      const wait = Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt, 10_000);
      if (response.status === 429) {  // everyone waits it out: this app and the other processes
        calmUntil = Math.max(calmUntil, clock() + wait);
        if (pace) await sharedPace.calmUntil(token, calmUntil);
      }
      // A retried 429 is expected (Notion's limit is shared, e.g. with a GitHub run): it's in notion-requests.log,
      // not on the terminal; only a request that finally fails is shown (the error thrown below).
      if (response.status !== 429) log('notion', `${response.status} on ${method} ${route.split('?')[0]}: retry ${attempt + 1}/${retries} in ${wait} ms`);
      await sleep(wait);
      continue;
    }
    throw Object.assign(new Error(data.message || `Notion ${response.status}`), {status: response.status});
  }
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
// app never mixes databases from two copies. root (the page Notion copied the template into at "Connect with
// Notion"): only what sits directly in that page counts, so an older copy elsewhere is never picked instead.
export async function discover(token, fetcher, {root = null} = {}) {
  const [databases, pages] = liveOnly(...await Promise.all([searchAll(token, 'database', fetcher), searchAll(token, 'page', fetcher)]));
  const wanted = [...Object.entries(TEMPLATE.databases).map(([env, title]) => [env, title, databases]),
    ...Object.entries(TEMPLATE.pages).map(([env, title]) => [env, title, pages])];
  const parentOf = item => item.parent?.page_id || item.parent?.database_id || item.parent?.type || 'workspace';
  const inRoot = item => !root || String(parentOf(item)).replace(/-/g, '') === String(root).replace(/-/g, '');
  const groups = new Map();
  for (const [env, title, items] of wanted) {
    // Its title, or one it had before a rename (a copy made from an older template: schema.repair renames it).
    const names = new Set([title, ...(TEMPLATE.former_titles?.[env] || [])].map(normalise));
    for (const item of items.filter(i => inRoot(i) && names.has(normalise(titleOf(i))))) {
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

// An archived workspace (Settings → Danger zone → "Also start a fresh Notion workspace" renames its page to
// "Job Pilotto (archived 28 Sep 2026)"): still shared with the connection, but never connected to again, so
// everything inside it is left out. Renaming the page back brings it back.
export const ARCHIVED = /\(archived\b[^)]*\)\s*$/i;
function liveOnly(databases, pages) {
  const parent = new Map([...databases, ...pages].map(i => [i.id, i.parent?.page_id || i.parent?.database_id || i.parent?.block_id]));
  const archived = new Set(pages.filter(p => ARCHIVED.test(titleOf(p))).map(p => p.id));
  const inArchive = item => {
    for (let id = item.id, depth = 0; id && depth < 20; id = parent.get(id), depth++) if (archived.has(id)) return true;
    return false;
  };
  return [databases.filter(i => !inArchive(i)), pages.filter(i => !inArchive(i))];
}

// A new workspace: the one page the connection was given (no Job Pilotto databases or pages in it yet),
// where the app builds everything from config/notion_schema.json. null when there isn't exactly one.
export async function sharedRoot(token, fetcher) {
  const [, pages] = liveOnly([], await searchAll(token, 'page', fetcher));
  const visible = new Set(pages.map(p => p.id));
  const tops = pages.filter(p => !(p.parent?.page_id && visible.has(p.parent.page_id)) && !p.parent?.database_id);
  return tops.length === 1 ? tops[0].id.replace(/-/g, '') : null;
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

export async function connect(token, fetcher, {root = null} = {}) {
  await call(token, 'GET', 'users/me', null, fetcher); // is the token valid at all?
  const {ids, missing} = await discover(token, fetcher, {root});
  const problems = missing.length ? [] : await checkColumns(token, ids, fetcher);
  return {ok: !missing.length && !problems.length, ids, missing, problems};
}

// Right after the user gives the connection access, Notion shares the page's databases over a minute
// or so: while some are found and others not yet, wait and look again instead of failing. root: the copy
// Notion is still making of the template (see discover); nothing in it yet is waited for too (patient).
export async function connectWaiting(token, {fetcher, onProgress = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)),
  tries = 8, every = 10000, check = connect, root = null, patient = !!root} = {}) {
  let result;
  for (let attempt = 1; attempt <= tries; attempt++) {
    result = await check(token, fetcher, {root});
    const found = Object.keys(result.ids).length;
    const waiting = result.missing.length && (found > 0 || patient || attempt <= 2);  // nothing at all twice: not shared
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
// Every block with text, in page order, down to toggles and nested lists (2 levels): [{id, type, text, parent}].
// ---- Page trees, kept in memory ----
// A page's text means opening every toggle and table inside it: 20-40 requests for the Profile. Several features
// read the same pages (contact details, standard answers, the Profile for AI calls, form knowledge), so a page's
// blocks are kept and read again only when Notion says the page changed: one cheap request for its
// last_edited_time. Notion rounds that time to the minute, so a page edited in the last 2 minutes is always read
// again. A check less than 20 s old is reused (a fill reads 3 pages at once); any write the app makes clears the
// checks; everything is read again at least every 10 minutes. Notion stays the source of truth.
const trees = new Map();    // "token|page" -> {edited, blocks, checkedAt, readAt}
const reading = new Map();  // reads under way, shared by everyone asking for the same page
const CHECKED_MS = 20_000, SETTLE_MS = 120_000, MAX_AGE_MS = 10 * 60_000;
export const _trees = {reset: () => { trees.clear(); reading.clear(); }};  // tests
const forgetChecks = () => { for (const tree of trees.values()) tree.checkedAt = 0; };

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
async function childrenOf(token, id, fetcher) {
  const found = [];
  let cursor;
  do {
    const page = await call(token, 'GET', `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, null, fetcher);
    found.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return found;
}
// A page's blocks as blocks that can be created elsewhere (text, lists, tables, dividers; nested ones included).
async function copyable(token, id, fetcher, depth = 0) {
  const out = [];
  for (const block of await childrenOf(token, id, fetcher)) {
    const body = block[block.type] || {};
    if (TEXT_TYPES.has(block.type)) {
      const copy = {rich_text: plainRich(body.rich_text)};
      for (const key of ['checked', 'language', 'is_toggleable']) if (key in body) copy[key] = body[key];
      if (block.has_children && depth < 2) copy.children = await copyable(token, block.id, fetcher, depth + 1);
      out.push({object: 'block', type: block.type, [block.type]: copy});
    } else if (block.type === 'divider') {
      out.push({object: 'block', type: 'divider', divider: {}});
    } else if (block.type === 'table') {
      const rows = (await childrenOf(token, block.id, fetcher)).map(row => ({object: 'block', type: 'table_row',
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

// ---------- starting over: archive the workspace, or copy it all into an export ----------
// The page the Job Pilotto databases and pages sit in (the Profile's parent).
export async function workspaceRoot(token, ids, fetcher) {
  if (!ids.NOTION_PROFILE_PAGE_ID) throw new Error('No Job Pilotto workspace is connected');
  const root = (await call(token, 'GET', `pages/${ids.NOTION_PROFILE_PAGE_ID}`, null, fetcher)).parent?.page_id;
  if (!root) throw new Error('Your Job Pilotto pages are not inside one page, so there is no page to archive');
  return root.replace(/-/g, '');
}

// Rename the workspace page to "<title> (archived <when>)": nothing is deleted or moved, and the app won't
// connect to it again (see liveOnly). -> {id, title, url}.
export async function archiveWorkspace(token, ids, when, fetcher) {
  const root = await workspaceRoot(token, ids, fetcher);
  const page = await call(token, 'GET', `pages/${root}`, null, fetcher);
  const [key] = Object.entries(page.properties || {}).find(([, p]) => p.type === 'title') || ['title'];
  const title = `${titleOf(page).replace(ARCHIVED, '').trim() || 'Job Pilotto'} (archived ${when})`;
  await call(token, 'PATCH', `pages/${root}`, {properties: {[key]: {title: [{type: 'text', text: {content: title}}]}}}, fetcher);
  return {id: root, title, url: pageUrl(root)};
}

// Everything in the workspace, as Notion's API returns it: the root page and every block under it, with
// sub-pages' contents, each database's columns and rows, and each row's contents. For an export (Settings →
// Your data); onProgress({pages, rows}) as it goes. Notion allows ~3 requests a second: waits when told to.
export async function dumpWorkspace(token, ids, {fetcher, onProgress = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  const count = {pages: 0, rows: 0};
  // Notion allows ~3 requests a second: requests start 1/3 s apart, and up to 3 rows are read at once.
  let next = 0;
  const turn = async () => {
    const now = Date.now(), start = Math.max(now, next);
    next = start + 340;
    if (start > now) await sleep(start - now);
  };
  const api = async (method, route, body) => {
    for (let attempt = 1; ; attempt++) {
      await turn();
      try { return await call(token, method, route, body, fetcher, {retries: 0}); } catch (error) {
        if (attempt >= 6 || !(error.status === 429 || error.status >= 500)) throw error;
        await sleep(1000 * attempt);
      }
    }
  };
  const pool = async (items, work, size = 3) => {
    let index = 0;
    await Promise.all(Array.from({length: Math.min(size, items.length)}, async () => {
      while (index < items.length) await work(items[index++]);
    }));
  };
  const all = async (method, route, body = {}) => {
    const found = [];
    let cursor;
    do {
      const page = method === 'GET'
        ? await api('GET', `${route}?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)
        : await api('POST', route, {...body, page_size: 100, ...(cursor ? {start_cursor: cursor} : {})});
      found.push(...page.results);
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    return found;
  };
  const tree = async id => {
    const blocks = await all('GET', `blocks/${id}/children`);
    for (const block of blocks) {
      if (block.type === 'child_database') {
        block.database = await api('GET', `databases/${block.id}`).catch(() => null);  // a linked view: not ours to read
        if (block.database) block.rows = await rows(block.id);
      } else if (block.type === 'child_page' && ARCHIVED.test(block.child_page?.title || '')) {
        block.skipped = 'archived';  // an archived Job Pilotto page (e.g. a parked build): not part of this workspace
      } else if (block.has_children) {
        if (block.type === 'child_page') { count.pages += 1; onProgress({...count}); }
        block.children = await tree(block.id);
      }
    }
    return blocks;
  };
  const rows = async databaseId => {
    const found = await all('POST', `databases/${databaseId}/query`);
    await pool(found, async row => {
      row.blocks = await tree(row.id);
      count.rows += 1;
      onProgress({...count});
    });
    return found;
  };
  const root = await workspaceRoot(token, ids, fetcher);
  const page = await api('GET', `pages/${root}`);
  return {app: 'Job Pilotto', format: 'Notion API 2022-06-28', exportedAt: new Date().toISOString(), ids, page,
    blocks: await tree(root), ...count};
}
