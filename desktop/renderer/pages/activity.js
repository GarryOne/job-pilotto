// Recent activity: the bar at the bottom of every screen and its panel.
import {billingLabel} from '../ai-engine-view.js';
import {AI_BUSY, groupWarnings, humanError, limitedJobs, newDetails, runWarningLines} from '../run-warnings.js';
import {barState, phaseStatus, runStatus, runWarned} from '../run-status.js';
import {el, moreButton, openMenu, pill, tag} from '../components.js';
import {icon} from '../icons.js';
import {jobActions, jobHeadline, withListJob} from '../job-link.js';
import {cardText, markFallback, parseRunMessage, plainMessage} from '../run-cards.js';
import {mailChanges, parseMailReport, settleQuestion} from '../mail-report.js';
import {confidenceLabel, confidenceTone, parseInsight, sourceLine} from '../insight-card.js';
import {parseWeekly} from '../weekly-card.js';
import {parseInterviewReview} from '../interview-review.js';
import {filterRuns, groupRuns, kindCounts, runTime} from '../run-list.js';
import {shared} from './shared.js';
import {showScheduleState} from './connections.js';
import {answer} from './actions.js';
import {$, aiReady, show} from './core.js';
import {fullKey, loadJobs, renderJobs, showJobsIn} from './jobs.js';
import {lastAnswered, lastQuestions, loadFocus, pendingMailQuestions} from './focus.js';
import {openView} from './nav.js';
import {renderSessionPage} from './session-log.js';
import {renderActionsPage} from './runs-page.js';
import {openSetting} from './settings.js';
import {toastMessage} from './startup.js';
import {renderDraft, showDraftIntro} from './strategy-review.js';
import {goStep} from './wizard.js';

// ---------- runs ----------
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
  const found = last?.new != null ? ` · ${last.new} new match${last.new === 1 ? '' : 'es'}` : '';
  const cost = billingLabel(last || {}) ? ` · ${billingLabel(last)}` : last?.usd ? ` · $${last.usd.toFixed(2)}` : '';
  if (last && !last.ok) { title.textContent = 'Last check had problems →'; detail.textContent = clockTime(lastSearchAt); return; }
  title.textContent = `Checked ${clockTime(lastSearchAt)}${found}${cost}`;
  detail.textContent = '';
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
// icon: emoji for text the owner reads (toasts, messages); line: the line icon for rows and headers (same as Actions → Recent runs).
export const KIND = {search: {icon: '🔎', line: 'search', name: 'Jobs check'}, mail: {icon: '📧', line: 'mail', name: 'Gmail check'}, insight: {icon: '💡', line: 'chart', name: 'Insight'},
  interviewInsight: {icon: '💡', line: 'bulb', name: 'Interview insights'},
  weekly: {icon: '📊', line: 'file', name: 'Search analysis'}, kits: {icon: '📝', line: 'file-text', name: 'Prepare top matches'}, today: {icon: '📋', line: 'send', name: "Today's list"}, scout: {icon: '🔭', line: 'building', name: 'Find new employers'},
  action: {icon: '⚡', line: 'zap', name: 'Telegram action'}, prepare: {icon: '📝', line: 'file-text', name: 'Application kit'}, interview: {icon: '🎤', line: 'mic', name: 'Interview review'},
  add: {icon: '📥', line: 'inbox', name: 'Logged activity'}, import: {icon: '➕', line: 'search', name: 'Add a job'}, rejection: {icon: '🔍', line: 'search', name: 'Rejection review'},
  prep: {icon: '🎤', line: 'mic', name: 'Interview prep kit'}};
export const kindOf = run => (KIND[run?.kind] ? run.kind : 'search');
const WHO = {schedule: 'scheduled', you: 'by you', first: 'first check'};
const WHERE = {github: 'GitHub', mac: 'this Mac'};  // where a run ran, after who started it
// The warnings in one plain sentence (the list is one click away).
function warningSummary(warnings) {
  // The Anthropic account's spending limit: jobs were left unscored. Said plainly, with what to do.
  const limited = limitedJobs(warnings);
  if (limited && warnings.some(text => /Claude Code/.test(text))) {  // the user's own Claude Code: its plan's usage window
    return `Your Claude usage window is exhausted (or Claude Code is signed out), so ${plural(limited, 'job')} ${limited === 1 ? 'wasn\'t' : 'weren\'t'} scored. `
      + 'The next check scores them once your plan\'s limit resets; Settings → Connections → AI shows Claude Code\'s status.';
  }
  if (limited) {
    return `Your Anthropic API spending limit was reached, so ${plural(limited, 'job')} ${limited === 1 ? 'wasn\'t' : 'weren\'t'} scored. `
      + 'Raise the limit at console.anthropic.com → Settings → Limits; the next check scores them.';
  }
  // The same limit stopped a step that scores nothing (a Gmail check's own AI call, an insight): say that, not the
  // API's error dump.
  if (warnings.some(text => /usage limits?|credit balance|AI limit reached|spending limit/i.test(text))) {
    return 'Your Anthropic API spending limit was reached, so this step couldn\'t finish. '
      + 'Raise the limit at console.anthropic.com → Settings → Limits; the next check runs it again.';
  }
  if (warnings.some(text => AI_BUSY.test(text))) {
    return 'The AI service is busy (rate limit), so some jobs may not be scored yet. Try again in a few minutes.';
  }
  if (warnings.some(text => /429|Too Many Requests/i.test(text))) {
    return 'Notion was busy (rate limit): saved settings were used and some Notion steps were skipped. They run again next time.';
  }
  return humanError(warnings[0]) || '';
}
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
export const COMMAND_KIND = {insight: 'insight', weekly: 'weekly', today: 'today', kits: 'kits', scout: 'scout', mail: 'mail', run: 'search'};
// The Actions page's result card: a finished task's header (what, how it ended, when) over the Recent activity card.
function showActionsResult(run, kind, card) {
  show($('command-answer'), false);
  const [label, tone] = run.ok && !run.off ? ['Completed', 'good'] : ['Needs a look', 'bad'];
  $('actions-result-head').replaceChildren(el('b', '', `${kind.icon} ${kind.name}`), pill(label, tone), el('span', 'muted', `Finished ${clockTime(run.endedAt || run.startedAt)}`));
  renderRunCard(card, run, $('actions-card'));
  show($('actions-result'));
  $('actions-result').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
function showAwaitedResult(runs) {
  const run = shared.awaitedRun && runs.find(r => kindOf(r) === shared.awaitedRun.kind && r.id >= shared.awaitedRun.since && r.endedAt);
  if (!run) return;
  shared.awaitedRun = null;
  const kind = KIND[kindOf(run)];
  const show = message => {
    const text = `${kind.icon} ${kind.name}: ${message ? `\n\n${message}` : capital(outcome(run))}`;
    if ($('activity-panel').hidden) {
      // On the Actions page: the same card as in Recent activity (counts, top matches), not the raw text of the run.
      const card = message ? parseRunMessage(message) : null;
      if (card) { showActionsResult(run, kind, card); return; }
      answer(text);
      markFallback($('command-answer'), kindOf(run), message);
      return;
    }
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
// Recent activity lists every run that took time or AI money, scheduled or started by you; the ones you started
// (a Log box entry, an interview prep kit, a Check now) carry a "By you" tag, and every row shows its AI cost.
const byYou = run => run.trigger === 'you' && !run.live && !run.waiting;
// How many finished runs the list shows at once; "View more" adds another page and the list scrolls. The app reads
// the newest 25 from Notion, so that is as far as it goes without asking Notion again.
const RUNS_PAGE = 8;
let shownRuns = RUNS_PAGE;
// The panel's height, as you drag its top edge: never smaller than this, never taller than 90% of the window, kept
// for the next time the app opens.
const PANEL_MIN = 320;
const PANEL_HEIGHT = 'jobpilotto.activity-height';
const panelMax = () => Math.round(window.innerHeight * 0.9);
function setPanelHeight(height, keep = true) {
  const value = Math.max(PANEL_MIN, Math.min(panelMax(), Math.round(height)));
  $('activity-panel').style.height = `${value}px`;
  if (keep) { try { localStorage.setItem(PANEL_HEIGHT, String(value)); } catch {} }
  return value;
}
let kindFilter = '';        // the header's filter: one kind of run at a time ('' = every kind)
let foldedWarnings = '';    // the run whose warnings card is folded away, by id
let detailRunId = '';       // the run the detail pane is showing (the fold button needs to know)
const readingPages = new Set();  // run pages being read from Notion right now: their card shows as skeleton bars
// An answer given on Focus (or the card itself) reaches the open check's card as soon as Focus is read again.
window.addEventListener('focus-updated', () => { if (lastActivity) renderActivity(lastActivity); });
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
  $('activity').dataset.state = barState(running, lastSearch || lastMail || last);
  const liveLines = running ? shared.logLines : null;
  const checked = (liveLines || []).filter(line => /^Checked: /.test(line)).length;
  const mailNote = lastMail ? `Gmail ${lastMail.off ? 'not connected' : `checked ${clockTime(lastMail.endedAt || lastMail.startedAt)} · ${outcome(lastMail)}`}`
    : nextMailAt ? `First Gmail check ${nextMailAt <= Date.now() ? 'due now' : hhmm(nextMailAt)}` : '';
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
  // The header's filter keeps one kind of run; the list then shows a page of them (queued and running first).
  const liveRows = filterRuns(waiting.concat(running ? [{...running, live: true}] : []), kindFilter, kindOf);
  const kept = filterRuns(runs, kindFilter, kindOf);
  const recent = liveRows.concat(kept.slice(0, shownRuns));
  $('activity-count').textContent = `${recent.length} recent`;
  show($('activity-filter'), runs.length > 1);
  $('activity-filter').classList.toggle('is-active', !!kindFilter);
  // One row: the task and what it found, where it ran, its AI cost, its time and its status pill. The time is its
  // own column (not part of the sentence), and the rows are grouped Today / Earlier (renderer/run-list.js).
  const recentRow = run => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'recent-row'});
    button.classList.toggle('current', run.live ? !shown : shown ? run.id === shown.id : run === last && !running);
    button.dataset.state = run.live ? 'busy' : run.waiting ? 'queued' : run.ok && !run.off ? 'ok' : 'error';
    const kind = KIND[kindOf(run)];
    // Its warnings: from the log (a run on this Mac), else the row's Status in Notion (a GitHub run: no log until opened).
    const warned = runWarned(run);

    if (warned) button.dataset.state = 'warn';
    const words = el('span', 'run-words');
    words.append(el('b', 'run-kind', kind.name), el('span', 'muted run-what', run.live ? `Running now · ${searchPhase(run.step) || 'starting'}` : run.waiting
      ? `Waiting · starts after ${run.after}`
      : [capital(outcome(run)), WHERE[run.where]].filter(Boolean).join(' · ')));
    if (byYou(run)) words.lastChild.prepend(tag('By you', {title: 'You started it (not a schedule)'}), ' ');
    // No cost and no live log here: the list is for finding a run and seeing its state; the log and the cost are in the detail pane.
    const when = el('span', 'run-time', run.live || run.waiting ? '' : runTime(run));
    if (run.live && run.where === 'github' && run.url) {
      const link = el('span', 'run-github', 'GitHub ↗');
      link.title = 'Open this run on GitHub';
      link.setAttribute('role', 'link');
      link.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); window.pilot.openExternal(run.url); });
      when.replaceChildren(link);
    }
    button.append(el('span', 'run-icon', icon(kind.line)), words, when, pill(...runStatus(run, warned)));
    button.addEventListener('click', () => { if (run.waiting) return; shared.selectedRun = run.live ? null : run.id; renderActivity(lastActivity); });
    return button;
  };
  $('activity-recent').replaceChildren(...groupRuns(recent).flatMap(group => [
    Object.assign(document.createElement('li'), {className: 'recent-group', textContent: group.label}),
    ...group.runs.map(run => { const item = document.createElement('li'); item.append(recentRow(run)); return item; })]));
  if (!recent.length) $('activity-recent').append(Object.assign(document.createElement('li'), {className: 'muted',
    textContent: runs.length ? `No ${KIND[kindFilter]?.name || kindFilter} runs here.` : 'Nothing has run yet.'}));
  // "View more": the runs the filter keeps that the list hasn't shown yet (they scroll in below).
  show($('activity-all'), kept.length > shownRuns);

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
  const items = [['Job search', 'search', nextSearchAt, plan.search ? unknown : 'When you ask'], ['Gmail', 'mail', nextMailAt, plan.mail ? unknown : 'Off'],
    ...(cloud ? [['Employers', 'building', nextScoutAt, plan.scout !== 'off' ? unknown : 'Off']] : [])];
  const soonest = Math.min(...items.map(([, , at]) => at || Infinity));
  $('activity-schedule').replaceChildren(...items.map(([name, , at, none]) => {
    const item = el('span', `ap-item${at && at === soonest ? ' is-next' : ''}${at ? '' : ' is-off'}`);
    item.append(el('span', 'muted', name), ' ', el('b', '', at ? (at <= Date.now() ? 'Due now' : `${day(at)} ${hhmm(at)}`) : none));
    // A pill after the time, not a "Next:" before the name: that read as "Next Jobs" from a distance.
    if (at && at === soonest) item.append(' ', el('span', 'ap-next', 'Next'));
    return item;
  }));
  // Check Gmail now: with a selected Gmail check, not in the schedule strip.
  const selected = shown || (running ? null : last);
  show($('check-mail'), !!selected && kindOf(selected) === 'mail');

  // The selected run (or the live / latest one): what it did, its phases, and its full log. A run read from
  // Notion brings its result and log from its page the first time it's shown.
  const picked = shown || (running ? {...running, live: true} : last);
  const run = picked?.pageId && !picked.log && !picked.live ? {...picked, ...runDetails.get(picked.pageId)} : picked;
  detailRunId = run?.id ?? '';
  if (run?.pageId && !run.log && !run.live && !runDetails.has(run.pageId)) {
    const pageId = run.pageId;
    readingPages.add(pageId);
    runDetails.set(pageId, {log: ['Reading from Notion…']});
    // A run that just finished may not have its log on its page yet (it's written a moment after the status):
    // an empty answer is read again a few times before it's kept.
    const read = (tries = 0) => window.pilot.runDetail(pageId).then(detail => {
      const empty = !detail?.message && !(detail?.log || []).length;
      if (empty && tries < 4) {
        runDetails.set(pageId, {log: ['Waiting for the log from Notion…']});
        setTimeout(() => read(tries + 1), 5000);
      } else {
        readingPages.delete(pageId);
        runDetails.set(pageId, empty ? {log: ['This run left no log on its Notion page.']} : detail);
      }
      renderActivity(lastActivity);
    }).catch(() => { readingPages.delete(pageId); renderActivity(lastActivity); });
    read();
  }
  // The log of the run shown, with what was read from its Notion page merged in (a GitHub run's log lives there).
  // A GitHub run has no local lines: the sidebar link opens the job. A local run streams shared.logLines.
  const githubLive = !!run?.live && run?.where === 'github';
  // The window's own buffer is empty after a reload (⌘R): then the app's copy of the running job's log (run.log) is what to show.
  const lines = githubLive ? (run?.log || []) : (shown ? run?.log || [] : (liveLines?.length ? liveLines : run?.log) || []);
  const kind = run ? KIND[kindOf(run)] : null;
  const detailWarnings = runWarningLines(run);
  // The header: the run's name, its state as a pill, then one muted line — what it did, when it finished, how long it
  // took, what it cost and where it ran (the mockup's "Nothing new · Finished 18:06 · 62 s · GitHub").
  const status = !run ? null : run.live ? ['Running', 'info', {dot: true}] : run.waiting ? ['Queued', 'neutral']
    : !run.ok || run.off ? ['Failed', 'bad'] : (detailWarnings.length || run.warned) ? ['Completed with warnings', 'warn'] : ['Completed', 'good'];
  $('activity-icon').replaceChildren(...(kind ? [icon(kind.line)] : []));
  $('activity-selected').textContent = run ? kind.name : 'Nothing has run yet';
  $('activity-status').replaceChildren(...(status ? [pill(...status)] : []));
  const checkedCount = lines.filter(line => /^Checked: /.test(line)).length;
  // What it found, without repeating the task's name ("Gmail check: 4 new emails…" → "4 new emails…").
  const shownText = cardText(run, run ? runResults.get(run.id) : null);
  const hasCard = !!(shownText && parseRunMessage(shownText));  // its card says it better than the raw text
  const said = run && !run.live && !hasCard ? capital(String(outcome(run)).replace(new RegExp(`^${kind?.name || ''}:\\s*`, 'i'), '')) : '';
  const seconds = run?.endedAt && run.startedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : null;
  // A run that used no AI shows no cost: "$0" on every row was noise.
  const cost = run && !run.live && (billingLabel(run) || (run.usd > 0 && `AI $${run.usd < 0.01 ? run.usd.toFixed(3) : run.usd.toFixed(2)}`));
  $('activity-sub').textContent = !run ? '' : [
    run.live ? (searchPhase(run.step) || 'starting') : said,
    checkedCount && `${checkedCount} companies checked`,
    !run.live && `Finished ${hhmm(Date.parse(run.endedAt || run.startedAt))}`,
    !run.live && seconds > 0 && (seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`),
    cost,
    run.where === 'github' ? 'GitHub' : run.where === 'mac' ? 'This Mac' : '',
  ].filter(Boolean).join(' · ');
  // A search that found new jobs: straight to them (newest first).
  const found = !run?.live && kindOf(run) === 'search' ? run?.new || 0 : 0;
  show($('activity-go'), found > 0);
  $('activity-go').textContent = `View new job${found === 1 ? '' : 's'} →`;
  // The header's one visible link, then the rest under ⋯: a Notion page is the run's record, its GitHub run the build
  // behind it. A GitHub-only run shows that link itself; with nothing else to offer there is no ⋯ at all.
  show($('activity-notion'), !!run?.notionUrl);
  $('activity-notion').dataset.url = run?.notionUrl || '';
  show($('activity-github'), !!run?.url && (!run?.notionUrl || !!run?.live));
  $('activity-github').dataset.url = run?.url || '';
  $('activity-more').replaceChildren(...(run?.url && run?.notionUrl && !run?.live
    ? [moreButton([{label: 'View GitHub run ↗', run: () => window.pilot.openExternal(run.url)}], 'More links')] : []));
  const result = run && !run.live ? runResults.get(run.id) || '' : '';
  $('activity-result').textContent = result;
  show($('activity-result'), !!result);
  showRunJob(!run?.live && kindOf(run) === 'add' ? run.job : null);
  const asked = lastQuestions();
  const updates = !run?.live && kindOf(run) === 'mail' ? (run.updates || []).map(text => settleQuestion(text, asked)) : [];
  const at = run && kindOf(run) === 'search' ? phaseIndex(lines) : -1;
  $('activity-phases').replaceChildren(...(updates.length ? updates.map(text => Object.assign(document.createElement('li'), {className: 'update', textContent: text}))
    : PHASES.map((phase, i) => {
      // The step a run that warned stopped at is not a clean tick: a refused AI call under "reading and scoring" must not look done (UI loop #51).
      return Object.assign(document.createElement('li'), {className: phaseStatus(run, i, at), textContent: phase.label});
    })));
  show($('activity-phases'), updates.length > 0 || at >= 0);
  // What a one-off job produced (the insight, the list, the report) when it wasn't sent to Telegram. Today's list and
  // Find new employers read better as a small card; anything else stays text. While its Notion page is still being
  // read, the card's own shape shows as skeleton bars, so the pane never looks half-built and then jumps.
  const card = shownText ? parseRunMessage(shownText) : null;
  // A Gmail check's message has no digest header but plenty of structure (the interview it is about, the topics to
  // strengthen, the recruiter's next step): it gets its own card, not its raw lines in a <pre>.
  const mail = !run?.live && !card && kindOf(run) === 'mail' && (run?.message || run?.report?.length)
    ? parseMailReport(run.message, run.result, run.report || []) : null;
  // An insight is written to be sent, not read: its card is the finding, the numbers behind it and the one action
  // (the mockup, 30 Sep). Only what the insight carries is drawn — anything else is absent, never an empty slot.
  const insight = !card && !mail && shownText ? parseInsight(shownText) : null;
  // The week's report: the same card, with what worked and what to change in place of the finding's evidence.
  const weekly = !card && !mail && !insight && shownText ? parseWeekly(shownText) : null;
  // An interview review: the same card shape as the others, from the message src/ai/interviews.py wrote.
  const review = !run?.live && !card && !mail && !insight && !weekly && kindOf(run) === 'interview' && run?.message
    ? parseInterviewReview(run.message) : null;
  const reading = !!run?.pageId && readingPages.has(run.pageId);
  if (card) renderRunCard(card, run);
  else if (mail) {
    renderMailCard(mail, pendingMailQuestions(), lastAnswered());
  }
  else if (insight) renderInsightCard(insight);
  else if (weekly) renderWeeklyCard(weekly);
  else if (review) renderInterviewCard(review);
  else if (reading) renderCardSkeleton();
  if (card || insight || weekly) show($('activity-result'), false);  // the card shows the same, laid out
  show($('activity-card'), !!card || !!mail || !!insight || !!weekly || !!review || reading);
  const plain = !run?.live && !card && !mail && !insight && !weekly && !review && run?.message;
  $('activity-message').textContent = plain ? plainMessage(plain) : '';
  show($('activity-message'), !!plain && !reading);
  markFallback($('activity-message'), kindOf(run), plain && !reading ? plain : '');
  markFallback($('activity-result'), kindOf(run), $('activity-result').hidden ? '' : $('activity-result').textContent);
  // Warnings (Notion busy, a step skipped…) shown plainly above the log, not buried in it. A run whose row says
  // Warnings — its own verdict — still says so when neither its log nor its report has a line about it: the list's
  // pill and this card never contradict each other.
  const warnings = detailWarnings;
  const warnedOnly = !warnings.length && !run?.live && !!run?.warned;
  const limited = limitedJobs(warnings);
  show($('activity-warnings'), warnings.length > 0 || warnedOnly);
  if (warnings.length || warnedOnly) {
    // The headline says what it means for you ("9 jobs still need scoring"), not which card this is.
    $('activity-warnings-title').textContent = limited ? `${plural(limited, 'job')} still ${limited === 1 ? 'needs' : 'need'} scoring`
      : run?.live ? 'Running with warnings' : 'Completed with warnings';
    $('activity-warnings-summary').textContent = warnings.length ? warningSummary(warnings)
      : 'The run recorded warnings, with no line about them in its log or report.';
    show($('activity-warnings-limit'), limited > 0);
    const grouped = newDetails(groupWarnings(warnings));
    // One line needs no toggle: it is shown. Two or more fold behind "View N details".
    const single = grouped.length === 1;
    const listShown = single || (grouped.length > 0 && !$('activity-warnings-list').hidden && $('activity-warnings-list').dataset.for === String(run?.id));
    $('activity-warnings-list').dataset.for = String(run?.id);
    show($('activity-warnings-list'), listShown);
    show($('activity-warnings-more'), grouped.length > 1);
    $('activity-warnings-more').textContent = listShown ? 'Hide details' : `View ${grouped.length} detail${grouped.length === 1 ? '' : 's'}`;
    $('activity-warnings-list').replaceChildren(...grouped.map(text => el('li', '', text)));
    // Folded away: the headline stays, the rest hides (the chevron turns).
    const folded = foldedWarnings === String(run?.id);
    $('activity-warnings').classList.toggle('is-folded', folded);
    $('activity-warnings-fold').setAttribute('aria-expanded', String(!folded));
    $('activity-warnings-fold').title = folded ? 'Show' : 'Hide';
  }
  // The full log stays folded (the stages come first); open by itself only when the task went wrong.
  const failed = run && !run.live && (!run.ok || run.off);
  const streamLocal = !!run?.live && run?.where !== 'github';
  if (run && $('activity-log').dataset.for !== String(run.id)) {
    $('activity-log').dataset.for = String(run.id);
    $('activity-log').open = !!failed || streamLocal;
  }
  $('log-count').textContent = lines.length ? `· ${plural(lines.length, 'line')}` : '';
  const log = $('log');
  const text = lines.join('\n') || (githubLive
    ? (run.url ? 'This run is on GitHub. Its log is copied here when it finishes.' : 'Starting on GitHub…')
    : (run?.live ? 'Nothing to show yet.' : 'No log for this run.'));
  if (log.textContent !== text) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren(...linked(text));
    if (atBottom) log.scrollTop = log.scrollHeight;  // follow new lines unless the user scrolled up to read
  }
}
// A Logged activity run's job, created or updated: a green box linking to it (its Notion page, the Jobs list).
function showRunJob(runJob) {
  const job = withListJob(runJob, shared.allJobs || []);
  show($('activity-job'), !!job);
  if (!job) return;
  $('activity-job-title').textContent = jobHeadline(job);
  const key = JSON.stringify([job.url, job.jobUrl, job.title]);
  if ($('activity-job-links').dataset.for === key) return;  // redrawn every 2 s: keep the buttons (and their focus)
  $('activity-job-links').dataset.for = key;
  $('activity-job-links').replaceChildren(jobActions(job, {openNotion: window.pilot.openNotion, show: showJob}));
}
export function showJob(job) {
  openActivity(false);
  openView('jobs');
  showJobsIn(job.title || 'Logged job', [job.jobUrl]);
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
function renderRunCard(card, run = null, target = $('activity-card')) {
  // One light line of counts ("37 open · 2 in your places · 18 applied"), then one line per item.
  const stat = (value, label) => { const cell = el('span', 'run-card-stat'); cell.append(el('b', '', String(value ?? '–')), ` ${label}`); return cell; };
  const stats = el('div', 'run-card-stats');
  const rows = el('ol', 'run-card-rows');
  let heading, more = null;
  if (card.kind === 'digest') {
    stats.append(stat(card.open, 'open'), stat(card.local, 'in your places'), stat(card.applied, 'already applied (hidden)'), stat(card.fresh, 'new this run'));
    heading = 'Top matches';
    rows.append(...card.items.slice(0, 3).map(item => {
      const row = el('li', 'run-card-row');
      // Two lines: the job, then who it is with. Its fit as a pill ("Not scored" when an AI limit or no score), so
      // the row never shows a bare "–"; the posting opens from the arrow.
      const words = el('span', 'run-card-words');
      words.append(el('b', '', item.title), el('span', 'muted', [item.company, item.percent != null ? `${item.percent}%` : ''].filter(Boolean).join(' · ')));
      const scored = item.fit != null;
      const fit = pill(scored ? String(item.fit) : 'Not scored', scored && item.fit >= 70 ? 'warn' : 'neutral');
      fit.title = scored ? 'Fit score for this job' : 'Not scored yet (no AI score for this job)';
      const view = Object.assign(el('a', 'run-card-open', '↗'), {href: '#', title: 'Open the job posting'});
      view.dataset.link = item.url;
      row.append(words, fit, ...(item.url ? [view] : []));
      return row;
    }));
    // "View all 9 in Jobs" shows exactly those nine, not the whole list: the Jobs page gets a filter for this run's
    // matches (pages/jobs.js showJobsIn, the same one a Focus funnel step uses), with its own label to clear. The count
    // is what the list really holds: a "new since last run" posting that was never scored (an AI limit) has no row
    // there, and the button must not promise it (owner, 30 Sep: 9 on the card, 8 on the page).
    const label = `${heading}${run?.startedAt ? ` · ${hhmm(Date.parse(run.startedAt))}` : ''}`;
    const urls = card.items.map(item => item.url).filter(Boolean);
    const known = new Set((shared.allJobs || []).map(job => fullKey(job.url)));
    const here = urls.length && known.size ? urls.filter(url => known.has(fullKey(url))).length : urls.length;
    const total = card.items.length;
    if (!total) rows.append(el('li', 'muted', 'This run found nothing new to show. Your saved jobs are in Jobs.'));
    const words = !total ? 'Open Jobs →' : !here ? 'View in Jobs →' : here === total ? `View all ${total} in Jobs →` : `View ${here} of ${total} in Jobs →`;
    more = el('button', 'link', words);
    more.addEventListener('click', () => {
      openActivity(false);
      openView('jobs');
      if (urls.length) showJobsIn(label, urls, 'activity');  // no links in the message: the whole list is all there is
    });
  } else {
    stats.append(stat(card.checked, 'employers checked'), stat(card.fresh, 'new job feeds'));
    heading = 'New employers';
    // Five at first; "+2 more" shows the rest here (Show less folds them), and the Employers database has them all.
    const all = card.items.length > 5 && expandedCard === card.items.map(item => item.company).join('|');
    rows.append(...card.items.slice(0, all ? undefined : 5).map(item => {
      const row = el('li', 'run-card-row');
      const words = el('span', 'run-card-words');
      words.append(el('b', '', item.company), el('span', 'muted', [item.ats, item.roles != null && `${item.roles} matching role${item.roles === 1 ? '' : 's'}`,
        item.yours != null && `${item.yours} in your places`].filter(Boolean).join(' · ')));
      row.append(words, ...(item.tier ? [el('span', 'run-card-fit', item.tier.replace('Tier ', 'T'))] : []));
      return row;
    }));
    more = el('div', 'run-card-foot');
    const rest = card.items.length - 5;
    if (rest > 0) {
      const toggle = el('button', 'link', all ? 'Show less' : `+${rest} more`);
      toggle.addEventListener('click', () => { expandedCard = all ? '' : card.items.map(item => item.company).join('|'); renderRunCard(card, run, target); });
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
  // The counts sit above a bordered box that holds the heading and the rows (nested in the card, as the mockup shows);
  // the link to the whole list stays in the card, under it.
  // Counts on their own band, then the heading, the rows and the link in the card's plain body: one surface, not a
  // box inside a box (the owner, 30 Sep: "a table in table").
  const body = el('div', 'run-card-body');
  body.append(el('h4', 'run-card-title', heading), rows, ...(more && more.childNodes.length ? [more] : []));
  target.replaceChildren(stats, body);
}

// A run's card while its Notion page is being read: the card's own shape, in the app's skeleton bars, so the pane
// keeps its size and nothing pops in when the data lands (renderer/pages/focus.js does the same for a first load).
function renderCardSkeleton() {
  const bar = (className = '') => el('span', `skeleton ${className}`);
  const stats = el('div', 'run-card-stats');
  stats.append(bar('w-30'), bar('w-20'), bar('w-20'));
  const rows = el('div', 'run-card-rows');
  for (const width of ['w-60', 'w-40', 'w-60']) {
    const row = el('div', 'run-card-row');
    const words = el('span', 'run-card-words');
    words.append(bar(`${width} tall`), bar('w-20'));
    row.append(words, bar('w-20'));
    rows.append(row);
  }
  const body = el('div', 'run-card-body');
  body.append(rows);
  $('activity-card').replaceChildren(stats, body);
}

// A Gmail check's own lines about the emails: the update it recorded — with what moved on the job — and every email
// it read, each opening in Gmail. Its own rows, so a check that sent nothing to Telegram still accounted for itself.
function mailDiff(changes) {
  const row = el('div', 'mail-diff');
  for (const part of mailChanges(changes)) {
    // "Stage Applied → Confirmation received" reads as a label and its movement; "Confirmation email set" is one flag.
    // el() takes one node or text, never an array of both (that renders "[object HTMLElement]"): append them here.
    const pill = el('span', part.flag ? 'mail-diff-flag' : 'mail-diff-move');
    if (part.flag) pill.textContent = part.flag;
    else pill.append(el('b', '', part.from), ` → ${part.to}`);
    row.append(pill);
  }
  return row;
}
function mailSections(box, report, pending = [], answered = null) {
  if (report.updates.length) {
    const section = el('section', 'mail-block mail-changed');
    section.append(el('h4', '', 'What changed'));
    const questions = report.emails.filter(email => NEEDS_YOU.has(email.action)).map(email => ({email, ...questionState(email, pending, answered)}));
    for (const update of report.updates) {
      const row = el('div', 'mail-changed-row');
      const ask = /\s+—\s+which job\?$/.exec(update.job);
      const sentence = el('p', 'mail-changed-sentence');
      if (ask) {
        // Not sure which job: the check wrote a question for you (Focus) and moved nothing, until you answer.
        const company = update.job.slice(0, ask.index);
        const state = questions.find(question => question.email.by === company) || {};
        const line = el('div', 'mail-changed-line');
        line.append(icon(state.answered ? 'check-circle' : 'help'), el('span', '', state.answered
          ? `${company} role confirmed: ${state.job ? state.role : 'not about a job'}.`
          : `${company} needs clarification. We couldn't match the email to a job.`));
        row.append(line);
        if (!state.answered) row.append(el('p', 'mail-changed-sub', '1 question awaiting your answer in Focus'));
      } else {
        if (update.summary) sentence.append(el('b', '', update.summary), '. Mapped to ');
        sentence.append(el('b', 'mail-changed-job', update.job), update.summary ? '.' : '');
        row.append(sentence);
        if (update.changes) row.append(mailDiff(update.changes));
      }
      section.append(row);
    }
    box.append(section);
  }
  if (report.emails.length) {
    const section = el('section', 'mail-block mail-read');
    const head = el('div', 'mail-block-head');
    head.append(el('h4', '', 'Emails read'), pill(String(report.emails.length), 'neutral'));
    section.append(head);
    const rows = el('ol', 'mail-read-rows');
    for (const email of report.emails) {
      const row = el('li', 'mail-read-row');
      const words = el('span', 'mail-read-words');
      words.append(el('b', '', email.subject));
      words.append(el('span', 'mail-read-meta', [email.sender, email.time].filter(Boolean).join(' · ')));
      row.append(words);
      const acted = email.by && email.by !== email.action;
      const asked = NEEDS_YOU.has(email.action) ? questionState(email, pending, answered) : null;
      row.append(asked?.answered ? pill('confirmed by you', 'good') : pill(email.action, email.action === 'recorded' ? 'good' : asked ? 'warn' : 'neutral'));
      if (acted) row.append(el('span', 'mail-read-by', email.by));
      if (asked) row.append(questionBlock(asked, subjectKey(email.subject)));
      rows.append(row);
    }
    section.append(rows);
    box.append(section);
  }
}

// A Gmail check's card: what the check did, the interview it is about, what to prepare, the recruiter's next step and
// the consent line — the message's own content, in the shape the owner reads it (the mockup, 30 Sep).
// A Gmail check that was not sure which job an email belongs to asks, and the question sits on that email's own row.
// Still open, it carries the buttons (the same question lives on Focus); answered, it says which job you picked.
const subjectKey = text => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
const NEEDS_YOU = new Set(['needs you', 'asked']);
function questionState(email, pending, answered) {
  const key = subjectKey(email.subject);
  const open = key && pending.find(item => subjectKey(item.subject) === key);
  if (open) return {open};
  const done = key && (answered || []).find(item => subjectKey(item.subject) === key);
  if (done) return {answered: true, job: done.job, role: done.job.split(/\s+—\s+/).slice(1).join(' — ') || done.job};
  return answered ? {answered: true, job: ''} : {};   // Focus read, no record of it: answered before the app kept the job
}
// Before answering: one warm panel with the question and the way to Focus. After: a green panel with the answer, and the
// original question kept one click away.
const QUESTION = 'Which job is this email about?';
const QUESTION_WHY = "The check couldn't tell which job this is about, so it moved nothing. Your answer places the email.";
// The card is drawn again on every refresh: which original questions are open is remembered here, or they would snap shut.
const openQuestions = new Set();
function questionBlock(state, key) {
  const block = el('div', state.answered ? 'mail-question is-answered' : 'mail-question');
  const head = el('div', 'mail-question-head');
  if (!state.answered) {
    head.append(icon('help'), el('b', '', state.open?.title || QUESTION));
    block.append(head, el('p', 'mail-question-text', QUESTION_WHY));
    const go = el('button', 'primary mail-question-go', 'Answer in Focus ');
    go.type = 'button';
    go.append(icon('external'));
    go.addEventListener('click', () => openView('focus'));
    block.append(go);
    return block;
  }
  head.append(icon('check-circle'), el('b', '', 'Answered by you'));
  block.append(head, el('p', 'mail-question-answer', state.job ? state.role : 'Not about a job, or the job was not recorded'),
    el('p', 'mail-question-text', state.job ? 'Role confirmed for this email.' : 'Nothing was moved for this email.'));
  // A button and a set, not <details>: the card is drawn again on every refresh, and the set is read by each drawing.
  const original = el('div', 'mail-question-original');
  const toggle = el('button', 'mail-question-toggle');
  toggle.type = 'button';
  const text = el('p', '', `${QUESTION} ${QUESTION_WHY}`);
  const show = () => {
    const open = openQuestions.has(key);
    toggle.textContent = `${open ? '▾' : '▸'} Original question`;
    toggle.setAttribute('aria-expanded', String(open));
    text.hidden = !open;
  };
  toggle.addEventListener('click', () => { if (openQuestions.has(key)) openQuestions.delete(key); else openQuestions.add(key); show(); });
  show();
  original.append(toggle, text);
  block.append(original);
  return block;
}
function renderMailCard(report, pending = [], answered = null) {
  const box = el('div', 'mail-card');
  const status = el('div', 'mail-status');
  const tick = el('span', 'mail-tick');
  tick.append(icon('check-circle'));
  status.append(tick, el('strong', '', report.status.title));
  if (report.status.sentence) status.append(el('span', 'mail-status-text', report.status.sentence));
  box.append(status);
  // The row of counts first, as the other run cards do: what it read, and what that changed.
  const stats = el('div', 'run-card-stats mail-stats');
  const stat = (value, label) => { const cell = el('span', 'run-card-stat'); cell.append(el('b', '', String(value)), ` ${label}`); return cell; };
  stats.append(stat(report.emails.length, report.emails.length === 1 ? 'email read' : 'emails read'),
               stat(report.updates.length, report.updates.length === 1 ? 'update' : 'updates'));
  if (report.emails.length || report.updates.length) box.append(stats);
  mailSections(box, report, pending, answered);
  const {interview} = report;
  if (interview) {
    const panel = el('section', 'mail-interview');
    const words = el('div', 'mail-interview-words');
    words.append(el('p', 'mail-kicker', 'Upcoming interview'),
      el('h3', '', [interview.title, interview.company].filter(Boolean).join(' · ')));
    const line = [interview.where, interview.summary].filter(Boolean).join(' · ');
    if (line) words.append(el('p', 'mail-where', line));
    if (interview.people.length) words.append(el('p', 'mail-people', `Participants: ${interview.people.join(' – ')}`));
    const side = el('div', 'mail-interview-side');
    if (interview.when) {
      const when = el('span', 'mail-when');
      when.append(icon('calendar'), interview.when.replace(/\s+(\d{1,2}:\d{2})$/, ' · $1'));
      side.append(when);
    }
    if (report.url) {
      const view = Object.assign(el('a', 'link', 'View application in Notion ↗'), {href: '#'});
      view.dataset.link = report.url;
      side.append(view);
    }
    panel.append(words, side);
    box.append(panel);
  }
  if (report.topics.length || report.nextSteps.length) {
    const columns = el('div', 'mail-columns');
    if (report.topics.length) {
      const left = el('section', 'mail-block');
      left.append(el('h4', '', 'Prepare for the conversation'),
        el('p', 'mail-sub', 'Topics to strengthen from previous interviews'));
      const list = el('ul', 'mail-topics');
      report.topics.forEach(topic => list.append(el('li', '', topic)));
      left.append(list);
      columns.append(left);
    }
    if (report.nextSteps.length) {
      const right = el('section', 'mail-block');
      const heading = el('div', 'mail-block-head');
      heading.append(el('h4', '', 'Recruiter follow-up'), pill('Next step', 'neutral'));
      right.append(heading);
      report.nextSteps.forEach(text => right.append(el('p', '', text)));
      columns.append(right);
    }
    box.append(columns);
  }
  // The message's own lines (instructions to you). The run's report lines are the sections above, with the job and
  // the change pulled out of them, so a raw "… · [recorded] · … · changed …" line is never drawn twice.
  const notes = report.notes.filter(note => !note.fromRow);
  if (notes.length) {
    const list = el('ul', 'mail-notes');
    notes.forEach(note => {
      const item = el('li', '');
      if (note.icon) item.append(el('span', 'mail-note-icon', note.icon));
      item.append(el('span', '', note.text));
      list.append(item);
    });
    box.append(list);
  }
  if (report.consent) {
    const consent = el('p', 'mail-consent');
    consent.append(icon('mic'), report.consent);
    box.append(consent);
  }
  $('activity-card').replaceChildren(box);
}

// A daily insight's card: the finding, the numbers behind it, the one action and where it came from (the mockup,
// 30 Sep). Its subtitle, its numbers strip and its labelled evidence groups are drawn only when the insight carries
// them — structured data the AI does not emit yet — so nothing is guessed from the bullets and nothing is left blank.
export function renderInsightCard(insight) {
  const box = el('div', 'insight-card');
  const head = el('header', 'insight-head');
  const kicker = el('div', 'insight-kicker');
  kicker.append(el('span', 'insight-category', insight.category));
  if (insight.confidence) kicker.append(pill(confidenceLabel(insight.confidence), confidenceTone(insight.confidence)));
  head.append(kicker, el('h3', 'insight-title', insight.headline));
  if (insight.subtitle) head.append(el('p', 'insight-subtitle', insight.subtitle));
  box.append(head);
  if (insight.metrics.length) {
    const strip = el('div', 'insight-numbers');
    for (const {label, value} of insight.metrics) {
      const cell = el('div', 'insight-number');
      cell.append(el('span', 'insight-number-label', label), el('b', 'insight-number-value', value));
      strip.append(cell);
    }
    box.append(strip);
  }
  if (insight.action) {
    const words = el('div', 'insight-next-words');
    words.append(el('b', '', 'Recommended next step'), el('p', '', insight.action));
    const next = el('section', 'insight-next');
    next.append(el('span', 'insight-next-icon', icon('target')), words);
    box.append(next);
  }
  if (insight.evidence.length || insight.groups.length) {
    const why = el('section', 'insight-section');
    why.append(el('h4', '', 'Why this was flagged'));
    if (insight.groups.length) {
      const columns = el('div', 'insight-groups');
      for (const group of insight.groups) {
        const block = el('div', 'insight-group');
        block.append(el('b', '', group.title));
        const list = el('ul', 'insight-evidence');
        group.items.forEach(item => list.append(el('li', '', item)));
        block.append(list);
        columns.append(block);
      }
      why.append(columns);
    } else {
      const list = el('ul', 'insight-evidence');
      insight.evidence.forEach(line => list.append(el('li', '', line)));
      why.append(list);
    }
    box.append(why);
  }
  const source = sourceLine(insight);
  if (source) box.append(el('p', 'insight-source', source));
  $('activity-card').replaceChildren(box);
}

// An interview review as a card, wearing the insight card's shape (as the weekly report does): the round it was,
// the job, what happened, what was strong and weak, what to practise, and the next step. Every word is the review's.
export function renderInterviewCard(review) {
  const box = el('div', 'insight-card');
  const head = el('header', 'insight-head');
  const kicker = el('div', 'insight-kicker');
  kicker.append(el('span', 'insight-category', `Interview · ${review.round}`));
  head.append(kicker, el('h3', 'insight-title', review.title || 'Interview review'));
  if (review.summary) head.append(el('p', 'insight-subtitle', review.summary));
  box.append(head);
  for (const section of review.sections) {
    const node = el('section', 'insight-section');
    node.append(el('h4', '', `${section.icon} ${section.label}`.trim()));
    if (section.items.length) {
      const list = el('ul', 'insight-evidence');
      section.items.forEach(item => list.append(el('li', '', item)));
      node.append(list);
    }
    box.append(node);
  }
  if (review.next || review.stage) {
    const words = el('div', 'insight-next-words');
    words.append(el('b', '', review.next ? 'Next' : 'Stage'), el('p', '', review.next || review.stage));
    if (review.next && review.stage) words.append(el('p', 'insight-subtitle', review.stage));
    const next = el('section', 'insight-next');
    next.append(el('span', 'insight-next-icon', icon('target')), words);
    box.append(next);
  }
  $('activity-card').replaceChildren(box);
}

// The week's report as a card, wearing the insight card's shape: the headline sentence, the paragraph under it, the
// one focus to carry into next week on the same warm band, then what worked and what to change. A report without a
// focus, or without worked items, simply has no such block, and its lists are drawn only when they have something in
// them. The report's confidence and its recurring-evidence priorities sit on the Notion page, not in this message.
export function renderWeeklyCard(weekly) {
  const box = el('div', 'insight-card');
  const head = el('header', 'insight-head');
  const kicker = el('div', 'insight-kicker');
  kicker.append(el('span', 'insight-category', 'Search analysis · last 7 days'));
  head.append(kicker, el('h3', 'insight-title', weekly.headline));
  if (weekly.finding) head.append(el('p', 'insight-subtitle', `💡 ${weekly.finding}`));
  if (weekly.summary) head.append(el('p', 'insight-subtitle', weekly.summary));
  box.append(head);
  if (weekly.focus) {
    const words = el('div', 'insight-next-words');
    words.append(el('b', '', 'Focus next'), el('p', '', weekly.focus));
    const focus = el('section', 'insight-next');
    focus.append(el('span', 'insight-next-icon', icon('target')), words);
    box.append(focus);
  }
  for (const [title, items] of [['What worked', weekly.worked], ['Change next week', weekly.change]]) {
    if (!items.length) continue;
    const section = el('section', 'insight-section');
    section.append(el('h4', '', title));
    const list = el('ul', 'insight-evidence');
    items.forEach(item => list.append(el('li', '', item)));
    section.append(list);
    box.append(section);
  }
  $('activity-card').replaceChildren(box);
}

// The header's filter menu: every kind in the run history with how many, and "All runs".
function filterMenu() {
  const runs = lastActivity?.runs || [];
  return [
    {label: `${kindFilter ? '' : '✓ '}All runs · ${runs.length}`, run: () => { kindFilter = ''; renderActivity(lastActivity); }},
    '-',
    ...kindCounts(runs, kindOf).map(({kind, count}) => ({
      label: `${kindFilter === kind ? '✓ ' : ''}${KIND[kind]?.name || kind} · ${count}`,
      run: () => { kindFilter = kind; renderActivity(lastActivity); },
    })),
  ];
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
    if (running.trigger === 'schedule') toastMessage({title: `${kind.icon} ${kind.name} started`, body: `Scheduled${where(running)}`, target: {activity: true}});
  }
  for (const run of runs.filter(r => !announced.done.has(r.id))) {
    announced.done.add(run.id);
    if (Date.now() - Date.parse(run.endedAt || run.startedAt) > 3 * 60000) continue;  // history arriving (Notion), not news
    const kind = KIND[kindOf(run)] || KIND.search;
    const failed = !run.ok || run.off;
    toastMessage({title: `${failed ? '⚠️' : '✅'} ${kind.name} ${failed ? 'had problems' : 'done'}`, body: `${capital(outcome(run))}${where(run)}`, target: {run: run.id}});   // a click opens this run's result
  }
}

export function refreshCv() {
  $('cv-name').textContent = shared.state.settings.cvName ? `✓ ${shared.state.settings.cvName}` : 'No CV chosen yet';
  $('cv-next').disabled = !shared.state.hasCv;
}

// The wizard asks nothing but an optional note (strategy step, before building): the AI proposes the goals from the CV, the review corrects them.
const QUESTIONS = {anything_else: 'q-more'};
export const currentAnswers = () => Object.fromEntries(Object.entries(QUESTIONS).map(([key, id]) => [key, $(id).value.trim()]));
let answersTimer;

export async function buildDraft() {
  goStep('draft');
  shared.rebuildAsked = false;
  show($('draft-intro'), false); show($('draft-actions'));
  show($('draft-loading')); show($('draft-view'), false); show($('draft-error'), false); show($('draft-stale'), false);
  $('draft-title').textContent = 'Your strategy'; show($('draft-subtitle'), false); show($('draft-cost'), false);
  $('draft-save').disabled = true;
  if (!aiReady()) {
    showDraftIntro();
    $('draft-error').textContent = 'Building your strategy needs AI (step 1: Claude Code or an API key). Go back and add it, or skip to use the example settings.';
    show($('draft-error'));
    return;
  }
  const answers = currentAnswers();
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
    showDraftIntro();  // the note stays, Build tries again
    $('draft-error').textContent = `Couldn't draft your strategy: ${humanError(error.message.replace(/^Error invoking remote method '[^']+': /, ''))}`;
    show($('draft-error'));
    return;
  }
  clearInterval(clock);
  renderDraft();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
// Every upcoming check shows, unless they don't fit the strip: then only the soonest and "+N" (style.css .is-tight).
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
  $('activity-filter').addEventListener('click', () => openMenu($('activity-filter'), filterMenu()));
  // The panel's top edge drags: taller upward (it sits on the bottom bar), kept for next time, re-clamped when the
  // window changes. Between PANEL_MIN and 90% of the window.
  try { const saved = Number(localStorage.getItem(PANEL_HEIGHT) || 0); if (saved) setPanelHeight(saved, false); } catch {}
  $('activity-resize').addEventListener('pointerdown', event => {
    event.preventDefault();
    const grip = $('activity-resize'), startY = event.clientY, startHeight = $('activity-panel').getBoundingClientRect().height;
    try { grip.setPointerCapture(event.pointerId); } catch {}
    grip.classList.add('is-dragging');
    const move = moved => setPanelHeight(startHeight + (startY - moved.clientY), false);
    const stop = () => {
      grip.classList.remove('is-dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', stop);
      grip.removeEventListener('pointercancel', stop);
      setPanelHeight($('activity-panel').getBoundingClientRect().height);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
  });
  window.addEventListener('resize', () => {
    const height = $('activity-panel').getBoundingClientRect().height;
    if (height) setPanelHeight(height, false);
  });
  // The Anthropic console, where the spending limit lives: the warning card's one action.
  $('activity-warnings-limit').addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal('https://console.anthropic.com/settings/limits'); });
  $('activity-warnings-fold').addEventListener('click', () => {
    foldedWarnings = foldedWarnings === String(detailRunId) ? '' : String(detailRunId);
    renderActivity(lastActivity);
  });
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
  $('activity-all').addEventListener('click', () => { shownRuns += RUNS_PAGE; renderActivity(lastActivity); });
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
  window.addEventListener('focus-updated', () => { if (!$('activity-panel').hidden && lastActivity) renderActivity(lastActivity); });
  window.pilot.runs().then(renderActivity).catch(() => {});  // at once, not after the first 2 s tick
  setInterval(async () => {
    if ($('app').hidden) return;
    const runsNow = await window.pilot.runs();
    const {running} = runsNow;
    renderActivity(runsNow);
    const tabs = new Set(await window.pilot.openTabs());
    if (tabs.size !== shared.openedInChrome.size || [...tabs].some(url => !shared.openedInChrome.has(url))) { shared.openedInChrome = tabs; renderJobs(); }
    const forms = await window.pilot.formsOpen().catch(() => null);
    if (forms && JSON.stringify(forms) !== JSON.stringify(shared.formsOpen)) { shared.formsOpen = forms; renderSessionPage(); }
    if (wasRunning && !running) { loadJobs(); loadFocus(); }  // a check just finished: its jobs, and what it asks of you
    wasRunning = !!running;
    announceRuns(runsNow);
    showSearchStatus();
  }, 2000);
  $('cv-choose').addEventListener('click', async () => {
    const name = await window.pilot.chooseCv();
    if (name) { shared.state = await window.pilot.state(); refreshCv(); }
  });
  for (const [key, id] of Object.entries(QUESTIONS)) if (shared.state.settings.questionnaire?.[key]) $(id).value = shared.state.settings.questionnaire[key];
  for (const id of Object.values(QUESTIONS)) $(id).addEventListener('input', () => {
    clearTimeout(answersTimer);
    answersTimer = setTimeout(() => window.pilot.saveSettings({questionnaire: {...shared.state.settings.questionnaire, ...currentAnswers()}}), 400);
  });
}
