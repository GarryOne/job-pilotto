// CI writes Bug Tracker rows (5 Oct 2026). The Notion Bug Tracker was written only by local sessions, so the weekly self-review saw only the misses a person had logged. A miss the loop
// can see on its own now gets a row too: a planted bug no detector caught (a `detector-miss` issue) and a bug a person reported on GitHub that the Finder had not (a closed issue
// without the `auto-ui` label). The row carries the replay command, so the miss can be walked again. One row per GitHub issue (found by its URL first); with no write token it does nothing.
// Needs NOTION_BRAIN_WRITE_TOKEN (an integration with insert rights on the tracker) and BUG_TRACKER_DB; the read-only token of the stats cannot write. Pure but for the Notion call.
import {parseReplay, replayCommand} from './replay.mjs';

export const NOTION_VERSION = '2022-06-28';
// Issues that are the loop's own ledgers or other loops' work, never a bug someone found.
const NOT_A_BUG = new Set(['noise-register', 'top-issues', 'release-channels', 'ai-budget', 'verdict-audit', 'stable-canary', 'fill-failure', 'harness-signatures', 'needs-snapshot']);
const AREAS = [[/activity|actions|run\b|runs\b/i, 'Activity/Runs'], [/strategy/i, 'Strategy'], [/wizard|setup|settings/i, 'Setup/Wizard'], [/sidebar|chrome|menu/i, 'Sidebar/Chrome'], [/apply|extension|form/i, 'Apply'],
  [/notion/i, 'Notion sync'], [/release|update|installer/i, 'Release/Update'], [/workflow|ci\b|pipeline/i, 'CI/Pipeline'], [/recall|mutant|detector|harness|suite/i, 'e2e harness'], [/engine|digest|scout|feed/i, 'Engine']];
const SEVERITY = {high: 'High', medium: 'Medium', low: 'Low', critical: 'Critical'};
const text = (value, max = 1900) => [{text: {content: String(value || '').slice(0, max)}}];

// {number, url, title, labels: [name], body, createdAt} -> the row's facts, or null when it is not a bug the loop missed.
export function trackerRow(issue) {
  const labels = (issue.labels || []).map(item => String(item.name || item));
  if (labels.some(name => NOT_A_BUG.has(name))) return null;
  const miss = labels.includes('kind:detector-miss');
  if (labels.includes('auto-ui') && !miss) return null;   // the Finder found it itself
  const title = String(issue.title || '').replace(/^\[auto-ui\]\s*[^:]*:\s*/, '').trim().slice(0, 150) || `Issue #${issue.number}`;
  const severity = SEVERITY[(labels.find(name => name.startsWith('severity:')) || '').slice(9)] || 'Medium';
  const area = miss ? 'e2e harness' : AREAS.find(([pattern]) => pattern.test(`${issue.title} ${labels.join(' ')}`))?.[1] || '';
  const replay = parseReplay(issue.body);
  const happened = [miss ? 'A planted bug was not caught by its detector (recall or mutation).' : `Reported on GitHub, not by the Finder: ${title}`, replay ? `Replay: ${replayCommand(replay)}` : '', issue.url].filter(Boolean).join('\n');
  return {number: issue.number, url: issue.url, title, severity, area, foundBy: miss ? 'e2e run' : 'User report', caught: 'No - gap', happened,
    idea: miss ? 'Close the gap: make the detector catch this planted bug, then keep the plant.' : 'The check that would have caught this class of bug (to be written by the session that fixes it).', date: String(issue.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)};
}

export function notionProperties(row) {
  return {
    Bug: {title: text(row.title, 200)}, 'What happened': {rich_text: text(row.happened)}, Severity: {select: {name: row.severity}}, ...(row.area ? {Area: {select: {name: row.area}}} : {}),
    'Found by': {select: {name: row.foundBy}}, 'Caught by e2e': {select: {name: row.caught}}, Status: {select: {name: 'Open'}}, 'Found on': {date: {start: row.date}},
    'GitHub issue': {url: row.url}, 'e2e test idea': {rich_text: text(row.idea)}, Occurrences: {number: 1},
  };
}

// -> {status: 'created' | 'exists' | 'skipped' | 'error', ...}. `fetchImpl` is injectable for tests.
export async function writeTrackerRow({token = '', db = '', row, fetchImpl = globalThis.fetch} = {}) {
  if (!row) return {status: 'skipped', why: 'not a bug the loop missed'};
  if (!token || !db) return {status: 'skipped', why: 'no write token (NOTION_BRAIN_WRITE_TOKEN) or tracker (BUG_TRACKER_DB)'};
  const headers = {Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json'};
  try {
    const found = await fetchImpl(`https://api.notion.com/v1/databases/${db}/query`, {method: 'POST', headers, body: JSON.stringify({filter: {property: 'GitHub issue', url: {equals: row.url}}, page_size: 1})});
    if (!found.ok) return {status: 'error', message: `the tracker answered ${found.status} to a lookup`};
    if ((await found.json()).results?.length) return {status: 'exists'};
    const made = await fetchImpl('https://api.notion.com/v1/pages', {method: 'POST', headers, body: JSON.stringify({parent: {database_id: db}, properties: notionProperties(row)})});
    if (!made.ok) return {status: 'error', message: `the tracker refused the row (${made.status})`};
    return {status: 'created', id: (await made.json()).id || ''};
  } catch (error) { return {status: 'error', message: String(error.message).slice(0, 120)}; }
}
