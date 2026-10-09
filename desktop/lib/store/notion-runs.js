// The Notion store's runs (⏱️ Search runs rows), desktop side: the latest rows, closing a row a killed run left Running, and a run's
// page (result, report, technical log). Moved unchanged out of lib/run-history.js, which reaches it through openStore(storage).runs.
// Guarded by test/run-history.test.js and store-runs.test.js.
import {call} from '../notion.js';
import {jobFrom} from '../job-line.js';
import {fromRow, text} from '../run-rows.js';

const ids = storage => storage.settings().notionIds || {};

// The latest rows, newest first.
export async function list(storage, {fetcher, size = 25} = {}) {
  const token = storage.secret('NOTION_TOKEN'), db = ids(storage).NOTION_CRON_RUNS_DB;
  if (!token || !db) return null;
  const {results = []} = await call(token, 'POST', `databases/${db}/query`,
    {sorts: [{property: 'Started', direction: 'descending'}], page_size: size}, fetcher);
  return results.map(page => fromRow(page));
}

// A run the watchdog stopped (a silent AI) was killed, and a killed Python cannot close its own row: it would stay "Running" and the app would show the task as running
// until the row goes stale (3 h). The app closes it: Failed, with why. Returns whether it changed the row (a row the run closed itself on SIGTERM is left alone).
export async function closeStopped(storage, url, reason, {fetcher} = {}) {
  const token = storage.secret('NOTION_TOKEN');
  const id = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(String(url || '').replace(/-/g, ''))?.[1];
  if (!token || !id) return false;
  const page = await call(token, 'GET', `pages/${id}`, null, fetcher);
  if (page.properties?.Status?.select?.name !== 'Running') return false;
  await call(token, 'PATCH', `pages/${id}`, {properties: {Status: {select: {name: 'Failed'}}, Summary: {rich_text: [{text: {content: String(reason).slice(0, 1900)}}]}}}, fetcher);
  return true;
}

// A run's page: what it produced (under "Result") and its technical log (the toggle's code blocks).
export async function detail(storage, pageId, {fetcher} = {}) {
  const token = storage.secret('NOTION_TOKEN');
  const {results: blocks = []} = await call(token, 'GET', `blocks/${pageId}/children?page_size=100`, null, fetcher);
  const plain = block => text(block[block.type]);
  const at = blocks.findIndex(block => block.type === 'heading_3' && plain(block) === 'Result');
  const message = at < 0 ? null : blocks.slice(at + 1).filter(block => block.type === 'paragraph').map(plain).join('\n') || null;
  const toggle = blocks.find(block => block.type === 'toggle' && /^Technical log/.test(plain(block)));
  let log = [];
  if (toggle?.has_children) {
    const {results: code = []} = await call(token, 'GET', `blocks/${toggle.id}/children?page_size=100`, null, fetcher);
    log = code.filter(block => block.type === 'code').flatMap(block => plain(block).split('\n'));
  }
  const report = blocks.filter(block => block.type === 'bulleted_list_item').map(plain);
  const job = jobFrom(log);  // a Logged activity run: its job's title and whether it was created
  // `report` goes along even when a technical log exists: it is where a GitHub run's "Warning: …" lines are (its row's
  // Summary is only the report's first line, and its log is a single line pointing at the page).
  return {message, log: log.length ? log : report, report, ...(job ? {job} : {})};
}

