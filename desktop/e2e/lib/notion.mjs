// The Notion test workspace: the journey needs a page with nothing in it, as a new user has. The page is emptied before a run (what is
// in it moves to Notion's trash, recoverable for 30 days) and after it. Safety: nothing is touched unless the token belongs to the
// "Job Pilotto 2" test workspace and sees exactly one top-level page.
const API = 'https://api.notion.com/v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(token, method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${API}/${path}`, {method, headers: {Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined});
    if (response.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
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
