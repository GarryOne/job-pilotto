// Recent activity from Notion ⏱️ Search runs: every run writes its row there, wherever it ran (this Mac, the
// user's GitHub repo, a Telegram button), from the start (Status Running, with a ⏳ progress line) to the end
// (report, result, technical log). So the app shows the same history as Notion and Telegram, and a job running
// elsewhere still shows its progress here. runs.json on this Mac only fills the gap while a row isn't there yet.
import {call} from './notion.js';
import {CRASH_LINE} from './crash-line.js';
import {jobFrom} from './job-line.js';
import {runWarned} from '../renderer/run-status.js';   // pure (no DOM): the Actions page and this pop-up must call a run "with warnings" by the same rule

export {jobFrom};

const KIND = {scheduled: 'search', run: 'search', first: 'search', today: 'today', mail: 'mail', scout: 'scout', insight: 'insight',
  weekly: 'weekly', kits: 'kits', tailor: 'tailor', visits: 'visits', prepare: 'prepare', interview: 'interview', add: 'add', rejection: 'rejection', prep: 'prep', import: 'import'};
// What started it: the Mac's schedule, you (the app, Telegram, GitHub's Run button) or GitHub's schedule.
const TRIGGER = {'Mac schedule': 'schedule', Schedule: 'schedule'};
const STALE_MS = 3 * 3600 * 1000;  // a row still "Running" after this long lost its job (the machine went away)
// A "Running" row nobody edited for this long lost its job too: a running engine edits it at least every 5 minutes (HEARTBEAT_S,
// src/notion/cron_runs.py). 7 Oct 2026: a run killed hard (a GitHub force-cancel) cannot close its row and showed as running for 3 h.
const LOST_MS = 30 * 60 * 1000;

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
  const seen = Math.max(Date.parse(startedAt), Date.parse(page.last_edited_time || '') || 0);   // its last sign of life
  const running = status === 'Running' && now - Date.parse(startedAt) < STALE_MS && now - seen < LOST_MS;
  const ended = !running && seconds != null ? new Date(Date.parse(startedAt) + seconds * 1000).toISOString() : (running ? undefined : startedAt);
  // Notion keeps start times to the minute: two runs started in the same minute (a scheduled Gmail check and one you
  // started) would share an id, and the activity list would select both. A tie-breaker from the page id (< 1 s).
  const tie = parseInt(String(page.id).replace(/-/g, '').slice(-6), 16) % 1000 || 0;
  // The Interviews page's insights share the daily insight's mode; their result line tells them apart.
  const kind = mode === 'insight' && /^Interview insights\b/.test(summary) ? 'interviewInsight' : KIND[mode] || 'action';
  const record = {id: Date.parse(startedAt) + tie, pageId: page.id, notionUrl: page.url, url: p['Run URL']?.url || null, kind, mode,
    runId: text(p['Run id']) || null,
    trigger: TRIGGER[trigger] || 'you', where: p['Run URL']?.url ? 'github' : /^Mac/.test(trigger) ? 'mac' : 'elsewhere', startedAt};
  // A crash line is not a step (7 Oct 2026: a run killed mid-way left "⏳ Traceback (most recent call last):" on its row, and Recent activity showed it).
  const step = summary.replace(/^⏳\s*/, '');
  if (running) return {...record, live: true, step: step && !CRASH_LINE.test(step) ? step : 'Running'};
  const ok = status !== 'Failed' && !(status === 'Running');  // a stale "Running" row: the job never reported
  const job = ok ? rowJob(p, mode, summary) : null;
  return {...record, endedAt: ended, ok, warned: status === 'Warnings', new: p['New jobs']?.number ?? null, feeds: p.Feeds?.number ?? null, usd: p['AI cost (USD)']?.number || 0,
    billing: p['Billed to']?.select?.name || null,
    result: result(summary, status, p['New jobs']?.number, mode), ...(job ? {job} : {})};
}

// One line on what it did: the row's Summary without the cost, or the count of new jobs for a search.
export function result(summary, status, fresh, mode) {
  if (status === 'Running') return 'never finished (see the log)';
  const cost = String.raw`(?:AI cost \$[\d.]+(?: \+ Claude Code)?|Claude Code, your plan)`;
  const line = summary.replace(new RegExp(String.raw`\s*\(${cost}\)\.?$`), '').replace(new RegExp(String.raw`;?\s*${cost}\.?$`), '').trim();
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

// The jobs the app was running when it quit (queue.json, `interrupted`) are about to start again, and the killed run's row would stay "Running" for up to 3 h: Python can
// close its own row only when it exits by itself. A Mac leaves the orphaned engine running and it finishes; Windows ends the whole process tree, so the row stayed Running
// and the app listed the task as running for hours (the Windows activityfailures run, 3 Oct 2026, #91). The app closes this Mac's matching row first (the new run's row does
// not exist yet). Matched by kind, by a Mac trigger and by the start time (Notion keeps it to the minute); the nearest row wins. Returns the rows it closed.
export async function closeInterrupted(storage, jobs, {fetcher, size = 25, windowMs = 3 * 60 * 1000,
  reason = 'Interrupted: the app was closed before this run finished; it was started again.'} = {}) {
  const wanted = jobs.filter(job => job?.interrupted && (job.queuedAt || job.startedAt));
  if (!wanted.length) return [];
  const rows = (await list(storage, {fetcher, size}) || []).filter(row => row.live && row.where === 'mac');
  const closed = [], taken = new Set();
  for (const job of wanted) {
    const at = new Date(job.queuedAt || job.startedAt).getTime();
    const near = rows.filter(row => !taken.has(row) && row.kind === job.kind && Math.abs(Date.parse(row.startedAt) - at) <= windowMs)
      .sort((a, b) => Math.abs(Date.parse(a.startedAt) - at) - Math.abs(Date.parse(b.startedAt) - at))[0];
    if (!near) continue;
    taken.add(near);
    if (await closeStopped(storage, near.notionUrl, reason, {fetcher})) closed.push({kind: near.kind, pageId: near.pageId, startedAt: near.startedAt});
  }
  return closed;
}

// A run the app stopped without knowing which row was its (an orphaned engine run, lib/orphans.js): the Mac's Running rows that began when it did (Notion keeps the
// minute). `startedAt`: when the run began. Returns the rows it closed.
export async function closeLost(storage, startedAt, reason, {fetcher, size = 25, windowMs = 3 * 60 * 1000} = {}) {
  const rows = (await list(storage, {fetcher, size}) || []).filter(row => row.live && row.where === 'mac' && Math.abs(Date.parse(row.startedAt) - startedAt) <= windowMs);
  const closed = [];
  for (const row of rows) if (await closeStopped(storage, row.notionUrl, reason, {fetcher})) closed.push({kind: row.kind, pageId: row.pageId, startedAt: row.startedAt});
  return closed;
}

// ---- Runs made on this Mac that never got a row (before Notion was connected, or a row write that failed) -> ⏱️ Search runs ----
// 7 Oct 2026: runs made while trying the app stayed only in runs.json (listed by merge(), never in Notion or Telegram /status). Each
// finished local run with no row is written as the engine would have (src/notion/cron_runs.py run_page + extra_blocks); a row of the
// same kind that started within 3 minutes is taken as its own instead (its "Cronjob run logged" line was lost). A GitHub run writes its own.
const MODE = {...Object.fromEntries(Object.entries(KIND).filter(([mode]) => !['scheduled', 'first'].includes(mode)).map(([mode, kind]) => [kind, mode])), interviewInsight: 'insight'};
const LOG_LINES = 80;
const rich = value => ({rich_text: value ? [{text: {content: String(value).slice(0, 1900)}}] : []});
const block = (type, content) => ({object: 'block', type, [type]: rich(content)});

// -> {properties, children} of the row for one local run (record as pipeline.js tracked() keeps it).
export function localRow(run, name = kind => kind) {
  const search = run.kind === 'search';
  const fresh = search && run.new != null ? (run.new ? `${run.new} new job${run.new === 1 ? '' : 's'}` : 'nothing new') : null;
  const why = [...(run.log || [])].reverse().find(line => /\bfailed:\s*\S/i.test(line));   // tracked() logs "<task> failed: <error>"
  const summary = run.ok ? (run.summary || run.problem || fresh || 'Done') : (run.problem || run.summary || why || `${name(run.kind)} failed`);
  const warned = run.ok && (run.problem || run.warnings?.length);
  const properties = {
    Run: {title: [{text: {content: `${name(run.kind)} · on this Mac`}}]},
    Started: {date: {start: run.startedAt}},
    'Duration (s)': {number: Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000))},
    Mode: {select: {name: MODE[run.kind]}},
    Trigger: {select: {name: run.trigger === 'schedule' ? 'Mac schedule' : 'Mac (you)'}},
    Status: {select: {name: !run.ok ? 'Failed' : warned ? 'Warnings' : 'OK'}},
    'AI cost (USD)': {number: Math.round((run.usd || 0) * 10000) / 10000},
    Summary: rich(fresh && run.ok && !run.summary ? `${fresh}.` : summary),
    ...(search && run.new != null ? {'New jobs': {number: run.new}} : {}),
    ...(search && run.feeds != null ? {Feeds: {number: run.feeds}} : {}),
    ...(run.runId ? {'Run id': rich(run.runId)} : {}),
  };
  const lines = (run.log || []).slice(-LOG_LINES);
  const message = String(run.message || '').split('\n').filter(line => line.trim()).slice(0, 40);
  const children = [block('heading_3', 'Report'), block('bulleted_list_item', summary),
    block('paragraph', 'Run on this Mac before this database had it (Notion not yet connected, or its row could not be written); copied from the app.'),
    ...(message.length ? [block('heading_3', 'Result'), ...message.map(line => block('paragraph', line))] : []),
    ...(lines.length ? [{object: 'block', type: 'toggle', toggle: {...rich(`Technical log (last ${lines.length} lines)`),
      children: Array.from({length: Math.ceil(lines.length / 25)}, (_, i) => ({object: 'block', type: 'code',
        code: {language: 'plain text', ...rich(lines.slice(i * 25, i * 25 + 25).join('\n'))}}))}}] : [])];
  return {properties, children: children.slice(0, 95)};
}

// Writes the rows; `runs`/`save` read and write runs.json (pipeline.runs / saveRuns), `name` a task's name. Each run written (or matched)
// gets its row's notionUrl at once, so merge() shows it once and a retry never writes it twice. -> {written, linked, failed, skipped}
export async function copyLocal(storage, {fetcher, runs, save, name, windowMs = 3 * 60 * 1000} = {}) {
  const token = storage.secret('NOTION_TOKEN'), db = ids(storage).NOTION_CRON_RUNS_DB;
  const out = {written: 0, linked: 0, failed: 0, skipped: 0};
  if (!token || !db) return out;
  const wanted = runs().filter(run => !run.notionUrl && !run.url && run.endedAt && run.startedAt);
  for (const run of wanted) {
    if (!MODE[run.kind]) { out.skipped++; continue; }   // a kind with no Mode in Notion: stays listed from runs.json
    try {
      const at = Date.parse(run.startedAt);
      const {results = []} = await call(token, 'POST', `databases/${db}/query`, {page_size: 5, filter: {and: [
        {property: 'Mode', select: {equals: MODE[run.kind]}},
        {property: 'Started', date: {on_or_after: new Date(at - windowMs).toISOString()}},
        {property: 'Started', date: {on_or_before: new Date(at + windowMs).toISOString()}}]}}, fetcher);
      let url = results[0]?.url;
      if (url) out.linked++;
      else {
        const {properties, children} = localRow(run, name);
        url = (await call(token, 'POST', 'pages', {parent: {database_id: db}, properties, children}, fetcher)).url;
        out.written++;
      }
      save(runs().map(other => other.id === run.id ? {...other, notionUrl: url} : other));   // read again: a run may have ended meanwhile
    } catch {
      out.failed++;   // retried next start (migrate.js); the count goes to the log
    }
  }
  return out;
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

// The activity list: Notion's rows, with this Mac's own record where it's the same run (it has the full log and
// the live lines) and this Mac's records Notion doesn't have yet. `pending`: jobs just sent to GitHub that
// haven't opened their row yet ("Starting on GitHub…").
// The page a Notion address points to: its 32-character id, which survives a rename (the title slug in front of it changes when a run's
// row is renamed at the end: "… Jobs check" -> "… Jobs check, 3 new jobs"). Addresses with no id (or a test's short one) compare as written.
const pageKey = url => {
  const clean = String(url || '').replace(/[?#].*/, '');
  return (/([0-9a-f]{32})$/i.exec(clean.replace(/-/g, ''))?.[1] || clean).toLowerCase();
};
export function merge(notionRuns, localRuns, pending = []) {
  const byUrl = new Map(localRuns.filter(run => run.notionUrl).map(run => [pageKey(run.notionUrl), run]));
  const used = new Set();
  const merged = notionRuns.map(row => {
    const local = byUrl.get(pageKey(row.notionUrl));
    if (!local) return row;
    used.add(local);
    // This Mac saw the run end (its record has endedAt): its row is not live, even if Notion still says Running (7 Oct 2026: a search stopped
    // from outside could not close its row, and Activity showed it running with an empty log after a reload).
    return row.live && !local.endedAt ? {...row, id: local.id}
      : {...row, ...local, live: false, pageId: row.pageId, url: row.url, where: 'mac', result: row.result};
  });
  const oldest = notionRuns.length ? Math.min(...notionRuns.map(row => row.id)) : 0;
  // A run that never got a Notion row (before Notion was connected, or its row write failed) is only here: always kept.
  // One that had a row is kept while it is inside Notion's window (6 Oct 2026: connecting Notion hid every earlier run).
  const missing = localRuns.filter(run => !used.has(run) && (!run.notionUrl || run.id >= oldest));
  // A job sent to GitHub is waiting until its row exists. The run URL is the sure match (the row's start can
  // sit outside the one-minute window). The time window covers the moment before the link is known.
  const sameRun = (job, row) => {
    const want = String(job.runUrl || job.url || '').replace(/\/job\/\d+$/, '');
    const got = String(row.url || '').replace(/\/job\/\d+$/, '');
    return (want && got && want === got) || (row.mode === job.mode && row.id >= job.id - 60000);
  };
  const waiting = pending.filter(job => !notionRuns.some(row => sameRun(job, row)));
  return {runs: [...merged, ...missing].filter(run => !run.live).sort((a, b) => b.id - a.id),
    live: merged.find(run => run.live) || waiting[0] || null, waiting};
}

// A finished run as a macOS / Windows notification, wherever it ran; null when there's nothing to say
// (a Gmail check that recorded nothing, a Telegram button's small action).
const NAMES = {search: 'Refresh jobs', mail: 'Gmail check', insight: 'Insight', interviewInsight: 'Interview insights', weekly: 'Search analysis', kits: 'Prepare top matches', today: "Today's list",
  scout: 'Find new employers', prepare: 'Application kit', interview: 'Interview review', add: 'Logged activity', rejection: 'Rejection review',
  prep: 'Interview prep kit', import: 'Add a job', tailor: 'Tailor CVs'};
// A notification is the news of one run, so a click opens that run's result (Recent activity, the run selected); renderer/targets.js says how.
export function notice(run) {
  const said = noticeText(run);
  return said && (run.id == null ? said : {...said, target: {run: run.id}});   // no id, nothing to open
}
function noticeText(run) {
  if (!NAMES[run.kind] && run.kind) return null;
  const where = run.where === 'github' ? ' (on GitHub)' : '';
  const name = NAMES[run.kind] || 'Refresh jobs';
  if (run.ok === false || run.off) return {title: `${name} had problems${where}`, body: 'Open Job Pilotto and click the activity bar to see what happened.'};
  if (run.kind === 'mail') {
    const count = run.updates?.length ?? Number(/(\d+) update/.exec(run.result || run.summary || '')?.[1] || 0);
    if (!count) return null;
    return {title: `Gmail: ${count} application update${count === 1 ? '' : 's'}${where}`,
      body: run.updates?.length ? run.updates.slice(0, 3).join('\n') : run.result};
  }
  // A run that worked but said something (its Status is Warnings, or its log has a warning line) is not "done": the Actions page already calls it "With warnings",
  // and a pop-up that says "done" over a refused AI call is the contradiction the UI loop found (#51, #52).
  const verdict = runWarned(run) ? 'finished with warnings' : 'done';
  const look = runWarned(run) ? ' Open Job Pilotto to see what it said.' : '';
  if (!run.kind || run.kind === 'search') {
    const fresh = run.new;
    return {title: `${run.trigger === 'schedule' ? 'Scheduled job refresh' : 'Refresh jobs'} ${verdict}${where}`,
      body: (fresh ? `${fresh} new job${fresh === 1 ? '' : 's'} found.` : 'No new jobs this time.') + look};
  }
  return {title: `${name} ${verdict}${where}`, body: String(run.result || run.summary || run.message || 'Done.').split('\n')[0].slice(0, 180) + look};
}
export {KIND as RUN_KINDS};   // every app task kind must be here, or its runs never get a Notion row (test/run-kinds.test.js)
