// The user's Notion is their Job Pilotto interface. This module connects the app to their copy of the
// template: finds each database and page by title (config/notion_template.json), checks the columns
// the pipeline needs, and writes pages (the drafted Profile and standard answers).
// This file: finding and connecting the databases, and the workspace page (name, archive). Pieces: notion-core.js (call, pace),
// notion-write.js, notion-read.js; this file re-exports their public names.
import {ARCHIVED, TEMPLATE, call, liveOnly, normalise, searchAll, titleOf} from './notion-core.js';
import {pageUrl} from './notion-write.js';
export {ARCHIVED, TEMPLATE, _pace, _trees, call, normalise, useClock, useSleep} from './notion-core.js';
export {appendAnswer, appendBullets, blockSignature, ensurePage, findPageBeside, markdownBlocks, pageUrl, patchPlan, rewriteTuning, writePage} from './notion-write.js';
export {appendHeading, deleteBlock, insertBulletsAfter, pageText, pageTree, setBlockText, setRowCell, snapshotStrategy, textBlocks} from './notion-read.js';


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

// ---------- starting over: archive the workspace, or copy it all into an export ----------
// The page the Job Pilotto databases and pages sit in (the Profile's parent).
export async function workspaceRoot(token, ids, fetcher) {
  if (!ids.NOTION_PROFILE_PAGE_ID) throw new Error('No Job Pilotto workspace is connected');
  const root = (await call(token, 'GET', `pages/${ids.NOTION_PROFILE_PAGE_ID}`, null, fetcher)).parent?.page_id;
  if (!root) throw new Error('Your Job Pilotto pages are not inside one page, so there is no page to archive');
  return root.replace(/-/g, '');
}

// A new workspace page gets a name that tells it apart ("Job Pilotto · Igor's MacBook Pro · 7 Oct 2026"): two installs that each
// connected the same Notion made two pages both called "Job Pilotto" (6 Oct 2026). Only a page still called exactly "Job Pilotto"
// (the template's or the app's own) is renamed: a name the user chose is kept. -> {id, title, renamed}.
export function workspaceTitle(computer, when = new Date()) {
  const day = when.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
  return ['Job Pilotto', String(computer || '').trim().slice(0, 40), day].filter(Boolean).join(' · ');
}
export async function nameWorkspace(token, ids, title, fetcher) {
  const root = await workspaceRoot(token, ids, fetcher);
  const page = await call(token, 'GET', `pages/${root}`, null, fetcher);
  const now = titleOf(page).trim();
  if (now !== 'Job Pilotto') return {id: root, title: now, renamed: false};
  const [key] = Object.entries(page.properties || {}).find(([, p]) => p.type === 'title') || ['title'];
  await call(token, 'PATCH', `pages/${root}`, {properties: {[key]: {title: [{type: 'text', text: {content: title}}]}}}, fetcher);
  return {id: root, title, renamed: true};
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
