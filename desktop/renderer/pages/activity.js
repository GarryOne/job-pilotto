// Recent activity: the bar at the bottom of every screen and its panel.
import {runWarnings} from '../run-warnings.js';
import {el, pill} from '../components.js';
import {shared} from './shared.js';
import {answer} from './actions.js';
import {$, osText, show} from './core.js';
import {loadJobs, renderJobs} from './jobs.js';
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
export const KIND = {search: {icon: '🔎', name: 'New jobs check'}, mail: {icon: '📧', name: 'Gmail check'}, insight: {icon: '💡', name: 'Insight'},
  weekly: {icon: '📊', name: 'Weekly report'}, today: {icon: '📋', name: "Today's list"}, scout: {icon: '🔭', name: 'Find employers'},
  action: {icon: '⚡', name: 'Telegram action'}, prepare: {icon: '📝', name: 'Application kit'}, interview: {icon: '🎤', name: 'Interview review'},
  add: {icon: '➕', name: 'Tracked application'}, rejection: {icon: '🔍', name: 'Rejection review'}};
export const kindOf = run => (KIND[run?.kind] ? run.kind : 'search');
const WHO = {schedule: 'scheduled', you: 'by you', first: 'first check'};
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
export function renderActivity(data) {
  renderActionsPage(data);
  lastActivity = data;
  showAwaitedResult(data.runs);
  const {running, runs, nextSearchAt, nextMailAt} = data;
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
    $('activity-title').textContent = lastSearch ? (lastSearch.ok ? 'Last new jobs check' : 'Last new jobs check had problems') : 'No new jobs check yet';
    $('activity-step').textContent = lastSearch ? `${clockTime(lastSearch.endedAt || lastSearch.startedAt)} · ${outcome(lastSearch)}` +
      (lastSearch.ok ? '' : ' · click to see why') : '';
    $('activity-meta').textContent = [mailNote, nextSearchAt && `Next new jobs check ${hhmm(nextSearchAt)}`].filter(Boolean).join(' · ');
  } else {
    $('activity-title').textContent = 'No new jobs check yet';
    $('activity-step').textContent = 'Click "Check for new jobs" on Jobs to start one.';
    $('activity-meta').textContent = mailNote;
  }

  // Recent activity: newest first; click one to see its log below.
  const shown = runs.find(run => run.id === shared.selectedRun) || null;
  // Newest on top: the queued ones (the latest queued first), then the running one, then the finished ones.
  // Each queued one says what it waits for: the one queued before it, or the running task.
  const queue = data.queued || [];
  const waiting = queue.map((run, i) => ({...run, waiting: true,
    after: i ? KIND[kindOf(queue[i - 1])].name : running ? KIND[kindOf(running)].name : 'the current task'})).reverse();
  const recent = waiting.concat(running ? [{...running, live: true}] : [], runs.slice(0, 8));
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
      : `${clockTime(run.endedAt || run.startedAt)} · ${capital(outcome(run))} · ${WHO[run.trigger] || run.trigger}`));
    button.append(el('span', 'run-status'), el('span', 'run-icon', kind.icon), words, pill(...runStatus(run, warned)));
    button.addEventListener('click', () => { if (run.waiting) return; shared.selectedRun = run.live ? null : run.id; renderActivity(lastActivity); });
    item.append(button);
    return item;
  }));
  if (!runs.length && !running) $('activity-recent').append(Object.assign(document.createElement('li'), {className: 'muted', textContent: 'Nothing has run yet.'}));

  // How often: from Settings → How often (GitHub does it when Always on is on).
  const cloud = !!shared.state?.settings?.cloud?.repo;
  // A card per scheduled task: what, which day, and the time in large type (or why there's none).
  const slot = (name, at, none) => {
    const due = at && at <= Date.now();
    const item = el('span', 'ap-slot');
    item.append(el('span', 'muted', name), el('b', '', at ? (due ? 'due now' : `${new Date(at).toLocaleDateString([], {weekday: 'short'})} ${hhmm(at)}`) : none));
    return item;
  };
  $('activity-schedule').replaceChildren(slot('Next new jobs check', nextSearchAt, cloud ? 'in the cloud' : 'only when you ask'),
    slot('Next Gmail check', nextMailAt, cloud ? 'in the cloud' : 'off'),
    ...(cloud ? [el('span', 'muted small', osText('☁️ runs in your GitHub repo'))] : []));

  // The selected run (or the live / latest one): what it did, its phases, and its full log. A run read from
  // Notion brings its result and log from its page the first time it's shown.
  const picked = shown || (running ? {...running, live: true} : last);
  const run = picked?.pageId && !picked.log && !picked.live ? {...picked, ...runDetails.get(picked.pageId)} : picked;
  if (run?.pageId && !run.log && !run.live && !runDetails.has(run.pageId)) {
    runDetails.set(run.pageId, {log: ['Reading from Notion…']});
    window.pilot.runDetail(run.pageId).then(detail => { runDetails.set(run.pageId, detail); renderActivity(lastActivity); });
  }
  const lines = shown ? shown.log || [] : liveLines || last?.log || [];
  const kind = run ? KIND[kindOf(run)] : null;
  const where = run?.where === 'github' ? ' · ☁️ on GitHub' : run?.where === 'elsewhere' ? ' · elsewhere' : '';
  const detailWarnings = runWarnings(lines);
  const status = !run ? '' : run.live ? 'Running' : run.waiting ? 'Queued' : !run.ok || run.off ? 'Failed'
    : detailWarnings.length ? 'Completed with warnings' : 'Completed';
  $('activity-icon').textContent = kind?.icon || '';
  $('activity-selected').textContent = !run ? 'Nothing has run yet' : `${kind.name} · ${status}`;
  const checkedCount = lines.filter(line => /^Checked: /.test(line)).length;
  $('activity-sub').textContent = !run ? '' : [run.live ? (searchPhase(run.step) || 'starting') : capital(outcome(run)),
    checkedCount && `${checkedCount} companies checked`,
    run.live ? `started ${hhmm(Date.parse(run.startedAt))}` : `finished ${hhmm(Date.parse(run.endedAt || run.startedAt))}`].filter(Boolean).join(' · ') + where;
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
  $('activity-message').textContent = !run?.live && run?.message || '';
  show($('activity-message'), !run?.live && !!run?.message);
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
  const text = lines.join('\n') || 'Nothing to show yet.';
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
  setInterval(async () => {
    if ($('app').hidden) return;
    const runsNow = await window.pilot.runs();
    const {running} = runsNow;
    renderActivity(runsNow);
    const tabs = new Set(await window.pilot.openTabs());
    if (tabs.size !== shared.openedInChrome.size || [...tabs].some(url => !shared.openedInChrome.has(url))) { shared.openedInChrome = tabs; renderJobs(); }
    if (wasRunning && !running) loadJobs();  // a search just finished: show its jobs
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
