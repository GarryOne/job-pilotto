// The Notion test workspace: the journey needs a page with nothing in it, as a new user has. The page is emptied before a run (what is
// in it moves to Notion's trash, recoverable for 30 days) and after it. Safety: nothing is touched unless the token belongs to the
// "Job Pilotto 2" test workspace and sees exactly one top-level page.
const API = 'https://api.notion.com/v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A dropped connection or a 5xx is retried when repeating the request is harmless (reads, PATCH, DELETE); a create (POST) is never repeated: it may have gone through.
const repeatable = (method, path) => method !== 'POST' || /\/query$|^search$/.test(path);

export async function call(token, method, path, body) {
  for (let attempt = 0; attempt < 8; attempt++) {   // several sessions can share one integration: be patient with a 429
    let response;
    try {
      response = await fetch(`${API}/${path}`, {method, headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined});
    } catch (error) {   // "fetch failed": the connection dropped on the CI runner
      if (!repeatable(method, path) || attempt >= 4) throw error;
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (response.status === 429 || (response.status >= 502 && response.status <= 504 && repeatable(method, path))) { await sleep(1500 * (attempt + 1)); continue; }
    const data = await response.json();
    if (!response.ok) throw new Error(`Notion ${method} ${path}: ${data.message || response.status}`);
    return data;
  }
  throw new Error(`Notion ${method} ${path}: rate limited`);
}

const titleOf = page => Object.values(page.properties || {}).find(value => value.type === 'title')?.title?.map(part => part.plain_text).join('') || '';

// -> the id of the one top-level page, or throws. Refuses a workspace that is not the test one.
export async function testRoot(token) {
  const me = await call(token, 'GET', 'users/me');
  const workspace = me.bot?.workspace_name || '';
  if (!/job pilotto 2/i.test(workspace)) throw new Error(`refusing to touch the Notion workspace "${workspace}": the E2E token must belong to the "Job Pilotto 2" test workspace`);
  const pages = [];
  let cursor;
  do {
    const found = await call(token, 'POST', 'search', {filter: {property: 'object', value: 'page'}, page_size: 100, ...(cursor ? {start_cursor: cursor} : {})});
    pages.push(...found.results.filter(page => !page.archived));
    cursor = found.has_more ? found.next_cursor : null;
  } while (cursor);
  const visible = new Set(pages.map(page => page.id));
  const tops = pages.filter(page => !(page.parent?.page_id && visible.has(page.parent.page_id)) && !page.parent?.database_id);
  if (tops.length !== 1) throw new Error(`the E2E token must see exactly one top-level page, it sees ${tops.length}`);
  return {id: tops[0].id, title: titleOf(tops[0]), workspace};
}

// Everything inside the page goes to the trash. Returns how many items.
export async function clearRoot(token, id) {
  let count = 0, again = true;
  while (again) {
    const children = await call(token, 'GET', `blocks/${id}/children?page_size=100`);
    for (const block of children.results) {
      await call(token, 'DELETE', `blocks/${block.id}`).catch(error => { if (!/archived/i.test(error.message)) throw error; });
      count++;
      await sleep(350);   // Notion allows about 3 requests a second
    }
    again = children.has_more;
  }
  return count;
}

// A page of the test workspace by its title (what a feature wrote into Notion), or null. Read-only.
export async function findPage(token, title) {
  const found = await call(token, 'POST', 'search', {query: title, filter: {property: 'object', value: 'page'}, page_size: 20});
  return found.results.find(page => !page.archived && titleOf(page).trim() === title) || null;
}

// A database of the test workspace by its title, or null. Read-only.
export async function findDatabase(token, title) {
  const found = await call(token, 'POST', 'search', {query: title, filter: {property: 'object', value: 'database'}, page_size: 20});
  return found.results.find(db => !db.archived && (db.title || []).map(part => part.plain_text).join('').includes(title)) || null;
}

// Is the Job Pilotto workspace already built in this page? (A suite then seeds the app in seconds instead of going through the wizard.)
export async function workspaceReady(token) {
  const [profile, matches] = await Promise.all([findPage(token, 'Profile — CV and Preferences'), findDatabase(token, 'Job Matches — AI Scored')]);
  return !!(profile && matches);
}

// Every row of one database to the trash (a suite resets only its own data, never the whole workspace). Returns how many.
export async function emptyDatabase(token, title) {
  const db = await findDatabase(token, title);
  if (!db) return 0;
  let count = 0, cursor;
  do {
    const rows = await call(token, 'POST', `databases/${db.id}/query`, {page_size: 100, ...(cursor ? {start_cursor: cursor} : {})});
    for (const row of rows.results) {
      if (row.archived) continue;
      await call(token, 'PATCH', `pages/${row.id}`, {archived: true}).catch(() => {});
      count++;
      await sleep(350);
    }
    cursor = rows.has_more ? rows.next_cursor : null;
  } while (cursor);
  return count;
}

// The rows of one database, newest first, as plain {id, title, status, mode, trigger, summary, started}: what a run row says in Notion. Read-only.
export async function runRows(token, title, {size = 30} = {}) {
  const db = await findDatabase(token, title);
  if (!db) return [];
  const plain = prop => (prop?.rich_text || prop?.title || []).map(part => part.plain_text).join('');
  const rows = await call(token, 'POST', `databases/${db.id}/query`, {page_size: size, sorts: [{timestamp: 'created_time', direction: 'descending'}]});
  return rows.results.filter(row => !row.archived).map(row => ({id: row.id, url: row.url, created: row.created_time,
    title: titleOf(row), status: row.properties.Status?.select?.name || '', mode: row.properties.Mode?.select?.name || '', trigger: row.properties.Trigger?.select?.name || '',
    summary: plain(row.properties.Summary), started: row.properties.Started?.date?.start || row.created_time}));
}

// All the text a database holds, row by row (every property as plain text), for a suite that greps what a feature stored. Read-only.
export async function databaseText(token, title) {
  const db = await findDatabase(token, title);
  if (!db) return '';
  const lines = [];
  let cursor;
  do {
    const rows = await call(token, 'POST', `databases/${db.id}/query`, {page_size: 100, ...(cursor ? {start_cursor: cursor} : {})});
    for (const row of rows.results) {
      if (row.archived) continue;
      lines.push(Object.entries(row.properties || {}).map(([name, value]) => `${name}: ${propertyText(value)}`).join(' | '));
    }
    cursor = rows.has_more ? rows.next_cursor : null;
  } while (cursor);
  return lines.join('\n');
}
function propertyText(value) {
  const rich = list => (list || []).map(part => part.plain_text).join('');
  switch (value.type) {
    case 'title': case 'rich_text': return rich(value[value.type]);
    case 'select': case 'status': return value[value.type]?.name || '';
    case 'multi_select': return (value.multi_select || []).map(item => item.name).join(', ');
    case 'number': return value.number ?? '';
    case 'url': case 'email': case 'phone_number': return value[value.type] || '';
    case 'checkbox': return String(value.checkbox);
    case 'date': return value.date?.start || '';
    default: return '';
  }
}

// The text of a page of the workspace by its title, with the pages and blocks nested inside it. Read-only.
export async function pageText(token, title) {
  const page = await findPage(token, title);
  if (!page) return '';
  const out = [];
  const walk = async (id, depth) => {
    let cursor;
    do {
      const children = await call(token, 'GET', `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      for (const block of children.results) {
        const content = block[block.type] || {};
        out.push([...(content.rich_text || []), ...(content.title ? [{plain_text: content.title}] : [])].map(part => part.plain_text).join(''));
        if (block.has_children && depth < 3 && block.type !== 'child_database') await walk(block.id, depth + 1);
      }
      cursor = children.has_more ? children.next_cursor : null;
    } while (cursor);
  };
  await walk(page.id, 0);
  return out.join('\n');
}

// Every row of one database, flattened to plain values: {_id, <column>: text | number | boolean | url | date | select name}. Read-only.
export async function readRows(token, title) {
  const db = await findDatabase(token, title);
  if (!db) return [];
  const out = [];
  let cursor;
  do {
    const rows = await call(token, 'POST', `databases/${db.id}/query`, {page_size: 100, ...(cursor ? {start_cursor: cursor} : {})});
    for (const row of rows.results) if (!row.archived) out.push(flatten(row));
    cursor = rows.has_more ? rows.next_cursor : null;
  } while (cursor);
  return out;
}

export function flatten(row) {
  const out = {_id: row.id};
  for (const [name, value] of Object.entries(row.properties || {})) {
    const text = parts => (parts || []).map(part => part.plain_text).join('');
    out[name] = {title: () => text(value.title), rich_text: () => text(value.rich_text), number: () => value.number, checkbox: () => value.checkbox, url: () => value.url,
      select: () => value.select?.name ?? null, date: () => value.date?.start ?? null, status: () => value.status?.name ?? null,
      multi_select: () => (value.multi_select || []).map(item => item.name)}[value.type]?.() ?? null;
  }
  return out;
}

// ---- Rows written straight through the Notion API: dummy data without an AI call. Every helper refuses to run outside the test workspace's own databases
// (they are found by title in the page the token sees), and `rows` is read-only.
const text = value => ({rich_text: [{text: {content: String(value).slice(0, 2000)}}]});
const paragraph = content => ({object: 'block', type: 'paragraph', paragraph: {rich_text: [{type: 'text', text: {content: content.slice(0, 1900)}}]}});

// A new row in the database called `title`. `properties` are Notion property values; `children` plain-text paragraphs are optional.
export async function createRow(token, title, properties, children = []) {
  const db = await findDatabase(token, title);
  if (!db) throw new Error(`the test workspace has no "${title}" database`);
  return call(token, 'POST', 'pages', {parent: {database_id: db.id}, properties, ...(children.length ? {children} : {})});
}

// Every live row of a database as {id, url, properties}.
export async function rows(token, title) {
  const db = await findDatabase(token, title);
  if (!db) return [];
  const out = [];
  let cursor;
  do {
    const found = await call(token, 'POST', `databases/${db.id}/query`, {page_size: 100, ...(cursor ? {start_cursor: cursor} : {})});
    out.push(...found.results.filter(row => !row.archived));
    cursor = found.has_more ? found.next_cursor : null;
  } while (cursor);
  return out;
}

// The text blocks of a page (and of its toggles), flattened: [{type, text}].
export async function pageBlocks(token, id) {
  const out = [];
  const children = await call(token, 'GET', `blocks/${id}/children?page_size=100`);
  for (const block of children.results) {
    const rich = block[block.type]?.rich_text || [];
    out.push({type: block.type, text: rich.map(part => part.plain_text).join('')});
    if (block.has_children) out.push(...await pageBlocks(token, block.id));
  }
  return out;
}

export const plainOf = property => {
  if (!property) return '';
  const parts = property.title || property.rich_text;
  if (parts) return parts.map(part => part.plain_text).join('');
  return property.select?.name || property.date?.start || (property.number ?? '') + '';
};

export {text as richText, paragraph};
// Every live row of one database (raw API pages). Read-only.
export async function queryAll(token, databaseId) {
  const rows = [];
  let cursor;
  do {
    const found = await call(token, 'POST', `databases/${databaseId}/query`, {page_size: 100, ...(cursor ? {start_cursor: cursor} : {})});
    rows.push(...found.results.filter(row => !row.archived));
    cursor = found.has_more ? found.next_cursor : null;
  } while (cursor);
  return rows;
}

// One row in a database of the test workspace; returns the API page.
export const createRowIn = (token, databaseId, properties) => call(token, 'POST', 'pages', {parent: {database_id: databaseId}, properties});

// A job on the Jobs list with a drafted kit, written the way the app writes one (src/ai/kit.py): an Applications row at Stage "Kit ready" and, on its page,
// the toggle "📝 Application kit" holding the kit JSON in a code block. `kit` = {answers: [{field, question, answer, needs_review}], cover_letter}.
export async function addKitJob(token, {title, company, url, kit, fit = 80}) {
  const db = await findDatabase(token, 'Job Tracker');
  if (!db) throw new Error('the Job Tracker database is not in this Notion page');
  const text = content => [{type: 'text', text: {content: String(content).slice(0, 1900)}}];
  return call(token, 'POST', 'pages', {parent: {database_id: db.id}, properties: {
    Job: {title: text(title)}, Company: {rich_text: text(company)}, 'Job URL': {url}, Stage: {select: {name: 'Kit ready'}},
    'Next step': {rich_text: text('📝 Kit ready: review it, then apply')}, 'Fit score': {number: fit}, Location: {rich_text: text('Zurich, Switzerland')}},
  children: [{object: 'block', type: 'heading_3', heading_3: {rich_text: text('📝 Application kit'), is_toggleable: true,
    children: [{object: 'block', type: 'code', code: {language: 'json', rich_text: text(JSON.stringify(kit))}}]}}]});
}

// Every Job Tracker row whose Job URL is one of `urls` goes to the trash (a suite resets only the rows it wrote). Returns how many.
export async function removeJobsByUrl(token, urls) {
  const db = await findDatabase(token, 'Job Tracker');
  if (!db) return 0;
  let count = 0;
  for (const url of urls) {
    const rows = await call(token, 'POST', `databases/${db.id}/query`, {filter: {property: 'Job URL', url: {equals: url}}, page_size: 20});
    for (const row of rows.results) { await call(token, 'PATCH', `pages/${row.id}`, {archived: true}); count++; await sleep(350); }
  }
  return count;
}

// Every live page next to `siblingId` (same parent) with this title, ignoring the leading emoji (the app keeps it as the page icon): a duplicate shows up
// as a second one. Read from the parent's blocks, not from search, which lags behind a page that was just made.
const plain = text => String(text || '').replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim().toLowerCase();
export async function findPagesBeside(token, siblingId, title) {
  const parentId = (await call(token, 'GET', `pages/${siblingId}`)).parent?.page_id;
  if (!parentId) return [];
  return (await children(token, parentId)).filter(block => block.type === 'child_page' && plain(block.child_page?.title) === plain(title));
}

// Puts a page of the test workspace in the trash (recoverable for 30 days).
export const trashPage = (token, id) => call(token, 'PATCH', `pages/${id}`, {archived: true});

const textOf = block => (block[block.type]?.rich_text || []).map(part => part.plain_text).join('');
async function children(token, id) {
  const all = [];
  let cursor;
  do {
    const batch = await call(token, 'GET', `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    all.push(...batch.results);
    cursor = batch.has_more ? batch.next_cursor : null;
  } while (cursor);
  return all;
}

// A readable settings page as {heading: [bullet, …]} (what src/notion/search_settings.py reads: "## heading", then "- entry" lines).
export async function pageSections(token, id) {
  const sections = {};
  let heading = null;
  for (const block of await children(token, id)) {
    if (block.type.startsWith('heading_')) { heading = textOf(block).trim(); sections[heading] = []; }
    else if (block.type === 'bulleted_list_item' && heading) sections[heading].push(textOf(block).trim());
  }
  return sections;
}

// The way a person edits the page in Notion: replace the bullets under one heading.
export async function setSection(token, id, heading, entries) {
  const blocks = await children(token, id);
  const at = blocks.findIndex(block => block.type.startsWith('heading_') && textOf(block).trim() === heading);
  if (at < 0) throw new Error(`the page has no "${heading}" heading`);
  for (let i = at + 1; i < blocks.length && !blocks[i].type.startsWith('heading_'); i++) {
    if (blocks[i].type === 'bulleted_list_item') { await call(token, 'DELETE', `blocks/${blocks[i].id}`); await sleep(350); }
  }
  if (entries.length) {
    await call(token, 'PATCH', `blocks/${id}/children`, {after: blocks[at].id,
      children: entries.map(entry => ({object: 'block', type: 'bulleted_list_item', bulleted_list_item: {rich_text: [{type: 'text', text: {content: entry}}]}}))});
  }
}

// The titles of every live row of one database (read straight from Notion, which is what the app lists from).
export async function rowTitles(token, dbTitle) {
  const db = await findDatabase(token, dbTitle);
  if (!db) return [];
  const titles = [];
  let cursor;
  do {
    const rows = await call(token, 'POST', `databases/${db.id}/query`, {page_size: 100, ...(cursor ? {start_cursor: cursor} : {})});
    titles.push(...rows.results.filter(row => !row.archived).map(titleOf));
    cursor = rows.has_more ? rows.next_cursor : null;
  } while (cursor);
  return titles;
}
