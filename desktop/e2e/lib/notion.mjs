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
