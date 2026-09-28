// Each Apply with Claude session's statistics on its row in Notion 🎏 Agent Runs (session-stats.js computes them).
// The row is the one Claude records for the run (src/ai/apply_run.py) when there is one; if Claude never recorded it,
// the app creates it when you decide (submitted or not), so every session leaves a row to learn from.
// Written a few seconds after each change (not on every byte), in the background; a Notion error never stops a session.
import * as stats from './session-stats.js';

const WAIT_MS = 4000;
const timers = new Map();

async function findRow(call, db, session) {
  const since = new Date(Date.parse(session.startedAt) - 2 * 60 * 1000).toISOString();
  const found = await call('POST', `databases/${db}/query`, {page_size: 1, sorts: [{property: 'Started', direction: 'descending'}],
    filter: {and: [{property: 'Job URL', url: {equals: session.url}}, {property: 'Agent', select: {equals: 'Claude'}},
      {property: 'Started', date: {on_or_after: since}}]}});
  return found.results?.[0]?.id || '';
}

// Writes one session's row now. create: make the row when Claude didn't (at your decision, or when the session ends).
export async function write(session, {call, db, create = false, now = Date.now(), read} = {}) {
  if (!db || !session?.url) return null;
  let page = session.runPage || await findRow(call, db, session);
  if (!page && !create) return null;
  const props = stats.properties(session, {now, read});
  if (!page) {
    const title = [session.company, session.title].filter(Boolean).join(' · ') || 'Application';
    const created = await call('POST', 'pages', {parent: {database_id: db}, properties: {
      Run: {title: [{text: {content: `${title} · Claude`}}]}, Agent: {select: {name: 'Claude'}}, 'Job URL': {url: session.url},
      Company: {rich_text: [{text: {content: session.company || ''}}]}, Started: {date: {start: session.startedAt}},
      ...(session.endedAt ? {Ended: {date: {start: session.endedAt}}} : {}), Status: {select: {name: session.outcome === 'submitted' ? 'Ready' : 'Needs input'}},
      ...props}});
    return created.id;
  }
  await call('PATCH', `pages/${page}`, {properties: props});
  return page;
}

// Later, once changes settle. keep(page) stores the row id on the session, so it's found at once next time.
export function schedule(session, options, keep = () => {}, wait = WAIT_MS) {
  clearTimeout(timers.get(session.id));
  timers.set(session.id, setTimeout(async () => {
    timers.delete(session.id);
    try { const page = await write(session, options()); if (page) keep(page); } catch { /* next change tries again */ }
  }, wait));
}
