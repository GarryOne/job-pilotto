// Recent activity: the bar at the bottom of every screen and its panel.
import {runWarnings} from '../run-warnings.js';
import {el, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {parseRunMessage} from '../run-cards.js';
import {shared} from './shared.js';
import {showScheduleState} from './connections.js';
import {answer} from './actions.js';
import {$, osText, show} from './core.js';
import {loadJobs, renderJobs} from './jobs.js';
import {loadFocus} from './focus.js';
import {openView} from './nav.js';
import {renderActionsPage} from './runs-page.js';
import {openSetting} from './settings.js';
import {toastMessage} from './startup.js';
import {renderDraft} from './strategy-review.js';
import {goStep} from './wizard.js';

// ---------- runs ----------
const TRIGGER = {you: 'You', schedule: 'Schedule', first: 'First search'};
export const clockTime = iso => new Date(iso).toLocaleString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'});
const duration = (a, b) => { const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
// The line under "Jobs": what's happening now, or when the last search ran.
export async function showSearchStatus() {
  const {running, lastSearchAt, runs} = await window.pilot.runs();
  const box = $('search-status');
  const [title, detail] = [box.querySelector('b'), box.querySelector('small')];
  const searching = running && (running.kind || 'search') === 'search';
  box.dataset.state = searching ? 'busy' : lastSearchAt ? 'ok' : 'none';
  // Running: a link to its progress (the bottom bar's panel); done: what it found.
  if (searching) { title.textContent = 'Checking for new jobs →'; detail.textContent = searchPhase(running.step) || 'Starting…'; return; }
  if (!lastSearchAt) { title.textContent = 'No check yet'; detail.textContent = ''; return; }
  const last = runs.find(run => (run.kind || 'search') === 'search');
  title.textContent = last && !last.ok ? 'Last check had problems →' : `Check complete${last?.new != null ? ` · ${last.new} new match${last.new === 1 ? '' : 'es'}` : ''}`;
  detail.textContent = `${clockTime(lastSearchAt)}${last?.usd ? ` · $${last.usd.toFixed(2)}` : ''}`;
}

// ---------- activity bar (bottom of every screen) ----------
// Plain-language phases of a search, recognised from its log lines.
const PHASES = [
  {match: /^Searching job boards/, label: 'Job boards (jobs.ch, TechTree)'},
  {match: /^Checking employer career pages/, label: 'Employer career pages, then reading and scoring new jobs'},
];
// A search's current log line as a short phrase for the header and the bottom bar (the raw line is in the log).
function searchPhase(step = '') {
  const phase = PHASES.find(item => item.match.test(step));
  if (phase) return phase.label;
  let m;
  if ((m = step.match(/^Scored (\d+) of (\d+)/))) return `Scoring new jobs · ${m[1]} of ${m[2]}`;
  if ((m = step.match(/^Enriched (\d+) of (\d+)/))) return `Reading new jobs · ${m[1]} of ${m[2]}`;
  if (/^Checked: /.test(step)) return 'Employer career pages';
  if (/^Job Matches:/.test(step)) return 'Saving to Notion';
  if (/digest|telegram/i.test(step)) return 'Sending your digest';
  return step.length > 60 ? `${step.slice(0, 57)}…` : step;
}
export const KIND = {search: {icon: '🔎', name: 'Jobs check'}, mail: {icon: '📧', name: 'Gmail check'}, insight: {icon: '💡', name: 'Insight'},
  weekly: {icon: '📊', name: 'Weekly report'}, today: {icon: '📋', name: "Today's list"}, scout: {icon: '🔭', name: 'Find new employers'},
  action: {icon: '⚡', name: 'Telegram action'}, prepare: {icon: '📝', name: 'Application kit'}, interview: {icon: '🎤', name: 'Interview review'},
  add: {icon: '➕', name: 'Tracked application'}, rejection: {icon: '🔍', name: 'Rejection review'}};
export const kindOf = run => (KIND[run?.kind] ? run.kind : 'search');
const WHO = {schedule: 'scheduled', you: 'by you', first: 'first check'};
const WHERE = {github: '☁️ GitHub', mac: 'this Mac'};  // where a run ran, after who started it
// A run's status pill (Recent activity): running, queued, failed, completed with warnings, completed.
function runStatus(run, warned) {
  if (run.live) return ['Running', 'info', {dot: true}];
  if (run.waiting) return ['Queued', 'neutral'];
  if (!run.ok || run.off) return ['Failed', 'bad'];
  return warned ? ['With warnings', 'warn'] : ['Completed', 'good'];
}
// The warnings in one plain sentence (the list is one click away).
function warningSummary(warnings) {
  if (warnings.some(text => /429|Too Many Requests/i.test(text))) {
    return 'Notion was busy (rate limit): saved settings were used and some Notion steps were skipped. They run again next time.';
  }
  return warnings[0] || '';
}
// A Recent activity row's label: gray "Queued" while it waits, gray "Scheduled" for the schedule's runs,
// green "Started by you" for the ones you started.
function runBadge(run) {
  if (run.waiting) return ['Queued', 'neutral'];
  if (run.trigger === 'schedule') return ['Scheduled' + (run.where === 'github' ? ' · ☁️ GitHub' : ''), 'neutral'];
  return [capital(WHO[run.trigger] || run.trigger) + runBadgeWhere(run), run.trigger === 'you' ? 'good' : 'neutral'];
}
// Where it ran, when not on this Mac (a run read from Notion: the user's GitHub repo, or elsewhere).
const runBadgeWhere = run => (run.where === 'github' ? ' · ☁️ GitHub' : '');
const runResults = new Map();  // run id -> the message a finished task produced, for Recent activity
export let lastActivity = null;
const runDetails = new Map();  // a Notion run's result and log, read once (pageId -> {message, log})
function phaseIndex(lines) {
  let index = -1;
  lines.forEach(line => PHASES.forEach((phase, i) => { if (phase.match.test(line)) index = i; }));
  return index;
}
export const hhmm = ms => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const capital = text => String(text || '').replace(/^./, c => c.toUpperCase());
// One line on what a finished run did.
export function outcome(run) {
  if (run.result) return run.result;  // a run read from Notion ⏱️ Search runs says it itself
  if (kindOf(run) === 'mail') {
    if (run.off) return 'Gmail not connected (Settings → Gmail and Calendar)';
    if (run.problem) return run.problem;
    if (!run.ok) return 'had problems';
    if (run.updates?.length) return plural(run.updates.length, 'application update');
    // "Mail: 2 new email(s) classified, 0 update(s), …": emails were read but none changed an application.
    const read = Number(/^Mail: (\d+) new email/.exec(run.summary || '')?.[1] || 0);
    return read ? `${plural(read, 'email')} checked · no updates` : 'nothing new';
  }
  if (!run.ok) return 'had problems';
  // A one-off job (insight, weekly report, today's list, find employers): the result line it printed.
  if (kindOf(run) !== 'search') return run.summary || 'done';
  return run.new != null ? plural(run.new, 'new job') : 'done';
}
// An Actions page command waits for its run (by kind) to end, then its answer shows the result.
export const COMMAND_KIND = {insight: 'insight', weekly: 'weekly', today: 'today', scout: 'scout', mail: 'mail', run: 'search'};
function showAwaitedResult(runs) {
  const run = shared.awaitedRun && runs.find(r => kindOf(r) === shared.awaitedRun.kind && r.id >= shared.awaitedRun.since && r.endedAt);
  if (!run) return;
  shared.awaitedRun = null;
  const kind = KIND[kindOf(run)];
  const show = message => {
    const text = `${kind.icon} ${kind.name}: ${message ? `\n\n${message}` : capital(outcome(run))}`;
    if ($('activity-panel').hidden) { answer(text); return; }
    runResults.set(run.id, message || capital(outcome(run)));  // shown under the run in Recent activity
    shared.selectedRun = run.id;
    renderActivity(lastActivity);
  };
  if (run.message || !run.pageId) show(run.message);
  else window.pilot.runDetail(run.pageId).then(detail => show(detail.message), () => show(null));  // on its Notion page
}
// The status bar's last finished state, kept on this Mac: shown the moment the window opens, instead of
// "No jobs check yet" until the run history has been read (from Notion). A running state is never kept.
const STATUS_KEPT = 'statusBar';
function keepStatusBar() {
  const kept = {state: $('activity').dataset.state, title: $('activity-title').textContent,
    step: $('activity-step').textContent, meta: $('activity-meta').textContent};
  try { localStorage.setItem(STATUS_KEPT, JSON.stringify(kept)); } catch {}
}
function showKeptStatusBar() {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(STATUS_KEPT) || 'null'); } catch {}
  if (!kept?.title || lastActivity) return;
  $('activity').dataset.state = kept.state || 'idle';
  $('activity-title').textContent = kept.title;
  $('activity-step').textContent = kept.step;
  $('activity-meta').textContent = kept.meta;
}
// Recent activity kept on this Mac: until the run history has been read from Notion (the runs of GitHub and Telegram
// live there), the panel shows the list from last time, with this Mac's newer runs on top, instead of an empty panel.
const ACTIVITY_KEPT = 'recentActivity';
function withKept(data) {
  if (data.historyLoaded) {
    try { localStorage.setItem(ACTIVITY_KEPT, JSON.stringify(data.runs.slice(0, 20))); } catch {}
    return data;
  }
  let kept = [];
  try { kept = JSON.parse(localStorage.getItem(ACTIVITY_KEPT) || '[]'); } catch {}
  if (!kept.length) return data;
  const byId = new Map(kept.map(run => [run.id, run]));
  for (const run of data.runs) byId.set(run.id, run);  // this Mac's copy is the newer one
  const runs = [...byId.values()].sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return {...data, runs};
}
// Recent activity lists what Job Pilotto ran (schedules, checks, background AI work), not what you did yourself:
// a Log box entry (kind "add") is on the job's page and in Notion's run history, and a failed one still notifies.
export const scheduled = run => kindOf(run) !== 'add';
export function renderActivity(fresh) {
  const data = withKept(fresh);
  renderActionsPage(data);
  lastActivity = data;
  // Settings → Automation shows the same next times beside each schedule.
  shared.nextRuns = {search: data.nextSearchAt, mail: data.nextMailAt, scout: data.nextScoutAt};
  showScheduleState(shared.nextRuns);
  showAwaitedResult(data.runs);
  const {running, runs, nextSearchAt, nextMailAt, nextScoutAt} = data;
  if (!running) shared.idleSeen = true;
  const last = runs[0];
  const lastSearch = runs.find(run => kindOf(run) === 'search');
  const lastMail = runs.find(run => kindOf(run) === 'mail');
  $('activity').dataset.state = running ? 'busy' : last && (!last.ok || last.off) ? 'error' : last ? 'ok' : 'idle';
  const liveLines = running ? shared.logLines : null;
  const checked = (liveLines || []).filter(line => /^Checked: /.test(line)).length;
  const soon = at => (at <= Date.now() ? 'due now' : clockTime(new Date(at).toISOString()));  // a past time = runs at the next check
  const mailNote = lastMail ? `📧 Gmail ${lastMail.off ? 'not connected' : `checked ${clockTime(lastMail.endedAt || lastMail.startedAt)} · ${outcome(lastMail)}`}`
    : nextMailAt ? `📧 First Gmail check ${nextMailAt <= Date.now() ? 'due now' : hhmm(nextMailAt)}` : '';
  if (running) {
    const kind = KIND[kindOf(running)];
    const next = (data.queued || []).length;
    $('activity-title').textContent = kindOf(running) === 'search' ? `Checking for new jobs${running.where === 'github' ? ' (on GitHub)' : ''}${next ? ` · ${next} queued` : ''}`
      : `${kind.icon} ${kind.name} running (${WHO[running.trigger] || running.trigger}${running.where === 'github' ? ', on GitHub' : ''})${next ? ` · ${next} queued` : ''}`;
    $('activity-step').textContent = searchPhase(running.step) || running.step || 'Starting…';
    barLabel();
    $('activity-meta').textContent = [duration(running.startedAt, new Date().toISOString()), checked && `${checked} companies checked`].filter(Boolean).join(' · ');
  } else if (lastSearch || lastMail) {
    barLabel();
    $('activity-title').textContent = lastSearch ? (lastSearch.ok ? 'Last jobs check' : 'Last jobs check had problems') : 'No jobs check yet';
    $('activity-step').textContent = lastSearch ? `${clockTime(lastSearch.endedAt || lastSearch.startedAt)} · ${outcome(lastSearch)}` +
      (lastSearch.ok ? '' : ' · click to see why') : '';
    // The next jobs check, unless the open panel's Upcoming checks already says it.
    $('activity-meta').textContent = [mailNote, $('activity-panel').hidden && nextSearchAt && `Next jobs check ${hhmm(nextSearchAt)}`].filter(Boolean).join(' · ');
  } else {
    $('activity-title').textContent = 'No jobs check yet';
    $('activity-step').textContent = 'Click "Check for new jobs" on Jobs to start one.';
    $('activity-meta').textContent = mailNote;
  }
  if (!running) keepStatusBar();

  // Recent activity: newest first; click one to see its log below.
  const shown = runs.find(run => run.id === shared.selectedRun) || null;
  // Newest on top: the queued ones (the latest queued first), then the running one, then the finished ones.
  // Each queued one says what it waits for: the one queued before it, or the running task.
  const queue = data.queued || [];
  const waiting = queue.map((run, i) => ({...run, waiting: true,
    after: i ? KIND[kindOf(queue[i - 1])].name : running ? KIND[kindOf(running)].name : 'the current task'})).reverse();
  const recent = waiting.concat(running ? [{...running, live: true}] : [], runs.filter(scheduled).slice(0, 8));
  $('activity-count').textContent = `${recent.length} recent`;
  $('activity-recent').replaceChildren(...recent.map(run => {
    const item = document.createElement('li');
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'recent-row'});
    button.classList.toggle('current', run.live ? !shown : shown ? run.id === shown.id : run === last && !running);
    button.dataset.state = run.live ? 'busy' : run.waiting ? 'queued' : run.ok && !run.off ? 'ok' : 'error';
    const kind = KIND[kindOf(run)];
    // Status circle, its icon, what ran and (under it) when, what it found and who started it; its status pill.
    const warned = !run.live && !run.waiting && run.ok && !run.off && runWarnings(run.log || []).length > 0;
    if (warned) button.dataset.state = 'warn';
    const words = el('span', 'run-words');
    words.append(el('b', 'run-kind', kind.name), el('span', 'muted run-what', run.live ? `Running now · ${searchPhase(run.step) || 'starting'}` : run.waiting
      ? `Waiting · starts after ${run.after}`
      : [clockTime(run.endedAt || run.startedAt), capital(outcome(run)), WHO[run.trigger] || run.trigger, WHERE[run.where]].filter(Boolean).join(' · ')));
    button.append(el('span', 'run-status'), el('span', 'run-icon', kind.icon), words, pill(...runStatus(run, warned)));
    button.addEventListener('click', () => { if (run.waiting) return; shared.selectedRun = run.live ? null : run.id; renderActivity(lastActivity); });
    item.append(button);
    return item;
  }));
  if (!runs.length && !running) $('activity-recent').append(Object.assign(document.createElement('li'), {className: 'muted', textContent: 'Nothing has run yet.'}));

  // How often: from Settings → How often (GitHub does it when Always on is on).
  const cloud = !!shared.state?.settings?.cloud?.repo;
  // A card per scheduled task: what, which day, and the time in large type (or why there's none).
  // "Gmail check · Today 18:00": its icon, what, and when (Today / Tomorrow / the weekday).
  const day = at => {
    const date = new Date(at), today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return date.toDateString() === today.toDateString() ? 'Today' : date.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
      : date.toLocaleDateString([], {weekday: 'short'});
  };
  const plan = {search: 4, mail: 3, scout: 'daily', ...(shared.state?.settings?.schedule || {})};
  // No time: "Off" only when Settings → Automation says so; else the app just doesn't know it yet (it was started
  // before an update: a restart fixes it), so it names where it runs.
  const unknown = cloud ? 'On GitHub' : 'On this Mac';
  const items = [['Jobs', 'search', nextSearchAt, plan.search ? unknown : 'When you ask'], ['Gmail', 'mail', nextMailAt, plan.mail ? unknown : 'Off'],
    ...(cloud ? [['Employers', 'building', nextScoutAt, plan.scout !== 'off' ? unknown : 'Off']] : [])];
  const soonest = Math.min(...items.map(([, , at]) => at || Infinity));
  $('activity-schedule').replaceChildren(...items.map(([name, glyph, at, none]) => {
    const item = el('span', `ap-item${at && at === soonest ? ' is-next' : ''}${at ? '' : ' is-off'}`);
    const words = el('span', 'ap-item-words');
    words.append(el('span', 'muted', name), el('b', '', at ? (at <= Date.now() ? 'Due now' : `${day(at)} ${hhmm(at)}`) : none));
    const mark = el('span', 'ap-item-icon');
    mark.append(icon(glyph));
    item.append(mark, words);
    return item;
  }));
  // A narrow window shows the soonest one and "+2" (a click shows the rest).
  const hiddenCount = items.filter(([, , at]) => !(at && at === soonest)).length;
  $('ap-strip-more').textContent = `+${hiddenCount}`;
  show($('ap-strip-more'), hiddenCount > 0);
  $('ap-where').textContent = cloud ? osText('☁️ Runs on GitHub · Always on') : 'Runs on this Mac while the app is open';
  $('ap-where').title = cloud ? 'Your GitHub repository runs these, even with your Mac off. GitHub may start a scheduled run a few minutes late.' : '';
  // Check Gmail now: with a selected Gmail check, not in the schedule strip.
  const selected = shown || (running ? null : last);
  show($('check-mail'), !!selected && kindOf(selected) === 'mail');

  // The selected run (or the live / latest one): what it did, its phases, and its full log. A run read from
  // Notion brings its result and log from its page the first time it's shown.
  const picked = shown || (running ? {...running, live: true} : last);
  const run = picked?.pageId && !picked.log && !picked.live ? {...picked, ...runDetails.get(picked.pageId)} : picked;
  if (run?.pageId && !run.log && !run.live && !runDetails.has(run.pageId)) {
    runDetails.set(run.pageId, {log: ['Reading from Notion…']});
    // A run that just finished may not have its log on its page yet (it's written a moment after the status):
    // an empty answer is read again a few times before it's kept.
    const read = (tries = 0) => window.pilot.runDetail(run.pageId).then(detail => {
      const empty = !detail?.message && !(detail?.log || []).length;
      if (empty && tries < 4) {
        runDetails.set(run.pageId, {log: ['Waiting for the log from Notion…']});
        setTimeout(() => read(tries + 1), 5000);
      } else runDetails.set(run.pageId, empty ? {log: ['This run left no log on its Notion page.']} : detail);
      renderActivity(lastActivity);
    });
    read();
  }
  // The log of the run shown, with what was read from its Notion page merged in (a GitHub run's log lives there).
  const lines = shown ? run?.log || [] : liveLines || run?.log || [];
  const kind = run ? KIND[kindOf(run)] : null;
  const detailWarnings = runWarnings(lines);
  const status = !run ? '' : run.live ? 'Running' : run.waiting ? 'Queued' : !run.ok || run.off ? 'Failed'
    : detailWarnings.length ? 'Completed with warnings' : 'Completed';
  $('activity-icon').textContent = kind?.icon || '';
  $('activity-selected').textContent = !run ? 'Nothing has run yet' : `${kind.name} · ${status}`;
  const checkedCount = lines.filter(line => /^Checked: /.test(line)).length;
  // What it found, without repeating the task's name ("Gmail check: 4 new emails…" → "4 new emails…").
  const said = run && !run.live ? capital(String(outcome(run)).replace(new RegExp(`^${kind?.name || ''}:\\s*`, 'i'), '')) : '';
  $('activity-sub').textContent = !run ? '' : [run.live ? (searchPhase(run.step) || 'starting') : said,
    checkedCount && `${checkedCount} companies checked`].filter(Boolean).join(' · ');
  // Small facts under it: when, how long, the AI cost, where it ran.
  const seconds = run?.endedAt && run.startedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : null;
  const facts = !run ? [] : [
    run.live ? `Started ${hhmm(Date.parse(run.startedAt))}` : `Finished ${hhmm(Date.parse(run.endedAt || run.startedAt))}`,
    !run.live && seconds > 0 && (seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`),
    !run.live && run.usd > 0 && `AI $${run.usd.toFixed(3)}`,
    run.where === 'github' ? osText('☁️ GitHub') : run.where === 'mac' ? 'This Mac' : ''].filter(Boolean);
  $('activity-facts').replaceChildren(...facts.map(text => el('span', 'ap-fact', text)));
  show($('activity-facts'), facts.length > 0);
  // A search that found new jobs: straight to them (newest first).
  const found = !run?.live && kindOf(run) === 'search' ? run?.new || 0 : 0;
  show($('activity-go'), found > 0);
  $('activity-go').textContent = `View new job${found === 1 ? '' : 's'} →`;
  show($('activity-notion'), !!run?.notionUrl);
  $('activity-notion').dataset.url = run?.notionUrl || '';
  show($('activity-github'), !!run?.url);  // a run in the user's GitHub repo (Always on)
  $('activity-github').dataset.url = run?.url || '';
  const result = run && !run.live ? runResults.get(run.id) || '' : '';
  $('activity-result').textContent = result;
  show($('activity-result'), !!result);
  const updates = !run?.live && kindOf(run) === 'mail' ? run.updates || [] : [];
  const at = run && kindOf(run) === 'search' ? phaseIndex(lines) : -1;
  const live = !!run?.live;
  $('activity-phases').replaceChildren(...(updates.length ? updates.map(text => Object.assign(document.createElement('li'), {className: 'update', textContent: text}))
    : PHASES.map((phase, i) => {
      const status = i < at || (i === at && !live) ? 'done' : i === at ? 'now' : 'todo';
      return Object.assign(document.createElement('li'), {className: status, textContent: phase.label});
    })));
  show($('activity-phases'), updates.length > 0 || at >= 0);
  // What a one-off job produced (the insight, the list, the report) when it wasn't sent to Telegram.
  // Today's list and Find new employers read better as a small card; anything else stays text.
  const card = !run?.live && run?.message ? parseRunMessage(run.message) : null;
  if (card) renderRunCard(card);
  show($('activity-card'), !!card);
  $('activity-message').textContent = !run?.live && !card && run?.message || '';
  show($('activity-message'), !run?.live && !card && !!run?.message);
  // Warnings (Notion busy, a step skipped…) shown plainly above the log, not buried in it.
  const warnings = detailWarnings;
  show($('activity-warnings'), warnings.length > 0);
  if (warnings.length) {
    $('activity-warnings-title').textContent = run?.live ? 'Running with warnings' : 'Completed with warnings';
    $('activity-warnings-summary').textContent = warningSummary(warnings);
    const listShown = !$('activity-warnings-list').hidden && $('activity-warnings-list').dataset.for === String(run?.id);
    $('activity-warnings-list').dataset.for = String(run?.id);
    show($('activity-warnings-list'), listShown);
    $('activity-warnings-more').textContent = listShown ? 'Hide details' : `View ${warnings.length} detail${warnings.length === 1 ? '' : 's'}`;
    $('activity-warnings-list').replaceChildren(...warnings.map(text => el('li', '', text)));
  }
  // The full log stays folded (the stages come first); open by itself only when the task went wrong.
  const failed = run && !run.live && (!run.ok || run.off);
  if (run && $('activity-log').dataset.for !== String(run.id)) {
    $('activity-log').dataset.for = String(run.id);
    $('activity-log').open = !!failed;
  }
  $('log-count').textContent = lines.length ? `· ${plural(lines.length, 'line')}` : '';
  const log = $('log');
  const text = lines.join('\n') || (run?.live ? 'Nothing to show yet.' : 'No log for this run.');
  if (log.textContent !== text) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren(...linked(text));
    if (atBottom) log.scrollTop = log.scrollHeight;  // follow new lines unless the user scrolled up to read
  }
}
// Text with its web addresses as links (the run's Notion page, a GitHub run…); the log's click handler opens them.
function linked(text) {
  return text.split(/(https?:\/\/[^\s<>"')\]]+)/).map((part, i) => i % 2
    ? Object.assign(document.createElement('a'), {href: part, textContent: part, className: 'log-link'})
    : document.createTextNode(part));
}
// Re-render soon (log lines arrive in bursts; one read of the run state per burst).
let activityTimer = null;
export function refreshActivity() {
  if (activityTimer) return;
  activityTimer = setTimeout(async () => { activityTimer = null; renderActivity(await window.pilot.runs()); }, 250);
}
let expandedCard = '';  // the employers card showing all its rows (by its companies)
// A run's message as a card: a row of counts, then one line per item (the full text: Open in Notion).
function renderRunCard(card) {
  // One light line of counts ("37 open · 2 in Switzerland · 18 applied"), then one line per item.
  const stat = (value, label) => { const cell = el('span', 'run-card-stat'); cell.append(el('b', '', String(value ?? '–')), ` ${label}`); return cell; };
  const stats = el('div', 'run-card-stats');
  const rows = el('ol', 'run-card-rows');
  let heading, more = null;
  if (card.kind === 'digest') {
    stats.append(stat(card.open, 'open'), stat(card.local, 'in Switzerland'), stat(card.applied, 'applied'), stat(card.fresh, 'new this run'));
    heading = 'Top matches';
    rows.append(...card.items.slice(0, 3).map(item => {
      const row = el('li', 'run-card-row');
      const words = el('span', 'run-card-words');
      words.append(el('b', '', item.title), el('span', 'muted', ` · ${item.company}`));
      const view = Object.assign(el('a', 'run-card-open', '↗'), {href: '#', title: 'Open the job posting'});
      view.dataset.link = item.url;
      row.append(words, el('span', `run-card-fit${item.fit >= 70 ? ' is-high' : ''}`, String(item.fit)), view);
      return row;
    }));
    more = el('button', 'link', `View all ${card.items.length} in Jobs →`);
    more.addEventListener('click', () => { openActivity(false); openView('jobs'); });
  } else {
    stats.append(stat(card.checked, 'employers checked'), stat(card.fresh, 'new job feeds'));
    heading = 'New employers';
    // Five at first; "+2 more" shows the rest here (Show less folds them), and the Employers database has them all.
    const all = card.items.length > 5 && expandedCard === card.items.map(item => item.company).join('|');
    rows.append(...card.items.slice(0, all ? undefined : 5).map(item => {
      const row = el('li', 'run-card-row');
      const words = el('span', 'run-card-words');
      words.append(el('b', '', item.company), el('span', 'muted', ` · ${[item.ats, item.roles != null && `${item.roles} SRE role${item.roles === 1 ? '' : 's'}`,
        item.yours != null && `${item.yours} in your places`].filter(Boolean).join(' · ')}`));
      row.append(words, ...(item.tier ? [el('span', 'run-card-fit', item.tier.replace('Tier ', 'T'))] : []));
      return row;
    }));
    more = el('div', 'run-card-foot');
    const rest = card.items.length - 5;
    if (rest > 0) {
      const toggle = el('button', 'link', all ? 'Show less' : `+${rest} more`);
      toggle.addEventListener('click', () => { expandedCard = all ? '' : card.items.map(item => item.company).join('|'); renderRunCard(card); });
      more.append(toggle);
    }
    const employers = shared.state?.notion?.NOTION_EMPLOYERS_DB;
    if (employers) {
      const open = Object.assign(el('a', 'arrow-link', 'All employers in Notion ↗'), {href: '#'});
      open.addEventListener('click', event => { event.preventDefault(); window.pilot.openNotion(employers, event.metaKey || event.ctrlKey); });
      more.append(open);
    }
    if (card.note) more.append(el('span', 'muted', card.note));
  }
  $('activity-card').replaceChildren(stats, el('h4', 'run-card-title', heading), rows, ...(more && more.childNodes.length ? [more] : []));
}
// The bar's action: hide the open panel, watch what's running, or see the details.
function barLabel() {
  $('activity-open').textContent = !$('activity-panel').hidden ? 'Hide activity ⌄' : lastActivity?.running ? 'View progress ↑' : 'Details ▴';
}
export function openActivity(open) {
  show($('activity-panel'), open);
  // No dimming: the panel is part of the bottom bar; a press anywhere else on the page closes it (below).
  $('activity').classList.toggle('open', open);
  $('activity-toggle').setAttribute('aria-expanded', open);
  if (open) $('log').scrollTop = $('log').scrollHeight;
  barLabel();
  if (lastActivity) renderActivity(lastActivity);  // the bar drops "Next jobs check" while the panel shows it
}

let wasRunning = false;
// In-app notifications: a scheduled job starting, and any job ending (with its result); click one to see it.
let announced = null;  // {running: id of the run announced as started, done: ids of finished runs already seen}
function announceRuns({running, runs}) {
  if (!announced) { announced = {running: running?.id ?? null, done: new Set(runs.map(run => run.id))}; return; }
  const where = run => run.source === 'github' ? ' · on GitHub' : '';
  if (running && running.id !== announced.running) {
    announced.running = running.id;
    const kind = KIND[kindOf(running)] || KIND.search;
    if (running.trigger === 'schedule') toastMessage(`${kind.icon} ${kind.name} started`, `Scheduled${where(running)}`).onclick = () => openActivity(true);
  }
  for (const run of runs.filter(r => !announced.done.has(r.id))) {
    announced.done.add(run.id);
    if (Date.now() - Date.parse(run.endedAt || run.startedAt) > 3 * 60000) continue;  // history arriving (Notion), not news
    const kind = KIND[kindOf(run)] || KIND.search;
    const failed = !run.ok || run.off;
    toastMessage(`${failed ? '⚠️' : '✅'} ${kind.name} ${failed ? 'had problems' : 'done'}`, `${capital(outcome(run))}${where(run)}`).onclick = () => openActivity(true);
  }
}

export function refreshCv() {
  $('cv-name').textContent = shared.state.settings.cvName ? `✓ ${shared.state.settings.cvName}` : 'No CV chosen yet';
  $('cv-next').disabled = !shared.state.hasCv;
}

const QUESTIONS = {roles: 'q-roles', seniority: 'q-seniority', work_mode: 'q-remote', places_in_order: 'q-places',
  relocate: 'q-relocate', work_permit: 'q-permit', languages: 'q-languages', minimum_salary: 'q-salary',
  notice_period: 'q-notice', companies_to_skip: 'q-skip', anything_else: 'q-more', applications_per_day: 'q-target'};
export const currentAnswers = () => Object.fromEntries(Object.entries(QUESTIONS).map(([key, id]) => [key, $(id).value.trim()]));
let answersTimer;

export async function buildDraft() {
  goStep('draft');
  show($('draft-loading')); show($('draft-view'), false); show($('draft-error'), false);
  $('draft-title').textContent = 'Your strategy'; show($('draft-subtitle'), false); show($('draft-cost'), false);
  $('draft-save').disabled = true;
  if (!shared.state.secrets.ANTHROPIC_API_KEY) {
    show($('draft-loading'), false);
    $('draft-error').textContent = 'Building your strategy needs the AI key (step 1). Go back and add it, or skip to use the default SRE settings.';
    show($('draft-error'));
    return;
  }
  const answers = Object.fromEntries(Object.entries(QUESTIONS).map(([key, id]) => [key, $(id).value.trim()]));
  // Progress while Claude writes: the part it's on, how much has arrived, and the time so far.
  const started = Date.now();
  $('draft-part').textContent = 'Reading your CV'; $('draft-percent').textContent = ''; $('draft-bar').style.width = '2%';
  const clock = setInterval(() => {
    const seconds = Math.round((Date.now() - started) / 1000);
    $('draft-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} so far. Usually 1 to 2 minutes; you can leave this window open and wait.`;
  }, 1000);
  try {
    shared.draft = await window.pilot.draftStrategy(answers);
  } catch (error) {
    clearInterval(clock);
    show($('draft-loading'), false);
    $('draft-error').textContent = `Couldn't draft your strategy: ${error.message.replace(/^Error invoking remote method '[^']+': /, '')}`;
    show($('draft-error'));
    return;
  }
  clearInterval(clock);
  renderDraft();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  showKeptStatusBar();
  $('log').addEventListener('click', event => {
    const link = event.target.closest('a.log-link');
    if (!link) return;
    event.preventDefault();
    if (/notion\.(so|com)\//.test(link.href)) window.pilot.openNotion(link.href, event.metaKey);
    else window.pilot.openExternal(link.href);
  });
  for (const id of ['activity-notion', 'activity-github']) $(id).addEventListener('click', event => {
    event.preventDefault();
    if (event.currentTarget.dataset.url) window.pilot.openExternal(event.currentTarget.dataset.url);
  });
  $('ap-strip-more').addEventListener('click', () => $('ap-strip').classList.toggle('is-expanded'));
  $('check-mail').addEventListener('click', async () => {
    $('check-mail').disabled = true;
    shared.selectedRun = null;
    try {
      const result = await window.pilot.checkMail();
      if (result.cloud) toastMessage('Gmail check started in your GitHub repo', 'Results arrive in Notion and Telegram in a few minutes.');
    } finally {
      $('check-mail').disabled = false;
      refreshActivity();
    }
  });
  $('activity-toggle').addEventListener('click', () => openActivity($('activity-panel').hidden));
  $('activity-close').addEventListener('click', () => openActivity(false));
  $('activity-warnings-more').addEventListener('click', () => {
    const open = $('activity-warnings-list').hidden;
    show($('activity-warnings-list'), open);
    $('activity-warnings-more').textContent = open ? 'Hide details' : `View ${$('activity-warnings-list').children.length} details`;
  });
  $('activity-go').addEventListener('click', () => {
    openActivity(false);
    openView('jobs');
    $('sort-by').value = 'newest';  // the new ones first
    renderJobs();
  });
  $('activity-all').addEventListener('click', event => window.pilot.openNotion(shared.state?.notion?.NOTION_CRON_RUNS_DB, event.metaKey));
  $('activity-backdrop').addEventListener('click', () => openActivity(false));
  $('activity-manage').addEventListener('click', event => {
    event.preventDefault();
    openActivity(false);
    openView('settings');
    openSetting('schedule');
  });
  // Close it with Escape, its ✕, the bar ("Hide activity"), or a press outside it and its bar. On pointerdown, so a button
  // that opens it (View activity, Run) still does: it closes first, then the click opens it again.
  document.addEventListener('pointerdown', event => {
    if ($('activity-panel').hidden || event.target.closest('#activity, .ui-menu, .toast, dialog')) return;
    openActivity(false);
  });
  // Close it with Escape, its ✕, or the bar ("Hide activity").
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('activity-panel').hidden) openActivity(false); });
  window.pilot.runs().then(renderActivity).catch(() => {});  // at once, not after the first 2 s tick
  setInterval(async () => {
    if ($('app').hidden) return;
    const runsNow = await window.pilot.runs();
    const {running} = runsNow;
    renderActivity(runsNow);
    const tabs = new Set(await window.pilot.openTabs());
    if (tabs.size !== shared.openedInChrome.size || [...tabs].some(url => !shared.openedInChrome.has(url))) { shared.openedInChrome = tabs; renderJobs(); }
    if (wasRunning && !running) { loadJobs(); loadFocus(); }  // a check just finished: its jobs, and what it asks of you
    wasRunning = !!running;
    announceRuns(runsNow);
    showSearchStatus();
  }, 2000);
  $('cv-choose').addEventListener('click', async () => {
    const name = await window.pilot.chooseCv();
    if (name) { shared.state = await window.pilot.state(); refreshCv(); }
  });
  $('cv-next').addEventListener('click', () => goStep('goals'));
  for (const [key, id] of Object.entries(QUESTIONS)) if (shared.state.settings.questionnaire?.[key]) $(id).value = shared.state.settings.questionnaire[key];
  for (const id of Object.values(QUESTIONS)) $(id).addEventListener('input', () => {
    clearTimeout(answersTimer);
    answersTimer = setTimeout(() => window.pilot.saveSettings({questionnaire: currentAnswers()}), 400);
  });
  $('q-seniority').addEventListener('change', () => window.pilot.saveSettings({questionnaire: currentAnswers()}));
}
