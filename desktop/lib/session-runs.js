// Each Apply with Claude session's statistics on its row in Notion 🎏 Agent Runs (session-stats.js computes them).
// The row is the one Claude records for the run (src/ai/apply_run.py) when there is one; if Claude never recorded it,
// the app creates it when you decide (submitted or not), so every session leaves a row to learn from.
// Written a few seconds after each change (not on every byte), in the background; a store error never stops a session.
// With the data on this Mac (lib/store) the same numbers go to the engine's agent_runs record (its `fields`), the conversation to its
// `transcript`: optionsFor() picks the store, so main.js never asks which. Guarded by test/session-stats.test.js, store-session-runs.test.js.
import * as notion from './notion.js';
import * as notionGate from './notion-gate.js';
import * as stats from './session-stats.js';
import * as engine from './store/engine.js';
import * as transcript from './transcript.js';

const WAIT_MS = 4000;
const AGENT = 'Claude';   // the Agent column's value and the record's `ats`: data the engine (src/ai/apply_run.py) writes too, never shown
const timers = new Map();

async function findRow(call, db, session) {
  const since = new Date(Date.parse(session.startedAt) - 2 * 60 * 1000).toISOString();
  const found = await call('POST', `databases/${db}/query`, {page_size: 1, sorts: [{property: 'Started', direction: 'descending'}],
    filter: {and: [{property: 'Job URL', url: {equals: session.url}}, {property: 'Agent', select: {equals: AGENT}},
      {property: 'Started', date: {on_or_after: since}}]}});
  return found.results?.[0]?.id || '';
}

// The store on this Mac: one agent_runs record per session, its numbers in `fields` (session-stats.js plain), made at your decision.
async function writeRecord(session, {agentRuns, create, now, read}) {
  const {outcome, ...fields} = stats.plain(session, {now, read});   // outcome is the record's own field; `fields` only the known extras
  if (session.runPage) {
    await agentRuns('update', {run_id: session.runPage, fields: {outcome, fields}});
    return session.runPage;
  }
  if (!create) return null;
  const made = await agentRuns('add', {run: {url: session.url, ats: AGENT, outcome, fields}});
  return made?.id || null;
}

// Where one session's numbers go: a Notion Agent Runs row when Notion is the store, the engine's agent_runs on this Mac, else nowhere
// (trying: no store yet). create: make the row or record (at your decision, or when the session ends).
export function optionsFor(storage, {create = false, call = engine.call} = {}) {
  if (notionGate.notionInUse(storage)) {
    return {call: (method, route, body) => notion.call(storage.secret('NOTION_TOKEN'), method, route, body),
      db: storage.settings().notionIds?.NOTION_AGENT_RUNS_DB, create};
  }
  if (notionGate.tracking(storage)) return {agentRuns: (method, kwargs) => call(storage, 'agent_runs', method, kwargs), create};
  return {};
}

// A session's conversation, kept with its run (the transcript on this Mac doesn't last): a folded toggle on the Notion row, or
// the record's `transcript` (JSON) on this Mac. -> how many messages are kept.
export async function saveConversation(storage, session, talk, {call = engine.call} = {}) {
  const options = optionsFor(storage, {call});
  if (options.agentRuns) {
    await options.agentRuns('update', {run_id: session.runPage, fields: {transcript: JSON.stringify(talk)}});
    return talk.length;
  }
  if (!options.call) return null;
  return transcript.save(options.call, session.runPage, talk);
}

export async function loadConversation(storage, runPage, {call = engine.call} = {}) {
  const options = optionsFor(storage, {call});
  if (options.agentRuns) {
    const record = (await options.agentRuns('list', {ats: AGENT}) || []).find(run => run.id === runPage);
    try { return record?.transcript ? JSON.parse(record.transcript) : null; } catch { return null; }
  }
  return options.call ? transcript.load(options.call, runPage) : null;
}

// Writes one session's row now. create: make the row when Claude didn't (at your decision, or when the session ends).
export async function write(session, {call, db, agentRuns, create = false, now = Date.now(), read} = {}) {
  if (agentRuns && session?.url) return writeRecord(session, {agentRuns, create, now, read});
  if (!db || !session?.url) return null;
  let page = session.runPage || await findRow(call, db, session);
  if (!page && !create) return null;
  const props = stats.properties(session, {now, read});
  if (!page) {
    const title = [session.company, session.title].filter(Boolean).join(' · ') || 'Application';
    const created = await call('POST', 'pages', {parent: {database_id: db}, properties: {
      Run: {title: [{text: {content: `${title} · Claude`}}]}, Agent: {select: {name: AGENT}}, 'Job URL': {url: session.url},
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
