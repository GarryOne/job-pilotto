// Recent activity from Notion ⏱️ Search runs: every run writes its row there, wherever it ran (this Mac, the
// user's GitHub repo, a Telegram button), from the start (Status Running, with a ⏳ progress line) to the end
// (report, result, technical log). So the app shows the same history as Notion and Telegram, and a job running
// elsewhere still shows its progress here. runs.json on this Mac only fills the gap while a row isn't there yet.
import {call} from './notion.js';
import {jobFrom} from './job-line.js';

export {jobFrom};

const KIND = {scheduled: 'search', run: 'search', first: 'search', today: 'today', mail: 'mail', scout: 'scout', insight: 'insight',
  weekly: 'weekly', prepare: 'prepare', interview: 'interview', add: 'add', rejection: 'rejection', prep: 'prep'};
// What started it: the Mac's schedule, you (the app, Telegram, GitHub's Run button) or GitHub's schedule.
const TRIGGER = {'Mac schedule': 'schedule', Schedule: 'schedule'};
const STALE_MS = 3 * 3600 * 1000;  // a row still "Running" after this long lost its job (the machine went away)

const text = prop => (prop?.rich_text || prop?.title || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');

const notionPage = id => `https://www.notion.so/${String(id).replace(/-/g, '')}`;
// From the row alone (before its page is read): the Application relation, and "Tracked…" (a new job) in its Summary.
function rowJob(p, mode, summary) {
  const id = mode === 'add' && p.Application?.relation?.[0]?.id;
  return id ? {pageId: id, url: notionPage(id), title: '', jobUrl: '', created: /^\W*Tracked\b/.test(summary)} : null;
}

// One row as an activity record (the same shape as the Mac's own runs.json records).
export function fromRow(page, now = Date.now()) {
  const p = page.properties || {};
  const startedAt = p.Started?.date?.start || page.created_time;
  const mode = p.Mode?.select?.name || 'scheduled';
  const status = p.Status?.select?.name || '';
  const trigger = p.Trigger?.select?.name || '';
  const seconds = p['Duration (s)']?.number;
  const summary = text(p.Summary);
  const running = status === 'Running' && now - Date.parse(startedAt) < STALE_MS;
  const ended = !running && seconds != null ? new Date(Date.parse(startedAt) + seconds * 1000).toISOString() : (running ? undefined : startedAt);
  // Notion keeps start times to the minute: two runs started in the same minute (a scheduled Gmail check and one you
  // started) would share an id, and the activity list would select both. A tie-breaker from the page id (< 1 s).
  const tie = parseInt(String(page.id).replace(/-/g, '').slice(-6), 16) % 1000 || 0;
  const record = {id: Date.parse(startedAt) + tie, pageId: page.id, notionUrl: page.url, url: p['Run URL']?.url || null, kind: KIND[mode] || 'action', mode,
    trigger: TRIGGER[trigger] || 'you', where: p['Run URL']?.url ? 'github' : /^Mac/.test(trigger) ? 'mac' : 'elsewhere', startedAt};
  if (running) return {...record, live: true, step: summary.replace(/^⏳\s*/, '') || 'Running'};
  const ok = status !== 'Failed' && !(status === 'Running');  // a stale "Running" row: the job never reported
  const job = ok ? rowJob(p, mode, summary) : null;
  return {...record, endedAt: ended, ok, warned: status === 'Warnings', new: p['New jobs']?.number ?? null, usd: p['AI cost (USD)']?.number || 0,
    result: result(summary, status, p['New jobs']?.number, mode), ...(job ? {job} : {})};
}

// One line on what it did: the row's Summary without the cost, or the count of new jobs for a search.
export function result(summary, status, fresh, mode) {
  if (status === 'Running') return 'never finished (see the log)';
  const line = summary.replace(/\s*\(AI cost \$[\d.]+\)\.?$/, '').replace(/;?\s*AI cost \$[\d.]+\.?$/, '').trim();
  if (KIND[mode] === 'search' && fresh != null) return fresh ? `${fresh} new job${fresh === 1 ? '' : 's'}` : 'nothing new';
  return line || (status === 'Failed' ? 'failed' : 'done');
}

const ids = storage => storage.settings().notionIds || {};

// The latest rows, newest first.
export async function list(storage, {fetcher, size = 25} = {}) {
  const token = storage.secret('NOTION_TOKEN'), db = ids(storage).NOTION_CRON_RUNS_DB;
  if (!token || !db) return null;
  const {results = []} = await call(token, 'POST', `databases/${db}/query`,
    {sorts: [{property: 'Started', direction: 'descending'}], page_size: size}, fetcher);
  return results.map(page => fromRow(page));
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
  return {message, log: log.length ? log : report, ...(job ? {job} : {})};
}

// The activity list: Notion's rows, with this Mac's own record where it's the same run (it has the full log and
// the live lines) and this Mac's records Notion doesn't have yet. `pending`: jobs just sent to GitHub that
// haven't opened their row yet ("Starting on GitHub…").
export function merge(notionRuns, localRuns, pending = []) {
  const byUrl = new Map(localRuns.filter(run => run.notionUrl).map(run => [run.notionUrl.replace(/[?#].*/, ''), run]));
  const used = new Set();
  const merged = notionRuns.map(row => {
    const local = byUrl.get(String(row.notionUrl || '').replace(/[?#].*/, ''));
    if (!local) return row;
    used.add(local);
    return row.live ? {...row, id: local.id} : {...row, ...local, pageId: row.pageId, url: row.url, where: 'mac', result: row.result};
  });
  const oldest = notionRuns.length ? Math.min(...notionRuns.map(row => row.id)) : 0;
  const missing = localRuns.filter(run => !used.has(run) && run.id >= oldest);
  const waiting = pending.filter(job => !notionRuns.some(row => row.mode === job.mode && row.id >= job.id - 60000));
  return {runs: [...merged, ...missing].filter(run => !run.live).sort((a, b) => b.id - a.id),
    live: merged.find(run => run.live) || waiting[0] || null, waiting};
}

// A finished run as a macOS / Windows notification, wherever it ran; null when there's nothing to say
// (a Gmail check that recorded nothing, a Telegram button's small action).
const NAMES = {search: 'Search', mail: 'Gmail check', insight: 'Insight', weekly: 'Weekly report', today: "Today's list",
  scout: 'Find new employers', prepare: 'Application kit', interview: 'Interview review', add: 'Logged activity', rejection: 'Rejection review',
  prep: 'Interview prep kit'};
export function notice(run) {
  if (!NAMES[run.kind] && run.kind) return null;
  const where = run.where === 'github' ? ' (on GitHub)' : '';
  const name = NAMES[run.kind] || 'Jobs check';
  if (run.ok === false || run.off) return {title: `${name} had problems${where}`, body: 'Open Job Pilotto and click the activity bar to see what happened.'};
  if (run.kind === 'mail') {
    const count = run.updates?.length ?? Number(/(\d+) update/.exec(run.result || run.summary || '')?.[1] || 0);
    if (!count) return null;
    return {title: `Gmail: ${count} application update${count === 1 ? '' : 's'}${where}`,
      body: run.updates?.length ? run.updates.slice(0, 3).join('\n') : run.result};
  }
  if (!run.kind || run.kind === 'search') {
    const fresh = run.new;
    return {title: `${run.trigger === 'schedule' ? 'Scheduled jobs check' : 'Jobs check'} done${where}`,
      body: fresh ? `${fresh} new job${fresh === 1 ? '' : 's'} found.` : 'No new jobs this time.'};
  }
  return {title: `${name} done${where}`, body: String(run.result || run.summary || run.message || 'Done.').split('\n')[0].slice(0, 180)};
}
