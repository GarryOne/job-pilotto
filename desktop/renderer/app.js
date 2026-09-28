import {replaceCell, replaceLine, withLine} from './markdown-edit.js';
import {looksLikeLink, matches} from './filter.js';
import {icon, fillIcons} from './icons.js';
import {ago, applicationStats, avatar, inProcess, band, byStat, matchLabel, placeAndMode, sorted, stats, statusPill, tags, workMode} from './jobs-view.js';
import {localize, osText as swap} from './os.js';
import {closeMenu, el, moreButton, pill, tag, tile} from './components.js';
import {openPalette} from './palette.js';

// The window: setup wizard on first run, then Jobs, Strategy and Settings.
// It only talks to the app through window.pilot (preload.cjs); it never sees a key's value.
const $ = id => document.getElementById(id);
const osText = text => swap(text, window.pilot.platform);
localize(document.body, window.pilot.platform);
const STEPS = ['welcome', 'ai', 'notion', 'cv', 'goals', 'draft', 'extras'];
fillIcons();
let state = await window.pilot.state();
// Focus page state, declared before the start-up code opens Focus (a later `let` isn't usable yet then).
let focusLoading = null, focusShown = false;
const FOCUS_WHEN = {1: ['Now', 'bad'], 2: ['Soon', 'warn'], 3: ['Today', 'info'], 4: ['When you can', 'neutral']};
let outdatedShown = false;
// How old a saved screen is, in minutes (ago() rounds to hours): "just now", "4 min ago", "2 h ago".
const savedAgo = iso => {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  return !Number.isFinite(minutes) || minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ago` : ago(iso);
};
// Application sessions (Apply with Claude in the app): declared before start-up code renders the job list.
const SESSION_STATE = {running: ['Applying', 'info'], input: ['Question for you', 'warn'], done: ['Ready for review', 'warn'],
  ended: ['Ended', 'neutral'], failed: ['Stopped', 'bad']};
const SESSION_PILL = {running: {label: 'Applying', tone: 'info'}, input: {label: 'Needs input', tone: 'warn'}, done: {label: 'Form filled', tone: 'good'}};
let sessionList = [], openSessionId = null, xterm = null, xtermFit = null, dockOpen = true, logChoice = {};
for (const line of document.querySelectorAll('[data-version]')) line.textContent = `Version ${state.about.label}`;
let draft = null;
let allJobs = [];
let jobsLoading = false;  // the first load from Notion is under way: the list keeps its spinner
let statFilter = null;  // the counter clicked above the list: 'applied', 'active', 'interviews', 'rejected', 'high', 'week', 'companies' or null

// ---------- helpers ----------
function show(element, visible = true) { element.hidden = !visible; }
function message(id, text, tone = '') { const el = $(id); el.textContent = text || ''; el.className = `message ${tone}`; }
function chip(parent, text) { const span = document.createElement('span'); span.className = 'chip'; span.textContent = text; parent.append(span); }
// Regex fragments from the draft ("z[uü]rich", "\\bsre\\b") shown as plain words.
const readable = fragment => fragment.replace(/\\b/g, '').replace(/\[([^\]])[^\]]*\]/g, '$1').replace(/[.?*+()]/g, '').trim();

document.addEventListener('click', event => {
  const link = event.target.closest('[data-link]');
  if (link) { event.preventDefault(); window.pilot.openExternal(link.dataset.link); }
  const copy = event.target.closest('[data-copy]');
  if (copy) navigator.clipboard.writeText($(copy.dataset.copy).textContent).then(() => { copy.textContent = 'Copied ✓'; });
});

// ---------- wizard ----------
function goStep(name) {
  const index = STEPS.indexOf(name);
  window.pilot.saveSettings({wizardStep: name});  // reopening the app continues here
  if (name === 'goals') showDraftCost();
  if (name === 'ai' && state.secrets.ANTHROPIC_API_KEY && !$('anthropic-key').value) {
    message('ai-message', '✓ Your key is saved. Continue, or paste a new key to replace it.', 'ok');
    // The saved key, masked (dots and its last 4 characters), as in Settings.
    window.pilot.secretHints().then(hints => {
      if (hints.ANTHROPIC_API_KEY) $('anthropic-key').placeholder = `${hints.ANTHROPIC_API_KEY} · saved (paste a new one to replace it)`;
    });
  }
  if (name === 'notion') showNotionNext();
  // Reviewing a finished setup: the workspace stays as it is (switching it is Settings → Notion).
  const reviewing = !!state.settings.setupDone && !!state.notion;
  $('notion-oauth').disabled = reviewing;
  document.querySelector('.step[data-step="notion"] .oauth').classList.toggle('locked', reviewing);
  if (name === 'ai') $('ai-save').textContent = state.secrets.ANTHROPIC_API_KEY && !$('anthropic-key').value ? 'Continue' : 'Check and save';
  if (name === 'notion' && (notionReady() || reviewing) && !$('notion-key').value) {
    message('notion-message', reviewing ? '✓ Connected to your Job Pilotto workspace. To connect a different one: Settings → Notion.'
      : '✓ Connected to your Job Pilotto workspace. Continue, or connect again.', 'ok');
  }
  document.querySelectorAll('.step').forEach(step => show(step, step.dataset.step === name));
  document.querySelectorAll('#step-list li').forEach((li, i) => {
    li.classList.toggle('current', i === index);
    li.classList.toggle('done', i < index || !!state.settings.setupDone);
    li.classList.toggle('jump', !!state.settings.setupDone || i < index);
  });
  show($('wizard-exit'), !!state.settings.setupDone);
  show($('review-mode'), !!state.settings.setupDone);  // setup done before: this is a review, not a redo
  $('draft-save').textContent = state.settings.setupDone ? 'Replace my strategy…' : 'Save strategy & continue';
  if (name === 'cv') refreshCv();
}
// Finished steps (or any step once setup was done before) can be opened from the sidebar.
document.querySelectorAll('#step-list li').forEach(li => li.addEventListener('click', () => {
  if (!li.classList.contains('jump') || li.classList.contains('current')) return;
  if (li.dataset.step === 'draft') toDraft(); else goStep(li.dataset.step);
}));
// Setup was done before (Run setup again, Rebuild from CV): leave the wizard any time, nothing changes.
$('wizard-exit').addEventListener('click', () => { show($('wizard'), false); show($('app')); loadJobs(); });
document.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => goStep('ai')));
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
  const current = STEPS.find(step => !document.querySelector(`.step[data-step="${step}"]`).hidden);
  goStep(STEPS[Math.max(0, STEPS.indexOf(current) - 1)]);
}));

const notionReady = () => !!state.notion && Object.keys(state.notion).length >= 11;

$('anthropic-key').addEventListener('input', () => {
  $('ai-save').textContent = state.secrets.ANTHROPIC_API_KEY && !$('anthropic-key').value.trim() ? 'Continue' : 'Check and save';
});
$('ai-save').addEventListener('click', async () => {
  const key = $('anthropic-key').value.trim();
  if (!key && state.secrets.ANTHROPIC_API_KEY) { goStep('notion'); return; }  // saved earlier: just continue
  if (!key.startsWith('sk-ant-')) { message('ai-message', 'Anthropic keys start with sk-ant-. Copy the whole key.', 'error'); return; }
  $('ai-save').disabled = true;
  message('ai-message', 'Checking the key…');
  const result = await window.pilot.checkAnthropic(key);
  $('ai-save').disabled = false;
  if (!result.ok) { message('ai-message', result.error, 'error'); return; }
  state.secrets = await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
  $('anthropic-key').value = '';
  message('ai-message', 'Saved ✓', 'ok');
  goStep('notion');
});
$('ai-skip').addEventListener('click', () => goStep('notion'));

// Notion is required: the wizard continues only when every database and page of the template is found.
$('notion-template').addEventListener('click', () => window.pilot.openExternal(state.templateUrl));
// Connected earlier (e.g. setup run again): Continue without connecting again.
function showNotionNext() { show($('notion-next'), notionReady() || (!!state.settings.setupDone && !!state.notion)); }
$('notion-next').addEventListener('click', () => goStep('cv'));
$('notion-oauth').addEventListener('click', async () => {
  $('notion-oauth').disabled = true;
  message('notion-message', 'Waiting for Notion: approve in your browser, then come back here…', 'waiting');
  const result = await window.pilot.notionOAuth();
  $('notion-oauth').disabled = false;
  // It didn't work: now offer the token way (hidden until then; Connect with Notion is enough for nearly everyone).
  if (!result.ok && !result.titles) { message('notion-message', result.error || 'Not connected.', 'error'); show($('notion-manual')); return; }
  if (!result.ok) show($('notion-manual'));
  showNotionResult(result);
});
$('notion-connect').addEventListener('click', async () => {
  const key = $('notion-key').value.trim();
  if (!key) { message('notion-message', 'Paste the API token from step 2.', 'error'); return; }
  $('notion-connect').disabled = true;
  message('notion-message', 'Looking for your Job Pilotto workspace…', 'waiting');
  const result = await window.pilot.notionConnect(key);
  $('notion-connect').disabled = false;
  showNotionResult(result);
});
async function showNotionResult(result) {
  const found = $('notion-found');
  found.replaceChildren();
  if (result.titles) {
    show(found);
    for (const [env, title] of Object.entries(result.titles)) {
      const ok = result.ids?.[env];
      found.append(Object.assign(document.createElement('div'), {className: ok ? 'yes' : 'no', textContent: `${ok ? '✓' : '✗'} ${title}`}));
    }
  }
  if (result.ok) {
    $('notion-key').value = '';
    state = await window.pilot.state();
    message('notion-message', `Connected ✓ ${result.workspace ? `${result.workspace}: ` : ''}your workspace is ready.`, 'ok');
    setTimeout(() => goStep('cv'), 900);
  } else if (result.error) {
    message('notion-message', result.error, 'error');
  } else if (result.missing?.length) {
    message('notion-message', 'The connection can\'t see your Job Pilotto page yet, or sees more than one page. Check step 3 (Content access → Edit access → tick only Job Pilotto → Save). Just saved it? Notion can take a minute: Connect again shortly.', 'error');
  } else {
    message('notion-message', `Columns are missing: ${result.problems.map(p => `${p.title} (${p.missing.slice(0, 3).join(', ')})`).join('; ')}. Duplicate the template again rather than editing columns.`, 'error');
  }
}

window.pilot.onNotionProgress(({found, total, ids, titles, building, waitingPage}) => {
  if (building) { show($('notion-found'), false); message('notion-message', 'Connected ✓ Building your Job Pilotto workspace in Notion (databases, columns, pages)… about a minute.', 'waiting'); return; }
  if (waitingPage) { show($('notion-found'), false); message('notion-message', 'Waiting for Notion to share your Job Pilotto page with the app…', 'waiting'); return; }
  message('notion-message', `Notion is still sharing your workspace with the connection: ${found} of ${total} found. This can take a minute; the app keeps checking.`, 'waiting');
  const list = $('notion-found');
  list.replaceChildren();
  show(list);
  for (const [env, title] of Object.entries(titles)) {
    list.append(Object.assign(document.createElement('div'), {className: ids[env] ? 'yes' : 'pending', textContent: `${ids[env] ? '✓' : '…'} ${title}`}));
  }
});

// What's happening, line by line: finished pieces ✓, the one being written last.
window.pilot.onDraftProgress(({part, percent, notes = []}) => {
  $('draft-feed').replaceChildren(...notes.slice(-9).map((note, i, shown) => Object.assign(document.createElement('li'),
    {className: i === shown.length - 1 ? 'now' : 'done', textContent: note})));
  $('draft-part').textContent = part;
  if (percent == null) return;
  $('draft-percent').textContent = percent ? `${percent}%` : '';
  $('draft-bar').style.width = `${Math.max(2, percent)}%`;
});

// The save window: a step is ● while it runs (with blocks written), ✓ when it's done; the bar sums them.
const SAVE_STEPS = {snapshot: 15, local: 5, profile: 40, answers: 25, search: 15};
const saveState = {};
window.pilot.onSaveProgress(({step, done, total, finished}) => {
  saveState[step] = finished ? 1 : total ? done / total : saveState[step] || 0;
  document.querySelectorAll('#save-steps li').forEach(li => {
    const name = li.dataset.saveStep, value = saveState[name];
    li.className = value === 1 ? 'done' : value !== undefined ? 'now' : '';
    const count = li.querySelector('.count');
    if (count) count.textContent = name === step && total && !finished ? `· ${done} of ${total} blocks` : '';
  });
  const percent = Object.entries(SAVE_STEPS).reduce((sum, [name, share]) => sum + share * (saveState[name] || 0), 0);
  $('save-bar').style.width = `${Math.max(3, Math.round(percent))}%`;
});

// ---------- runs ----------
const TRIGGER = {you: 'You', schedule: 'Schedule', first: 'First search'};
const clockTime = iso => new Date(iso).toLocaleString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'});
const duration = (a, b) => { const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
// The line under "Jobs": what's happening now, or when the last search ran.
async function showSearchStatus() {
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
const KIND = {search: {icon: '🔎', name: 'New jobs check'}, mail: {icon: '📧', name: 'Gmail check'}, insight: {icon: '💡', name: 'Insight'},
  weekly: {icon: '📊', name: 'Weekly report'}, today: {icon: '📋', name: "Today's list"}, scout: {icon: '🔭', name: 'Find employers'},
  action: {icon: '⚡', name: 'Telegram action'}, prepare: {icon: '📝', name: 'Application kit'}, interview: {icon: '🎤', name: 'Interview review'},
  add: {icon: '➕', name: 'Tracked application'}, rejection: {icon: '🔍', name: 'Rejection review'}};
const kindOf = run => (KIND[run?.kind] ? run.kind : 'search');
const WHO = {schedule: 'scheduled', you: 'by you', first: 'first check'};
// A run's status pill (Recent activity): running, queued, failed, completed with warnings, completed.
function runStatus(run, warned) {
  if (run.live) return ['Running', 'info', {dot: true}];
  if (run.waiting) return ['Queued', 'neutral'];
  if (!run.ok || run.off) return ['Failed', 'bad'];
  return warned ? ['With warnings', 'warn'] : ['Completed', 'good'];
}
// Lines of a run's log that are warnings (Notion busy, a step skipped…), each once.
const runWarnings = lines => [...new Set(lines.filter(line => /^Warning|\b429\b|Too Many Requests|skipped|failed/i.test(line))
  .map(line => line.replace(/^Warning:\s*/i, '').slice(0, 180)))];
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
let logLines = [];      // the running task's lines, live
let idleSeen = true;    // nothing was running at the last check: the next log line starts a new task
const runResults = new Map();  // run id -> the message a finished task produced, for Recent activity
let selectedRun = null; // id of the past run picked in "Recent activity"; null = the latest
let lastActivity = null;
const runDetails = new Map();  // a Notion run's result and log, read once (pageId -> {message, log})
function phaseIndex(lines) {
  let index = -1;
  lines.forEach(line => PHASES.forEach((phase, i) => { if (phase.match.test(line)) index = i; }));
  return index;
}
const hhmm = ms => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const capital = text => String(text || '').replace(/^./, c => c.toUpperCase());
// One line on what a finished run did.
function outcome(run) {
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
const COMMAND_KIND = {insight: 'insight', weekly: 'weekly', today: 'today', scout: 'scout', mail: 'mail', run: 'search'};
let awaitedRun = null;  // {kind, since}
function showAwaitedResult(runs) {
  const run = awaitedRun && runs.find(r => kindOf(r) === awaitedRun.kind && r.id >= awaitedRun.since && r.endedAt);
  if (!run) return;
  awaitedRun = null;
  const kind = KIND[kindOf(run)];
  const show = message => {
    const text = `${kind.icon} ${kind.name}: ${message ? `\n\n${message}` : capital(outcome(run))}`;
    if ($('activity-panel').hidden) { answer(text); return; }
    runResults.set(run.id, message || capital(outcome(run)));  // shown under the run in Recent activity
    selectedRun = run.id;
    renderActivity(lastActivity);
  };
  if (run.message || !run.pageId) show(run.message);
  else window.pilot.runDetail(run.pageId).then(detail => show(detail.message), () => show(null));  // on its Notion page
}
function renderActivity(data) {
  renderActionsPage(data);
  lastActivity = data;
  showAwaitedResult(data.runs);
  const {running, runs, nextSearchAt, nextMailAt} = data;
  if (!running) idleSeen = true;
  const last = runs[0];
  const lastSearch = runs.find(run => kindOf(run) === 'search');
  const lastMail = runs.find(run => kindOf(run) === 'mail');
  $('activity').dataset.state = running ? 'busy' : last && (!last.ok || last.off) ? 'error' : last ? 'ok' : 'idle';
  const liveLines = running ? logLines : null;
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
  const shown = runs.find(run => run.id === selectedRun) || null;
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
    button.addEventListener('click', () => { if (run.waiting) return; selectedRun = run.live ? null : run.id; renderActivity(lastActivity); });
    item.append(button);
    return item;
  }));
  if (!runs.length && !running) $('activity-recent').append(Object.assign(document.createElement('li'), {className: 'muted', textContent: 'Nothing has run yet.'}));

  // How often: from Settings → How often (GitHub does it when Always on is on).
  const cloud = !!state?.settings?.cloud?.repo;
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
  selectedRun = null;
  try {
    const result = await window.pilot.checkMail();
    if (result.cloud) toastMessage('Gmail check started in your GitHub repo', 'Results arrive in Notion and Telegram in a few minutes.');
  } finally {
    $('check-mail').disabled = false;
    refreshActivity();
  }
});
// Re-render soon (log lines arrive in bursts; one read of the run state per burst).
let activityTimer = null;
function refreshActivity() {
  if (activityTimer) return;
  activityTimer = setTimeout(async () => { activityTimer = null; renderActivity(await window.pilot.runs()); }, 250);
}
// The bar's action: hide the open panel, watch what's running, or see the details.
function barLabel() {
  $('activity-open').textContent = !$('activity-panel').hidden ? 'Hide activity ⌄' : lastActivity?.running ? 'View progress ↑' : 'Details ▴';
}
function openActivity(open) {
  show($('activity-panel'), open);
  // No dimming and no click-outside close: the panel is part of the bottom bar, and the page stays usable while it's open.
  $('activity').classList.toggle('open', open);
  $('activity-toggle').setAttribute('aria-expanded', open);
  if (open) $('log').scrollTop = $('log').scrollHeight;
  barLabel();
}
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
$('activity-all').addEventListener('click', event => window.pilot.openNotion(state?.notion?.NOTION_CRON_RUNS_DB, event.metaKey));
$('activity-backdrop').addEventListener('click', () => openActivity(false));
$('activity-manage').addEventListener('click', event => {
  event.preventDefault();
  openActivity(false);
  openView('settings');
  openSetting('schedule');
});
// Close it with Escape, its ✕, or the bar ("Hide activity").
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('activity-panel').hidden) openActivity(false); });

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
setInterval(async () => {
  if ($('app').hidden) return;
  const runsNow = await window.pilot.runs();
  const {running} = runsNow;
  renderActivity(runsNow);
  const tabs = new Set(await window.pilot.openTabs());
  if (tabs.size !== openedInChrome.size || [...tabs].some(url => !openedInChrome.has(url))) { openedInChrome = tabs; renderJobs(); }
  if (wasRunning && !running) loadJobs();  // a search just finished: show its jobs
  wasRunning = !!running;
  announceRuns(runsNow);
  showSearchStatus();
}, 2000);

function refreshCv() {
  $('cv-name').textContent = state.settings.cvName ? `✓ ${state.settings.cvName}` : 'No CV chosen yet';
  $('cv-next').disabled = !state.hasCv;
}
$('cv-choose').addEventListener('click', async () => {
  const name = await window.pilot.chooseCv();
  if (name) { state = await window.pilot.state(); refreshCv(); }
});
$('cv-next').addEventListener('click', () => goStep('goals'));

const QUESTIONS = {roles: 'q-roles', seniority: 'q-seniority', work_mode: 'q-remote', places_in_order: 'q-places',
  relocate: 'q-relocate', work_permit: 'q-permit', languages: 'q-languages', minimum_salary: 'q-salary',
  notice_period: 'q-notice', companies_to_skip: 'q-skip', anything_else: 'q-more', applications_per_day: 'q-target'};
for (const [key, id] of Object.entries(QUESTIONS)) if (state.settings.questionnaire?.[key]) $(id).value = state.settings.questionnaire[key];
const currentAnswers = () => Object.fromEntries(Object.entries(QUESTIONS).map(([key, id]) => [key, $(id).value.trim()]));
let answersTimer;
for (const id of Object.values(QUESTIONS)) $(id).addEventListener('input', () => {
  clearTimeout(answersTimer);
  answersTimer = setTimeout(() => window.pilot.saveSettings({questionnaire: currentAnswers()}), 400);
});
$('q-seniority').addEventListener('change', () => window.pilot.saveSettings({questionnaire: currentAnswers()}));

async function buildDraft() {
  goStep('draft');
  show($('draft-loading')); show($('draft-view'), false); show($('draft-error'), false);
  $('draft-title').textContent = 'Your strategy'; show($('draft-subtitle'), false); show($('draft-cost'), false);
  $('draft-save').disabled = true;
  if (!state.secrets.ANTHROPIC_API_KEY) {
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
    draft = await window.pilot.draftStrategy(answers);
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

// ---------- step 5: review the drafted strategy ----------
// The draft's lists, as the cards show them: [draft path, how an entry is shown, how a typed entry is stored].
const escapeFragment = text => text.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LISTS = {
  roles: [['search', 'role_keywords'], readable, escapeFragment],
  places: [['search', 'locations', 'top_tier'], readable, escapeFragment],
  country: [['search', 'locations', 'country_wide'], readable, escapeFragment],
  abroad: [['search', 'locations', 'abroad'], readable, escapeFragment],
  queries: [['search', 'jobs_board_search_queries'], text => text, text => text.trim()],
  languages: [['preferences', 'disqualifying_languages'], text => text, text => text.trim()],
};
const listOf = name => LISTS[name][0].reduce((node, key) => node?.[key], draft) || [];
// Each word capitalised (accents too: "zürich" -> "Zürich"), known acronyms in capitals.
const titleCase = text => String(text).replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase())
  .replace(/\b(Aws|Gcp|Sre|Eks|Ecs|Slo|Ci|Cd)\b/g, w => w.toUpperCase());
let draftSavedTimer, editsTimer;
function draftChanged(fields) {
  clearTimeout(editsTimer);
  editsTimer = setTimeout(async () => {
    await window.pilot.cacheDraftEdits(Object.fromEntries(fields.map(field => [field, draft[field]])));
    show($('draft-saved')); clearTimeout(draftSavedTimer);
    draftSavedTimer = setTimeout(() => show($('draft-saved'), false), 2500);
  }, 300);
}
function renderList(name, {limit = 0} = {}) {
  const [, show_, ] = LISTS[name];
  const box = $(`chips-${name}`);
  if (!box) return;
  const items = listOf(name);
  const expanded = box.dataset.expanded === '1';
  const visible = limit && !expanded ? items.slice(0, limit) : items;
  box.replaceChildren(...visible.map((item, i) => {
    const pill = Object.assign(document.createElement('span'), {className: 'chip removable'});
    const label = Object.assign(document.createElement('span'), {textContent: name === 'roles' || name === 'queries' ? titleCase(show_(item)) : titleCase(show_(item))});
    const remove = Object.assign(document.createElement('button'), {className: 'x', textContent: '×', title: 'Remove'});
    remove.addEventListener('click', () => { listOf(name).splice(i, 1); draftChanged(['search', 'preferences']); renderLists(); });
    pill.append(label, remove);
    return pill;
  }));
  if (limit && items.length > limit && !expanded) {
    const more = Object.assign(document.createElement('button'), {className: 'chip more', textContent: `+ ${items.length - limit} more`});
    more.addEventListener('click', () => { box.dataset.expanded = '1'; renderLists(); });
    box.append(more);
  }
  if (!items.length) box.append(Object.assign(document.createElement('span'), {className: 'muted small', textContent: 'None'}));
}
function renderLists() {
  renderList('roles', {limit: 10}); renderList('places', {limit: 6}); renderList('country', {limit: 4});
  renderList('abroad'); renderList('queries', {limit: 8}); renderList('languages');
}
// ✎ on a card: a small input to add an entry (Enter adds, Esc closes).
document.querySelectorAll('.review [data-edit]').forEach(button => button.addEventListener('click', () => {
  const card = button.closest('[data-list]');
  let input = card.querySelector('input.add');
  if (input) { input.remove(); return; }
  const name = card.dataset.list;
  input = Object.assign(document.createElement('input'), {className: 'add', placeholder: name === 'places' ? 'Add a place, then Enter' : 'Add, then Enter'});
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') input.remove();
    if (event.key !== 'Enter' || !input.value.trim()) return;
    listOf(name).push(LISTS[name][2](input.value));
    input.value = '';
    draftChanged(['search', 'preferences']);
    renderLists();
  });
  card.append(input);
  input.focus();
}));
$('draft-summary').addEventListener('click', () => $('draft-summary').classList.toggle('open'));
document.querySelectorAll('[data-goto-step]').forEach(button => button.addEventListener('click', () => goStep(button.dataset.gotoStep)));

// Markdown (headings, tables, bullets, paragraphs, **bold**) as read-only HTML for the Detailed strategy.
// Values are edited in place: click a cell, a bullet or a paragraph (Enter or click away saves, Esc cancels).
// edit(lineIndex, newLine) puts the change back into the markdown.
function markdownView(markdown, edit) {
  const box = document.createDocumentFragment();
  const inline = text => {
    const span = document.createElement('span');
    text.split(/(\*\*[^*]+\*\*)/).forEach(part => span.append(part.startsWith('**') ? Object.assign(document.createElement('b'), {textContent: part.slice(2, -2)}) : part));
    return span;
  };
  // The element shows the formatted text; while editing, its raw markdown (so **bold** survives).
  const editable = (element, raw, save) => {
    element.classList.add('editable');
    element.title = 'Click to edit';
    element.addEventListener('click', () => {
      if (element.isContentEditable) return;
      element.textContent = raw.trim() === '❓' ? '' : raw;  // an unanswered ❓: start empty
      element.contentEditable = 'plaintext-only';
      element.focus();
      getSelection().selectAllChildren(element); getSelection().collapseToEnd();
      let done = false;
      const finish = keep => {
        if (done) return;
        done = true;
        element.contentEditable = 'false';
        const text = element.textContent;
        if (keep && text.trim() !== raw.trim()) save(text.trim() || '❓');
        else renderDocs();
      };
      // The "to answer" colour follows the text as it's typed, not only after saving.
      const mark = () => element.classList.toggle('ask', element.textContent.includes('❓'));
      mark();
      element.addEventListener('input', mark);
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      });
      element.addEventListener('blur', () => finish(true), {once: true});
    });
  };
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) { const h = document.createElement(`h${Math.min(4, heading[1].length + 2)}`); h.append(inline(heading[2])); box.append(h); continue; }
    if (line.startsWith('|')) {
      const table = document.createElement('table');
      let header = true;
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
        if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue;
        const row = table.insertRow();
        const index = i, source = lines[i];
        cells.forEach((cell, c) => {
          const td = row.insertCell();
          td.append(inline(cell));
          if (cell.includes('❓')) td.classList.add('ask');
          if (!header && edit) editable(td, cell, text => edit(index, replaceCell(source, c, text)));
        });
        header = false;
      }
      i--;
      box.append(table);
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      const ul = document.createElement('ul');
      for (; i < lines.length && /^\s*[-*]\s/.test(lines[i]); i++) {
        const li = document.createElement('li');
        const raw = lines[i].trim().slice(2), index = i, source = lines[i];
        li.append(inline(raw));
        if (raw.includes('❓')) li.classList.add('ask');
        if (edit) editable(li, raw, text => edit(index, replaceLine(source, text)));
        ul.append(li);
      }
      i--;
      box.append(ul);
      continue;
    }
    const p = document.createElement('p'); p.append(inline(line));
    if (line.includes('❓')) p.classList.add('ask');
    const index = i, source = lines[i];
    if (edit) editable(p, line, text => edit(index, replaceLine(source, text)));
    box.append(p);
  }
  return box;
}
function renderDocs() {
  for (const [doc, field] of [['profile', 'profile_markdown'], ['answers', 'answers_markdown']]) {
    $(`doc-${doc}`).replaceChildren(markdownView(draft[field], (index, line) => {
      draft[field] = withLine(draft[field], index, line);
      draftChanged([field]);
      renderDocs();
    }));
  }
  $('draft-profile').value = draft.profile_markdown;
  $('draft-answers').value = draft.answers_markdown;
}
document.querySelectorAll('.doc-edit').forEach(button => button.addEventListener('click', () => {
  const doc = button.dataset.doc, area = $(`draft-${doc}`), view = $(`doc-${doc}`);
  const editing = area.hidden;
  show(area, editing); show(view, !editing);
  button.textContent = editing ? 'Done editing' : 'Edit as text';
  if (!editing) renderDocs();
}));

// Open questions: answer inline (added to the standard answers), or skip.
function renderQuestions() {
  const questions = draft.open_questions;
  show($('open-questions'), questions.length > 0);
  $('open-count').textContent = `${questions.length} detail${questions.length === 1 ? '' : 's'} need${questions.length === 1 ? 's' : ''} your answer`;
  const box = $('open-list');
  const expanded = box.dataset.expanded === '1';
  const shown = expanded ? questions : questions.slice(0, 3);
  box.replaceChildren(...shown.map((question, i) => {
    const row = Object.assign(document.createElement('div'), {className: 'q-row'});
    const text = Object.assign(document.createElement('span'), {className: 'q-text', textContent: question});
    const answer = Object.assign(document.createElement('button'), {className: 'secondary small-btn', textContent: 'Answer'});
    const skip = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Skip'});
    answer.addEventListener('click', () => {
      const input = Object.assign(document.createElement('input'), {placeholder: 'Your answer, then Enter'});
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || !input.value.trim()) return;
        const heading = '# Answered during setup';
        if (!draft.answers_markdown.includes(heading)) draft.answers_markdown = `${draft.answers_markdown.trim()}\n\n${heading}\n`;
        draft.answers_markdown = `${draft.answers_markdown.trimEnd()}\n- ${question} — ${input.value.trim()}\n`;
        draft.open_questions.splice(draft.open_questions.indexOf(question), 1);
        draftChanged(['answers_markdown', 'open_questions']);
        renderQuestions(); renderDocs();
      });
      row.replaceChildren(text, input);
      input.focus();
    });
    skip.addEventListener('click', () => { draft.open_questions.splice(draft.open_questions.indexOf(question), 1); draftChanged(['open_questions']); renderQuestions(); });
    row.append(text, answer, skip);
    return row;
  }));
  const more = $('open-more');
  show(more, questions.length > 3);
  more.textContent = expanded ? 'Show fewer' : `Show ${questions.length - 3} more`;
}
$('open-more').addEventListener('click', () => { const box = $('open-list'); box.dataset.expanded = box.dataset.expanded === '1' ? '' : '1'; renderQuestions(); });

function renderDraft() {
  show($('draft-loading'), false); show($('draft-error'), false); show($('draft-view'));
  $('draft-title').textContent = 'Review your strategy';
  show($('draft-subtitle'));
  $('draft-cost').textContent = `✦ AI draft · $${draft.usd.toFixed(2)}`;
  show($('draft-cost'));
  const q = state.settings.questionnaire || currentAnswers();
  $('draft-summary').textContent = draft.summary;
  $('draft-summary').title = 'Click to show all';
  const tile = (icon, label, value) => {
    const box = Object.assign(document.createElement('div'), {className: 'tile'});
    box.append(Object.assign(document.createElement('span'), {className: 'tile-icon', textContent: icon}),
      Object.assign(document.createElement('div'), {innerHTML: ''}));
    box.lastChild.append(Object.assign(document.createElement('small'), {textContent: label}), Object.assign(document.createElement('b'), {textContent: value || '—'}));
    return box;
  };
  const market = draft.search.locations.country_wide[0] || draft.search.locations.top_tier[0] || '';
  $('draft-tiles').replaceChildren(
    tile('👤', 'Target level', q.seniority ? (q.seniority === 'Junior' ? 'Junior' : `${q.seniority} and above`) : ''),
    tile('📍', 'Primary market', titleCase(readable(market))),
    tile('🏢', 'Work mode', q.work_mode),
    tile('🧰', 'Core stack', (draft.search.quality_stack_keywords || []).slice(0, 4).map(k => titleCase(readable(k))).join(', ')));
  document.querySelectorAll('.review .chips').forEach(box => { box.dataset.expanded = ''; });
  renderLists();
  $('open-list').dataset.expanded = '';
  renderQuestions();
  renderDocs();
  $('draft-save').disabled = false;
}
// Same answers as the cached draft: show it again (no new Claude call). Changed answers or "Draft again": redraft.
// The saved draft is shown again (no new Claude call) unless it's out of date: answers or CV changed. During the
// first setup an out-of-date draft is redrafted; once setup is done, the user decides (Redraft), nothing automatic.
async function toDraft() {
  const cached = await window.pilot.cachedDraft();
  const answersChanged = cached && JSON.stringify(cached.answers) !== JSON.stringify(currentAnswers());
  const stale = cached && (answersChanged || cached.cvChanged);
  if (!cached || (stale && !state.settings.setupDone)) { buildDraft(); return; }
  draft = cached.draft;
  goStep('draft');
  renderDraft();
  $('draft-stale-text').textContent = cached.cvChanged ? 'Your CV changed since this strategy was drafted.'
    : answersChanged ? 'Your answers changed since this strategy was drafted.' : '';
  show($('draft-stale'), !!stale);
}
$('draft-redraft').addEventListener('click', () => { show($('draft-stale'), false); buildDraft(); });
for (const [id, field] of [['draft-profile', 'profile_markdown'], ['draft-answers', 'answers_markdown']]) {
  $(id).addEventListener('input', () => { draft[field] = $(id).value; draftChanged([field]); });
}
$('goals-next').addEventListener('click', toDraft);
// Rebuild from CV (setup done before): say what drafting costs before it runs; nothing changes until the review.
function showDraftCost() {
  show($('goals-cost'), !!state.settings.setupDone);
}
$('draft-again').addEventListener('click', buildDraft);
async function saveDraft(parts = null) {
  for (const key of Object.keys(saveState)) delete saveState[key];
  document.querySelectorAll('#save-steps li').forEach(li => { li.className = ''; const count = li.querySelector('.count'); if (count) count.textContent = ''; });
  $('save-bar').style.width = '3%';
  $('save-title').textContent = 'Saving your strategy to Notion';
  message('save-message', '');
  show($('save-close'), false); show($('save-retry'), false);
  const replacing = !!state.settings.setupDone;
  show(document.querySelector('[data-save-step="snapshot"]'), replacing);
  if (!replacing) saveState.snapshot = 1;  // nothing to keep on a first setup
  if (!$('save-dialog').open) $('save-dialog').showModal();
  const result = await window.pilot.saveStrategy({...draft, profile_markdown: $('draft-profile').value, answers_markdown: $('draft-answers').value}, parts);
  if (!result.ok) {
    $('save-title').textContent = 'Not saved to Notion yet';
    message('save-message', osText(`${result.error} Your strategy is kept on this computer: try again.`), 'error');
    show($('save-close')); show($('save-retry'));
    return;
  }
  $('save-title').textContent = 'Saved to Notion ✓';
  $('save-bar').style.width = '100%';
  state = await window.pilot.state();
  // A replaced strategy: back to the app; the first setup: on to the last step.
  setTimeout(() => {
    $('save-dialog').close();
    if (replacing) { show($('wizard'), false); show($('app')); loadJobs(); toastMessage('Strategy replaced ✓', 'The previous one is kept in Notion as “🗂 Previous strategy”.'); }
    else goStep('extras');
  }, 900);
}
// First setup: save straight away. Setup done before (Rebuild from CV): review what changes, grouped by what each
// change triggers (lib/strategy.js rebuildGroups), with the impact and AI cost; only the ticked groups are saved.
$('draft-save').addEventListener('click', () => { if (state.settings.setupDone) openRebuildReview(); else saveDraft(); });
async function openRebuildReview() {
  $('rebuild-groups').replaceChildren(el('p', 'message waiting', 'Comparing the draft with your current strategy…'));
  $('rebuild-total').textContent = '';
  $('replace-go').disabled = true;
  $('replace-dialog').showModal();
  const current = {...draft, profile_markdown: $('draft-profile').value, answers_markdown: $('draft-answers').value};
  $('rebuild-draft-cost').textContent = draft?.usd ? `This draft cost $${draft.usd.toFixed(2)} (already spent). ` : '';
  const result = await window.pilot.rebuildImpact(current);
  if (!result.ok) { $('rebuild-groups').replaceChildren(el('p', 'message error', result.error)); return; }
  if (!result.groups.length) { $('rebuild-groups').replaceChildren(el('p', 'muted', 'This draft changes nothing in your current strategy.')); return; }
  const boxes = {};
  const update = () => {
    const picked = result.groups.filter(group => boxes[group.id].checked);
    $('replace-go').disabled = !picked.length;
    const usd = picked.map(group => Number((group.cost.match(/\$([\d.]+)/) || [])[1] || 0)).reduce((a, b) => a + b, 0);
    $('rebuild-total').textContent = picked.length ? `Applying ${picked.length} of ${result.groups.length}: ${usd ? `≈ $${usd.toFixed(2)} of AI re-scoring, spread over the next searches` : 'no AI cost'}.` : 'Nothing selected.';
  };
  $('rebuild-groups').replaceChildren(...result.groups.map(group => {
    const box = el('label', 'review-group');
    box.dataset.group = group.id;
    const check = Object.assign(document.createElement('input'), {type: 'checkbox', checked: true});
    boxes[group.id] = check;
    const text = el('span', 'review-text');
    const head = el('span', 'review-head');
    head.append(el('b', '', group.title), pill(group.cost, group.cost.startsWith('≈') ? 'warn' : 'neutral'));
    const list = el('ul', 'review-changes');
    list.append(...group.changes.slice(0, 8).map(change => el('li', '', change)), ...(group.changes.length > 8 ? [el('li', 'muted', `+ ${group.changes.length - 8} more`)] : []));
    text.append(head, list, el('span', 'muted small', group.impact));
    if (group.linked) text.append(el('span', 'small review-linked', 'Locations and remote rules changed: applied to the search and the Profile together, so the crawl and the fit score agree.'));
    box.append(check, text);
    check.addEventListener('change', () => {
      if (group.linked && boxes[group.linked]) boxes[group.linked].checked = check.checked;  // one atomic change
      update();
    });
    return box;
  }));
  update();
}
// Every dialog: a click on the dimmed backdrop closes it like Esc (a dialog that blocks Esc, e.g. while saving,
// blocks this too). Pressed and released outside, so selecting text in a field and letting go outside doesn't close it.
let pressedOutside = null;
const outside = (dialog, event) => {
  const box = dialog.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
};
document.addEventListener('mousedown', event => {
  pressedOutside = event.target instanceof HTMLDialogElement && event.target.open && outside(event.target, event) ? event.target : null;
});
document.addEventListener('click', event => {
  const dialog = pressedOutside;
  pressedOutside = null;
  if (!dialog || event.target !== dialog || !outside(dialog, event)) return;
  if (dialog.dispatchEvent(new Event('cancel', {cancelable: true}))) dialog.close();
});
$('replace-cancel').addEventListener('click', () => $('replace-dialog').close());
$('replace-go').addEventListener('click', event => {
  event.preventDefault();
  $('replace-dialog').close();
  saveDraft([...$('rebuild-groups').querySelectorAll('.review-group')].filter(row => row.querySelector('input').checked).map(row => row.dataset.group));
});
$('save-retry').addEventListener('click', saveDraft);
$('save-close').addEventListener('click', () => $('save-dialog').close());
$('save-dialog').addEventListener('cancel', event => { if (!$('save-close').hidden) return; event.preventDefault(); });  // no Esc while saving
// "Set up" on the last step: finish the setup, open that Settings card, and offer the way back to the wizard.
document.querySelectorAll('[data-goto-settings]').forEach(button => button.addEventListener('click', async () => {
  await finishSetup();
  openView('settings');
  show($('back-to-setup'));
  openSetting(button.dataset.gotoSettings);
}));
async function finishSetup() {
  state.settings = await window.pilot.saveSettings({setupDone: true});
  show($('wizard'), false); show($('app'));
  loadJobs();
  // The first search starts now, on screen, so the list fills in while the user watches.
  window.pilot.firstSearch();
  showSearchStatus();
}
$('finish').addEventListener('click', finishSetup);
$('back-to-setup-go').addEventListener('click', () => { show($('back-to-setup'), false); show($('app'), false); show($('wizard')); goStep('extras'); });
$('back-to-setup-close').addEventListener('click', () => show($('back-to-setup'), false));
// Back through the wizard with everything already filled in (keys, Notion, CV, answers, the last draft).
$('rerun-setup').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('welcome'); });

// ---------- Settings: sub-pages (Overview, Application profile, Automation, Connections, Data & backup, Advanced) ----------
function settingsPage(name) {
  remembered('settingsPage', name);
  if (name === 'profile') openProfile();
  document.querySelectorAll('[data-settings-page]').forEach(page => show(page, page.dataset.settingsPage === name));
  document.querySelectorAll('.settings-nav [data-settings-go]').forEach(button => button.classList.toggle('is-active', button.dataset.settingsGo === name));
}
// One Settings card (setting-<id>): its sub-page, then scrolled to. Used by every link into Settings.
function openSetting(id) {
  const card = $(`setting-${id}`);
  if (!card) return;
  const view = card.closest('.view')?.dataset.view;
  if (view && view !== 'settings') {  // a card on another page (Profile: CV, details, links, assistant)
    openView(view);
    setTimeout(() => card.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
    return;
  }
  settingsPage(card.closest('[data-settings-page]')?.dataset.settingsPage || 'overview');
  if (card.classList.contains('conn-panel')) document.querySelectorAll('.conn-panel').forEach(panel => show(panel, panel === card));
  setTimeout(() => card.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
}
document.addEventListener('click', event => {
  const go = event.target.closest('[data-settings-go]');
  if (go) { settingsPage(go.dataset.settingsGo); document.querySelector('main')?.scrollTo(0, 0); }
});
$('ov-backups').addEventListener('click', () => window.pilot.showBackups());
$('ov-profile').addEventListener('click', () => settingsPage('profile'));
// Settings → Profile: CV & details and Standard answers. What goes into applications; nothing here re-scores jobs.
async function openProfile() {
  state = await window.pilot.state();
  $('contact-save').disabled = true;
  $('claude-consent').checked = !!state.settings.claudeConsent;
  showContact();
  profileTab('details');
}

// Connections status, shared by Overview (cards + alert), Connections (Connected / Available + alert) and the
// dot on Connections. required: counted for the alert and the dot (Google Jobs is an optional extra).
const SERVICES = [
  {id: 'ai', name: 'Anthropic', icon: 'bot', what: 'AI for scoring and application kits', required: true,
    why: 'Reading jobs, fit scores and application kits need your AI key.'},
  {id: 'notion', name: 'Notion', icon: 'layers', what: 'Job search workspace', required: true,
    why: 'Your jobs, applications and profile live in your Notion.'},
  {id: 'google', name: 'Gmail & Calendar', icon: 'mail', what: 'Read-only access', required: true,
    why: 'Replies, interviews and recruiter emails are tracked from Gmail.'},
  {id: 'extension', name: 'Chrome extension', icon: 'puzzle', what: 'Application form filling', required: true,
    why: 'It fills application forms with your details and CV.'},
  {id: 'telegram', name: 'Telegram', icon: 'send', what: 'Digests and reminders', required: true,
    why: 'Daily digests and reminders need a bot connection.'},
  {id: 'serpapi', name: 'Google Jobs (SerpApi)', icon: 'search', what: 'Additional job results', connect: 'Add key'},
];
async function serviceStatus() {
  const [google, seen] = await Promise.all([window.pilot.googleStatus().catch(() => ({})), window.pilot.extensionSeen().catch(() => null)]);
  const extensionOn = !!seen && Date.now() - seen.at < 90 * 1000;
  const on = {ai: !!state.secrets.ANTHROPIC_API_KEY, notion: !!state.secrets.NOTION_TOKEN, serpapi: !!state.secrets.SERPAPI_API_KEY,
    telegram: !!(state.secrets.TELEGRAM_BOT_TOKEN && state.settings.telegramChatId), google: !!google.connected, extension: extensionOn};
  const detail = {google: google.connected && google.email, extension: extensionOn && seen.version && `v${seen.version}`,
    telegram: on.telegram && state.settings.telegramBot && `@${state.settings.telegramBot}`};
  return {on, detail, missing: SERVICES.find(service => service.required && !on[service.id]) || null};
}
function stateLine(on, detail = '') {
  const line = el('span', `service-state${on ? ' is-on' : ''}`);
  line.append(icon(on ? 'check' : 'info'), on ? `Connected${detail ? ` · ${detail}` : ''}` : 'Not connected');
  return line;
}
function showAlert(prefix, missing) {
  show($(`${prefix}-alert`), !!missing);
  if (!missing) return;
  $(`${prefix}-alert-title`).textContent = prefix === 'ov' ? `Finish connecting ${missing.name}` : `${missing.name} is not connected`;
  $(`${prefix}-alert-text`).textContent = missing.why;
  $(`${prefix}-alert-go`).textContent = prefix === 'ov' ? `Connect ${missing.name}` : `Set up ${missing.name}`;
  $(`${prefix}-alert-go`).onclick = () => openSetting(missing.id);
}
async function renderConnections(status) {
  const {on, detail, missing} = status || await serviceStatus();
  show($('connections-dot'), !!missing);
  showAlert('conn', missing);
  const card = service => {
    const box = el('div', 'service-card is-row');
    const text = el('span', 'service-text');
    text.append(el('b', '', service.name), stateLine(on[service.id], detail[service.id]), el('span', 'muted small', service.what));
    const button = el('button', on[service.id] ? 'secondary' : 'secondary is-signal', on[service.id] ? 'Manage' : service.connect || 'Connect');
    button.addEventListener('click', () => openSetting(service.id));
    box.append(tile(service.icon, on[service.id] ? 'good' : 'warn'), text, button);
    return box;
  };
  $('conn-on').replaceChildren(...SERVICES.filter(service => on[service.id]).map(card));
  $('conn-off').replaceChildren(...SERVICES.filter(service => !on[service.id]).map(card));
  show($('conn-off-head'), SERVICES.some(service => !on[service.id]));
}
async function renderOverview() {
  const [status, backup, contact] = await Promise.all([serviceStatus(), window.pilot.backupStatus().catch(() => ({})),
    window.pilot.contact().catch(() => ({}))]);
  const {on, detail, missing} = status;
  renderConnections(status);
  renderDiagnostics(status);
  showAlert('ov', missing);
  $('ov-services').replaceChildren(...SERVICES.filter(service => service.required).map(service => {
    const card = Object.assign(document.createElement('button'), {type: 'button', className: 'service-card', title: `Open ${service.name}`});
    const text = el('span');
    text.append(el('b', '', service.name), stateLine(on[service.id], detail[service.id]));
    card.append(tile(service.icon, on[service.id] ? 'good' : 'warn'), text);
    card.addEventListener('click', () => openSetting(service.id));
    return card;
  }));
  $('ov-cv').textContent = state.settings.cvName || 'None yet';
  const needed = {first_name: 'first name', last_name: 'last name', email: 'email', phone: 'phone'};
  const gaps = Object.keys(needed).filter(key => !contact?.[key]).map(key => needed[key]);
  const line = el('span', `service-state${gaps.length ? '' : ' is-on'}`);
  line.append(icon(gaps.length ? 'info' : 'check'), gaps.length ? `Missing: ${gaps.join(', ')}` : 'Complete');
  $('ov-contact').replaceChildren(line);
  const chosen = kind => document.querySelector(`[data-schedule="${kind}"]`)?.selectedOptions[0]?.textContent || '';
  $('ov-search').textContent = chosen('search');
  $('ov-kits').textContent = chosen('kits');
  $('ov-cloud').textContent = state.settings.cloud?.repo ? `On — GitHub ${state.settings.cloud.repo}` : 'Off — runs while the app is open';
  $('ov-backup').textContent = backup.at ? new Date(backup.at).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : 'None yet';
}

// Application profile: CV preview, one Save for contact + links (enabled once something changed), the assistant's explainer.
document.querySelectorAll('[data-contact]').forEach(input => input.addEventListener('input', () => { $('contact-save').disabled = false; }));
$('claude-how').addEventListener('click', () => { $('claude-how-text').hidden = !$('claude-how-text').hidden; });
// Automation: run mode (this Mac while open, or Always on in GitHub); both segments lead to the Always on card.
function showRunMode() {
  const repo = state.settings.cloud?.repo;
  document.querySelectorAll('[data-run-mode]').forEach(button => button.classList.toggle('is-active', (button.dataset.runMode === 'cloud') === !!repo));
  $('run-mode-text').textContent = repo ? `Runs in your GitHub repository ${repo}, even with your Mac off.`
    : 'Scheduled tasks run on this Mac while Job Pilotto is open.';
  $('run-mode-more').textContent = repo ? 'Manage Always on' : 'Learn about Always on';
  $('tz-note').textContent = `Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
}
document.querySelectorAll('[data-run-mode]').forEach(button => button.addEventListener('click', () => openSetting('cloud')));
$('run-mode-more').addEventListener('click', () => openSetting('cloud'));
// Data & backup and Advanced: explainers and the reset options open on demand; Diagnostics shows live status.
$('reports-how').addEventListener('click', () => { $('reports-how-text').hidden = !$('reports-how-text').hidden; });
$('reset-review').addEventListener('click', () => { $('reset-options').hidden = !$('reset-options').hidden; });
$('diag-troubleshoot').addEventListener('click', () => {
  settingsPage('connections');
  const help = document.querySelector('[data-settings-page="connections"] .troubleshoot');
  help.open = true;
  setTimeout(() => help.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
});
function renderDiagnostics({on, detail}) {
  const version = document.querySelector('[data-version]')?.textContent?.trim();
  $('diag-app').replaceChildren(stateLine(true, version));
  $('diag-app').firstChild.lastChild.textContent = `Running${version ? ` · ${version}` : ''}`;
  $('diag-ext').replaceChildren(stateLine(on.extension, detail.extension));
  $('diag-search').textContent = $('last-search').textContent;
}

// ---------- app ----------
// The page (and Settings section) open now, kept for a reload (⌘R): the app comes back where it was.
// sessionStorage: survives a reload of this window, not a restart of the app (that opens Focus as before).
const remembered = (key, value) => {
  try { if (value === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, value); } catch {}
  return null;
};
function openView(name) {
  remembered('view', name);
  setTimeout(() => { if (typeof renderDock === 'function' && sessionList) renderDock(); }, 0);  // the tray hides on the sessions page
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  if (name === 'strategy') { loadStrategy(); showCvChanged(); }
  if (name === 'settings') {
    settingsPage('overview');
    $('automation-save').disabled = true;
    loadSettings();
    window.pilot.dailyTarget().then(setting => { $('set-target').value = setting.target; $('set-remind').checked = setting.reminders; });
  }
  if (name === 'interviews') loadInterviews();
  if (name === 'focus') loadFocus();
}
document.querySelectorAll('.nav').forEach(nav => {
  nav.title = nav.textContent.trim();  // the label, when the narrow window shows the sidebar as icons only
  nav.addEventListener('click', () => openView(nav.dataset.view));
});

// ⌘K / Ctrl+K: the command palette. Its commands are the app's own buttons, read when it opens (so a disabled
// button or a missing Notion link isn't offered); running one opens its page, then clicks it.
const PALETTE_KEYWORDS = {mail: 'email inbox replies confirmations calendar google', run: 'search jobs find refresh',
  scout: 'employers companies discover', status: 'health check', weekly: 'report stats', insight: 'tip advice',
  today: 'telegram list', applied: 'applications', saved: 'bookmarks starred'};
const labelOf = node => node?.textContent.replace(/\s+/g, ' ').trim() || '';
function paletteCommands() {
  const commands = [];
  const add = (group, label, hint, keywords, run) => { if (label) commands.push({group, label, hint, keywords, run}); };
  const button = (view, id, keywords, hint = '') => {
    const node = $(id);
    if (node && !node.disabled && !node.closest('[hidden]:not(.view)')) add(view[0].toUpperCase() + view.slice(1), labelOf(node), hint || node.title, keywords, () => { openView(view); node.click(); });
  };
  document.querySelectorAll('.nav').forEach(nav => add('Go to', `Open ${labelOf(nav)}`, '', 'page view', () => openView(nav.dataset.view)));
  document.querySelectorAll('.action[data-command]').forEach(node => add('Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.querySelector('span')), PALETTE_KEYWORDS[node.dataset.command], () => { openView('actions'); node.click(); }));
  button('jobs', 'refresh', 'find jobs scan');
  button('jobs', 'apply-open', 'apply fill forms');
  button('jobs', 'applied-open', 'track add application outside');
  button('interviews', 'iv-add', 'upload audio video transcript file');
  button('interviews', 'iv-record', 'start call audio', 'Record a call (everyone agreed)');
  button('interviews', 'iv-recordings', 'files folder finder');
  document.querySelectorAll('#notion-links:not([hidden]) .notion-link').forEach(link => add('Notion', `Notion: ${labelOf(link)}`, '', 'open page database', () => link.click()));
  return commands;
}
$('palette-hint').addEventListener('click', () => openPalette(paletteCommands()));
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
  if ($('app').hidden) return;  // the setup wizard has nothing to run yet
  event.preventDefault();
  if ($('palette')) $('palette').close(); else openPalette(paletteCommands());
});

// Job pages open in Chrome now (reported by the extension; refreshed every 2 s), plus ones just opened here.
let openedInChrome = new Set();
// Apply with Claude: offered (and recommended) when Claude Code is installed and Notion is connected.
let claudeReady = false;
const claudeStarted = new Set();
const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');

// Pill tones: where a job stands, and how it's worked.
const MODE_TONE = {remote: 'good', hybrid: 'info'};
// Work in progress on a job (redrafting its kit, tailoring its CV), shown on its row while the menu is closed.
const busyNotes = new Map();

function renderJobs() {
  closeMenu();
  const filter = $('filter-status').value;
  const text = $('filter-text').value.trim();
  // A pasted link finds that job whatever its status; words filter within the chosen status.
  const anyStatus = looksLikeLink(text);
  const rows = sorted(byStat(allJobs, statFilter).filter(job => (anyStatus || filter === 'all' || (filter === 'open' ? job.status === 'unreviewed' : job.status === filter)) &&
    matches(job, text)), $('sort-by').value);
  const body = $('jobs-body');
  body.replaceChildren();
  for (const job of rows.slice(0, 300)) {
    const row = el('article', 'job-row');
    // Fit: a ring filled to the score (the compact list adds "Strong match" under it).
    const fit = el('div', `fit-cell ${band(job.fit)}`);
    const ring = el('div', 'fit-ring');
    ring.style.setProperty('--p', job.fit ?? 0);
    ring.append(el('span', '', job.fit ?? '–'));
    fit.append(ring, el('span', 'fit-label', matchLabel(job.fit)));
    fit.title = job.fit == null ? 'Not scored yet (needs the AI key)' : 'Fit with your profile, out of 100';
    const live = sessionFor(job.url);
    const {label: statusLabel, tone: statusTone} = live && !live.endedAt ? SESSION_PILL[live.status] || statusPill(job) : statusPill(job);

    const role = el('div', 'role');
    const titleLine = el('div', 'title-line');
    const link = Object.assign(el('a', '', job.title), {href: '#', title: 'Open the posting'});
    link.addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal(job.url); });
    titleLine.append(link, Object.assign(pill(statusLabel, statusTone), {className: `ui-pill tone-${statusTone} status-inline`}));
    role.append(titleLine);
    // Compact list: company · place · mode · age on one line, in place of those columns.
    const meta = el('div', 'meta');
    const small = avatar(job.company);
    const smallBadge = el('span', 'logo', small.initials);
    smallBadge.style.setProperty('--hue', small.hue);
    meta.append(smallBadge, el('b', '', job.company));
    for (const part of [placeAndMode(job.location, job.work_mode), ago(job.first_seen_at)].filter(Boolean)) {
      meta.append(el('span', 'sep', '·'), el('span', '', part));
    }
    role.append(meta);
    if (job.reason) role.append(Object.assign(el('div', 'reason', job.reason), {title: job.reason}));
    const chips = el('div', 'tags');
    // Three skill tags, the rest behind "+N".
    const skills = tags(job, 8);
    for (const skill of skills.slice(0, 3)) chips.append(tag(skill));
    if (skills.length > 3) chips.append(tag(`+${skills.length - 3}`, {title: skills.slice(3).join(', ')}));
    if (job.kit && job.notion_url) {
      // Which inputs it was drafted from (src/ai/provenance.py): today's, earlier ones, or unknown (before they were recorded).
      const {label, title} = kitLabel(job.kit_state);
      chips.append(tag(label, {title: `${title} Click to open it in Notion.`, onClick: event => window.pilot.openNotion(job.notion_url, event.metaKey)}));
    }
    if (job.tailored && job.code) chips.append(tag('📄 Tailored CV', {title: 'Your CV tailored to this job, with the changes highlighted',
      onClick: () => window.pilot.openTailoredCv(job.code)}));
    if (job.rejection) chips.append(tag(`🔎 ${job.rejection}`, {title: job.rejection_lesson || 'Why it was rejected (on its Notion page)',
      onClick: event => job.notion_url && window.pilot.openNotion(job.notion_url, event.metaKey)}));
    if (busyNotes.has(job.url)) chips.append(tag(busyNotes.get(job.url), {busy: true}));
    if (chips.childElementCount) role.append(chips);

    const company = el('div', 'company');
    const logo = avatar(job.company);
    const badge = el('span', 'logo', logo.initials);
    badge.style.setProperty('--hue', logo.hue);
    company.append(badge, el('span', 'name', job.company));

    const place = el('div', 'place');
    if (job.location) { const line = el('div', 'place-line'); line.append(icon('pin'), el('span', '', job.location)); place.append(line); }
    if (job.work_mode) {
      const line = el('div', 'place-line');
      const mode = workMode(job.work_mode);
      line.append(icon('globe'), pill(mode.label, MODE_TONE[mode.kind] || 'neutral', {title: job.work_mode}));
      place.append(line);
    }

    const status = el('div', 'status-cell');
    status.append(pill(statusLabel, statusTone));
    // The kit's eligibility verdict: a badge, with the reason on hover.
    if (job.ineligible) {
      const verdict = Object.assign(pill('⛔ Not eligible', 'bad'), {tabIndex: 0});
      verdict.classList.add('tip');
      verdict.dataset.tip = job.ineligible;
      status.append(verdict);
    }

    const box = el('div', 'row-actions');
    const menu = [];
    // Notion is the source of truth: if it can't be written, nothing changes and the user is told.
    const setStatus = next => async () => {
      const result = await window.pilot.setStatus(job.url, next).catch(error => ({ok: false, error: error.message}));
      if (!result.ok) { toastMessage('Status not changed', result.error || 'Something went wrong.'); return; }
      job.status = next;
      renderJobs();
    };
    // Chrome opens the job's form and the extension fills it at once from the kit.
    const fillInChrome = async button => {
      const result = await window.pilot.applyOne(job.url);
      if (result.ok) { openedInChrome.add(pageKey(job.url)); renderJobs(); } else if (button) button.textContent = 'No link';
      else toastMessage('Could not open the job', 'It has no link.');
    };
    if (job.status !== 'applied' && job.url && job.kit) {
      // Stays "Opened in Chrome" for the session (until marked applied); a click opens it again.
      const opened = openedInChrome.has(pageKey(job.url));
      if (claudeReady) {
        // Recommended: a Claude session drives Chrome from the posting through the employer's site
        // (its own Apply buttons, sign-up, every page) to a filled form; it asks you for CAPTCHAs.
        const live = sessionFor(job.url);
        if (live) {
          // A session inside the app: Continue when it waits for you, else View session.
          const open = el('button', `row-main ${live.status === 'input' ? 'state-apply' : 'state-opened'}`, live.status === 'input' ? 'Continue' : 'View session');
          open.title = live.note || 'Open this Claude session';
          open.addEventListener('click', () => openSession(live.id));
          box.append(open);
          menu.push({label: '🧩 Fill in Chrome', run: () => fillInChrome()});
        }
        const started = !live && claudeStarted.has(pageKey(job.url));
        const claude = live ? null : Object.assign(el('button', `row-main ${started ? 'state-opened' : 'state-apply'}`, started ? 'Claude is applying' : 'Apply with Claude'), {
          disabled: started,
          title: started ? 'A Claude session is filling this one in its window: answer it there' :
            'Recommended. Claude opens the posting in Chrome, follows Apply to the employer\'s site, creates an account there ' +
            'if it asks (password saved in your Keychain) and fills every page from your kit. You solve CAPTCHAs, tick the terms and submit.'});
        if (claude) claude.addEventListener('click', async () => {
          claude.disabled = true;
          const result = await window.pilot.applyWithClaude(job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode});
          if (result.ok) { claudeStarted.add(pageKey(job.url)); if (result.session) await refreshSessions(); renderJobs(); return; }
          claude.disabled = false;
          claude.title = result.error;
          // The list said there was a kit but Notion has none (removed or redrafting): show Prepare again.
          if (/kit/i.test(result.error || '')) { claude.textContent = 'Prepare first'; loadJobs(); } else claude.textContent = 'Not ready';
        });
        if (claude) box.append(claude);
        if (claude) menu.push({label: opened ? '🧩 Fill in Chrome again' : '🧩 Fill in Chrome', run: () => fillInChrome(),
          title: 'Open in Chrome: the extension fills the form from your kit; you review and submit'});
      } else {
        const fill = Object.assign(el('button', `row-main ${opened ? 'state-opened' : 'state-apply'}`, opened ? 'Opened in Chrome ↻' : 'Apply'), {
          title: opened ? 'Open it in Chrome again' : 'Open in Chrome: the extension fills the form from your kit; you review and submit'});
        fill.addEventListener('click', () => fillInChrome(fill));
        box.append(fill);
      }
    } else if (job.status !== 'applied' && job.url && job.code) {
      // No kit yet: draft it first (reads the form's questions, answers each, writes a cover letter).
      const prepare = Object.assign(el('button', 'row-main state-prepare', 'Prepare'), {
        title: 'Draft the application kit (form answers and cover letter) in your Notion; then Apply'});
      prepare.addEventListener('click', async () => {
        prepare.disabled = true;
        prepare.classList.add('busy', 'state-busy');  // spinner only; the fixed width keeps the row still
        prepare.textContent = 'Preparing';
        prepare.title = 'Drafting the kit: usually 15–30 s';
        const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
        prepare.classList.remove('busy', 'state-busy');
        // On GitHub (Always on): Recent activity follows it; the list reloads when it's done.
        if (result.cloud) { prepare.textContent = 'Preparing on GitHub…'; openActivity(true); return; }
        if (result.ok) { job.kit = true; renderJobs(); } else { prepare.disabled = false; prepare.textContent = 'Retry prepare'; }
      });
      box.append(prepare);
    }
    // Compact list: save with one click (filled once saved).
    const saved = job.status === 'saved';
    const bookmark = Object.assign(el('button', `secondary icon-btn bookmark${saved ? ' on' : ''}`), {disabled: saved,
      title: saved ? 'Saved' : 'Save: keep this job on your list'});
    bookmark.setAttribute('aria-label', bookmark.title);
    bookmark.append(icon('bookmark'));
    bookmark.addEventListener('click', () => setStatus('saved')());
    if (job.status !== 'applied') box.prepend(bookmark);

    // Long work started from the menu: a note on the row until it's done.
    const background = async (note, work) => {
      if (busyNotes.has(job.url)) return;
      busyNotes.set(job.url, note);
      renderJobs();
      try { await work(); } finally { busyNotes.delete(job.url); renderJobs(); }
    };
    if (job.notion_url) menu.push({label: job.kit ? '📝 Open kit in Notion' : '🗂 Open in Notion', run: event => window.pilot.openNotion(job.notion_url, event.metaKey),
      title: job.kit ? 'Application kit: form answers, cover letter, eligibility (in Notion)' : 'This job in your Notion'});
    menu.push({label: '↗ Open posting', run: () => window.pilot.openExternal(job.url), title: 'The job posting'});
    if (job.kit && job.code) {
      // Draft the kit again from the current Profile and standard answers (replaces it in Notion).
      const earlier = String(job.kit_state || '').startsWith('earlier');
      menu.push({label: earlier ? '↻ Redraft kit (earlier inputs)' : '↻ Redraft kit',
        title: 'Draft the kit again from your current CV, Profile and standard answers (~20 s, about 4¢); replaces it in Notion', run: () =>
        background('↻ Redrafting kit…', async () => {
          const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
          if (result.cloud) openActivity(true); else if (result.ok) loadJobs(); else toastMessage('Redraft failed', result.error || 'Try again.');
        })});
    }
    if (job.stage === 'Rejected') {
      // Claude reads the posting, what was sent, the timeline and any interview reviews: presentation, hard skills,
      // soft skills, or a different profile (nothing to improve). Written on the job's Notion page.
      menu.push({label: job.rejection ? '↻ Review the rejection again' : '🔎 Why was I rejected?',
        title: 'Claude reviews this application: presentation, hard skills, soft skills, or not on you (~20 s, a few cents)',
        run: () => background('🔎 Reviewing the rejection…', async () => {
          const result = await window.pilot.reviewRejection(job.url);
          toastMessage(result.ok ? 'Rejection reviewed' : 'Review failed', result.text);
          if (result.ok) loadJobs();
        })});
    }
    if (job.code) {
      // A CV tailored to this posting (reworded, reordered bullets from your own CV; the extension uploads it here).
      menu.push({label: job.tailored ? '↻ Re-tailor CV' : '✂️ Tailor CV',
        title: 'Make a version of your CV for this job: bullets reordered and reworded toward the posting, only from facts in your CV (about 1–2 min, ~10–15¢)',
        run: () => background('✂️ Tailoring CV…', async () => {
          const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`);
          if (result.ok) job.tailored = true; else toastMessage('Tailoring failed', result.error || 'Try again.');
        })});
    }
    // Actions read as verbs (the Status column shows where a job stands).
    menu.push('-');
    if (job.status !== 'saved') menu.push({label: 'Save', run: setStatus('saved'), title: 'Keep this job on your list'});
    if (job.status !== 'applied') menu.push({label: 'Mark applied', run: setStatus('applied'), title: 'You applied to this job: track it in Applications'});
    if (job.status !== 'dismissed') menu.push({label: 'Dismiss', run: setStatus('dismissed'), title: 'Not interested: hide this job', danger: true});
    box.append(moreButton(menu, 'More: save, dismiss, kit, posting, tailor CV'));

    row.append(fit, role, company, place, status, box);
    body.append(row);
  }
  const statLabel = {applied: 'applied', active: 'active applications', interviews: 'interviews', rejected: 'rejected', high: 'high fit', week: 'new this week', companies: 'one per company'}[statFilter];
  $('jobs-count').textContent = `${rows.length} job${rows.length === 1 ? '' : 's'}` + (statLabel ? ` · ${statLabel}` : '');
  document.querySelectorAll('[data-stat]').forEach(card => card.setAttribute('aria-pressed', String((card.dataset.stat === 'total' && !statFilter && filter === 'all') || card.dataset.stat === statFilter)));
  if (jobsLoading && !allJobs.length) { show($('jobs-empty'), false); showLoading(); return; }  // still loading, not empty
  show($('jobs-empty'), rows.length === 0);
  const emptyFor = {saved: 'No saved jobs yet. On any job, <b>⋯ → Save</b> keeps it here for later.',
    applied: 'No applications yet. Apply from a job, or add one you sent elsewhere with <b>+ Applied elsewhere…</b>',
    dismissed: 'No dismissed jobs.'};
  $('jobs-empty').innerHTML = !allJobs.length ? 'No jobs here yet. Click <b>Check for new jobs</b>; the first search takes a few minutes.'
    : anyStatus ? 'That job isn\'t in your list: not found by a search yet, or hidden by your language or company filters.'
    : !text && !statFilter && emptyFor[filter] ? emptyFor[filter]
    : text || statFilter || filter !== 'all' ? 'No job matches this filter.' : 'No open jobs right now.';
}
$('sort-by').addEventListener('change', renderJobs);
// The counters filter the list to the jobs they count, whatever their status (so the list matches the number);
// clicking the active one again, or Total matches, shows every job.
document.querySelectorAll('[data-stat]').forEach(card => card.addEventListener('click', () => {
  const kind = card.dataset.stat;
  statFilter = kind === 'total' || kind === statFilter ? null : kind;
  $('filter-status').value = 'all';
  if (kind === 'companies' && statFilter) $('sort-by').value = 'company';
  renderJobs();
}));
// Applied elsewhere: tracked in Notion like /add, then shown in the list as Applied.
$('applied-open').addEventListener('click', () => {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);  // local day
  $('applied-when').value = today;
  $('applied-when').max = today;  // no future dates
  message('applied-message', '');
  $('applied-go').disabled = false;
  $('applied-dialog').showModal();
  $('applied-url').focus();
});
// Pages Job Pilotto never reads (src/notion/ledger.py NO_FETCH): ask for the title, company and text instead.
const NO_FETCH = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;
$('applied-url').addEventListener('input', () => {
  let host = '';
  try { host = new URL($('applied-url').value.trim()).hostname; } catch {}
  $('applied-manual').hidden = !NO_FETCH.test(host);
});
$('applied-go').addEventListener('click', async event => {
  event.preventDefault();
  const url = $('applied-url').value.trim();
  if (!/^https?:\/\//.test(url)) { message('applied-message', 'Paste the job link (it starts with https://).', 'error'); return; }
  $('applied-go').disabled = true;
  message('applied-message', 'Reading the posting and adding it to Notion…', 'waiting');
  const day = $('applied-when').value;  // YYYY-MM-DD from the date picker
  if (!day) { message('applied-message', 'Pick the day you applied.', 'error'); return; }
  const manual = !$('applied-manual').hidden;
  if (manual && !$('applied-title').value.trim()) { message('applied-message', 'Add the job title (the page itself isn\'t read).', 'error'); return; }
  const details = manual ? {title: $('applied-title').value.trim(), company: $('applied-company').value.trim(), text: $('applied-text').value.trim()} : {};
  const result = await window.pilot.addApplied(url, $('applied-approx').checked ? `on or before ${day}` : day, details);
  $('applied-go').disabled = false;
  message('applied-message', result.text, result.ok ? 'ok' : 'error');
  if (!result.ok) return;
  $('applied-url').value = ''; $('applied-approx').checked = false;
  ['applied-title', 'applied-company', 'applied-text'].forEach(id => { $(id).value = ''; });
  $('applied-manual').hidden = true;
  $('filter-status').value = 'applied';  // show it where it now is
  loadJobs();
});
// A recruiter's message: Claude reads it into a recruiter lead in Notion (like /add <message> in Telegram).
let leadShot = null;  // {name, type, data (base64)} of the attached screenshot
function setLeadShot(shot) {
  leadShot = shot;
  $('lead-shot').src = `data:${shot.type};base64,${shot.data}`;
  $('lead-shot-name').textContent = shot.name;
  $('lead-shot-box').hidden = false;
}
function readShot(file) {  // a File from paste, drop or the picker
  if (!file || !/^image\//.test(file.type)) return false;
  const reader = new FileReader();
  reader.onload = () => { const url = String(reader.result); setLeadShot({name: file.name || 'screenshot.png', type: file.type, data: url.slice(url.indexOf(',') + 1)}); };
  reader.readAsDataURL(file);
  return true;
}
function clearLeadShot() { leadShot = null; $('lead-shot').removeAttribute('src'); $('lead-shot-box').hidden = true; $('lead-shot-file').value = ''; }
function leadResult(tone, title, text, pick = false) {
  $('lead-result').hidden = !title;
  $('lead-result').className = `alert tone-${tone}`;
  $('lead-result-title').textContent = title || '';
  $('lead-result-text').textContent = text || '';
  $('lead-result-pick').hidden = !pick;
}
// Link to job: found automatically (default), a new job, or one of the applications in Notion.
function leadTargets() {
  const tracked = allJobs.filter(job => job.stage && !['Dismissed', 'Closed'].includes(job.stage))
    .sort((a, b) => `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`));
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  const group = document.createElement('optgroup');
  group.label = 'Your applications';
  tracked.forEach(job => group.append(option(job.url, `${job.company || '—'} · ${job.title} (${job.stage})`)));
  $('lead-target').replaceChildren(option('', 'Find the right job automatically'), option('new', 'A new job'), ...(tracked.length ? [group] : []));
}
$('lead-open').addEventListener('click', () => {
  message('lead-message', '');
  leadResult('', '');
  $('lead-go').disabled = false;
  leadTargets();
  $('lead-dialog').showModal();
  $('lead-text').focus();
});
$('lead-shot-add').addEventListener('click', () => $('lead-shot-file').click());
$('lead-shot-file').addEventListener('change', () => readShot($('lead-shot-file').files[0]));
$('lead-shot-paste').addEventListener('click', async () => {
  const shot = await window.pilot.clipboardImage();
  if (shot) setLeadShot(shot); else leadResult('info', 'No image on the clipboard', 'Copy a screenshot first (⇧⌘4, then Ctrl-click to copy it), or use Add screenshot.');
});
$('lead-dialog').addEventListener('paste', event => {
  const file = [...(event.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
  if (file && readShot(file)) event.preventDefault();
});
$('lead-composer').addEventListener('dragover', event => { event.preventDefault(); $('lead-composer').classList.add('is-drop'); });
$('lead-composer').addEventListener('dragleave', () => $('lead-composer').classList.remove('is-drop'));
$('lead-composer').addEventListener('drop', event => {
  $('lead-composer').classList.remove('is-drop');
  const file = [...(event.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
  if (file) { event.preventDefault(); readShot(file); }
});
$('lead-shot-remove').addEventListener('click', clearLeadShot);
$('lead-result-pick').addEventListener('click', () => { $('lead-target').focus(); $('lead-target').showPicker?.(); });
$('lead-go').addEventListener('click', async event => {
  event.preventDefault();
  const text = $('lead-text').value.trim();
  leadResult('', '');
  if (!leadShot && text.length < 40) { leadResult('warn', 'Nothing to log yet', 'Paste the whole message, or add a screenshot of it.'); return; }
  $('lead-go').disabled = true;
  message('lead-message', 'Claude is reading it and updating Notion…', 'waiting');
  const result = await window.pilot.addLead(text, $('lead-talking').checked, leadShot, $('lead-target').value);
  $('lead-go').disabled = false;
  message('lead-message', '');
  const said = result.text.replace(/^\S+\s/, '');  // without the leading emoji
  if (!result.ok) {
    const notJob = /doesn't look like a message about a job/.test(said);
    const unsure = /can't tell which company and role/.test(said);
    leadResult('warn', notJob ? 'No job activity found' : unsure ? 'Which job is it?' : "Couldn't log it",
      notJob ? 'This looks like something other than a job (e.g. a services pitch), so nothing was added.' : said, notJob || unsure);
    return;
  }
  leadResult(/^ℹ️/.test(result.text) ? 'info' : 'good', /^ℹ️/.test(result.text) ? 'Nothing new' : 'Logged', said);
  if (/^ℹ️/.test(result.text)) return;
  $('lead-text').value = ''; $('lead-talking').checked = false; clearLeadShot();
  $('filter-status').value = 'all';  // it may be saved (a lead) or applied: show both
  loadJobs();
});
// List density: Comfortable (columns) or Compact (one block per job); remembered on this computer.
function setDensity(value) {
  const compact = value === 'compact';
  $('jobs-body').classList.toggle('compact', compact);
  $('jobs-head').hidden = compact;
  document.querySelectorAll('[data-density]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.density === value)));
  try { localStorage.setItem('jobsDensity', value); } catch {}
}
document.querySelectorAll('[data-density]').forEach(button => button.addEventListener('click', () => setDensity(button.dataset.density)));
try { setDensity(localStorage.getItem('jobsDensity') || 'comfortable'); } catch { setDensity('comfortable'); }
$('filter-status').addEventListener('change', renderJobs);
$('filter-text').addEventListener('input', renderJobs);

// ---------- questions to answer once ----------
// The start-up move to Notion can finish after the first read: read them again then.
window.pilot.onMoved(steps => { if (steps.includes('open questions')) loadQuestions(); });
async function loadQuestions() {
  const {list, error} = await window.pilot.openQuestions();
  // Collapsed by default (the count shows on its heading); shown whenever there's something to answer or a read failed.
  show($('questions'), list.length > 0 || !!error);
  $('questions-count').textContent = error ? 'couldn\'t load' : `${list.length} question${list.length === 1 ? '' : 's'}`;
  $('questions-error').textContent = error ? `Couldn't read your questions from Notion: ${error}` : '';
  show($('questions-error'), !!error);
  $('questions-list').replaceChildren(...list.map(q => {
    const row = Object.assign(document.createElement('div'), {className: 'question'});
    const label = Object.assign(document.createElement('label'), {textContent: q.question});
    if (q.company) label.append(Object.assign(document.createElement('small'), {textContent: ` · asked by ${q.company}`}));
    const input = Object.assign(document.createElement('input'), {type: 'text', placeholder: 'Your standard answer'});
    if (q.hint) label.append(Object.assign(document.createElement('small'), {className: 'muted', textContent: ` · ${q.hint}`}));
    const save = Object.assign(document.createElement('button'), {className: 'secondary', textContent: 'Save'});
    const skip = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Skip',
      title: q.hint !== undefined ? 'Forms leave this field empty (the table row stays, answered "— (leave blank)")' : 'Not a question to keep an answer for'});
    const note = Object.assign(document.createElement('span'), {className: 'message'});
    const answer = async value => {
      save.disabled = skip.disabled = true;
      const result = await window.pilot.answerQuestion(q.key, value);
      if (result.ok) loadQuestions(); else { note.className = 'message error'; note.textContent = result.error; save.disabled = skip.disabled = false; }
    };
    save.addEventListener('click', () => input.value.trim() && answer(input.value.trim()));
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && input.value.trim()) answer(input.value.trim()); });
    skip.addEventListener('click', () => answer(''));
    row.append(label, input, save, skip, note);
    return row;
  }));
}

// While the list loads from Notion (a few seconds): a spinner in the empty list the first time; afterwards the
// list stays and the subtitle says it's refreshing.
function showLoading() {
  if (allJobs.length) { $('jobs-stats').textContent = 'Refreshing from Notion…'; return; }
  const box = el('div', 'list-loading');
  box.append(el('span', 'spinner'), el('div', '', 'Loading your jobs from Notion…'),
    el('div', 'muted small', 'Job Matches and Applications, usually a few seconds'));
  $('jobs-body').replaceChildren(box);
  $('jobs-stats').textContent = 'Loading from Notion…';
}
async function loadJobs() {
  loadQuestions();
  showLoading();
  jobsLoading = true;
  claudeReady = (await window.pilot.claudeReady().catch(() => ({ok: false}))).ok;
  try {
    // The last good list at once (lib/view-cache.js), then the fresh one from Notion replaces it.
    if (!allJobs.length) {
      const saved = await window.pilot.cached('jobs');
      if (saved?.result?.jobs) { showJobsData(saved.result); jobsLoading = false; renderJobs(); $('jobs-stats').textContent += ` · saved ${savedAgo(saved.at)}, updating…`; jobsLoading = true; }
    }
    showJobsData(await window.pilot.jobs());
  } catch (error) {
    $('jobs-stats').textContent = `Couldn't read your jobs: ${error.message}`;
  }
  jobsLoading = false;
  renderJobs();
}
function showJobsData(data) {
  {
    allJobs = data.jobs;
    const scored = allJobs.filter(job => job.fit != null).length;
    const count = stats(allJobs, data.total);
    $('jobs-stats').textContent = `${count.total} opportunities matched to your profile` + (data.filtered ? ` · ${data.filtered} hidden` : '') +
      (data.stale ? ' · ⚠️ Notion unreachable: statuses may be out of date' : '');
    $('jobs-stats').title = `${scored} scored by the AI` + (data.filtered ? `; ${data.filtered} hidden by your language or company filters` : '');
    $('stat-total').textContent = count.total;
    $('stat-high').textContent = count.high;
    $('stat-week').textContent = count.week;
    $('stat-companies').textContent = count.companies;
    const applications = applicationStats(allJobs);
    for (const kind of Object.keys(applications)) $(`stat-${kind}`).textContent = applications[kind];
    const talking = inProcess(allJobs);
    document.querySelector('[data-stat="interviews"]').title = `Now: ${talking.screening} screening · ${talking.interviews} interviewing or offer. ` +
      'Applied counts applications sent (not forms still being filled); the Focus funnel counts every step an application ever reached.';
  }
}

window.pilot.onLog(line => {
  if (idleSeen || /^Searching job boards/.test(line)) { logLines = []; idleSeen = false; selectedRun = null; }
  logLines.push(line);
  refreshActivity();
});
$('search-status').addEventListener('click', () => openActivity(true));
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;  // the header status shows "Checking for new jobs →" meanwhile
  selectedRun = null;
  setTimeout(() => { showSearchStatus(); refreshActivity(); }, 300);
  try {
    await window.pilot.refresh();
  } finally {
    $('refresh').disabled = false;
    loadJobs();
    refreshActivity();
    showSearchStatus();
  }
});

$('apply-open').addEventListener('click', () => {
  message('apply-message', '');
  document.querySelector(`input[name="apply-mode"][value="${claudeReady ? 'agents' : 'chrome'}"]`).checked = true;
  $('apply-dialog').showModal();
});
$('apply-go').addEventListener('click', async event => {
  event.preventDefault();
  const mode = document.querySelector('input[name="apply-mode"]:checked').value;
  const n = Math.max(1, Number($('apply-n').value) || 1);
  // Feedback at once: picking the jobs reads Notion and checks each posting is still open (a few seconds).
  $('apply-go').disabled = true;
  $('apply-go').classList.add('busy');
  $('apply-go').textContent = 'Starting…';
  message('apply-message', `Finding your best ${n} job${n === 1 ? '' : 's'} with a kit and checking the postings are still open…`, 'waiting');
  try {
    const result = await window.pilot.apply({n, mode});
    if (result.ok && result.inApp) {  // the sessions show in the dock: close the dialog and let them be watched
      $('apply-dialog').close();
      toastMessage('Applying with Claude', result.message);
      await refreshSessions();
      return;
    }
    message('apply-message', result.ok ? result.message : result.error, result.ok ? 'ok' : 'error');
  } finally {
    $('apply-go').disabled = false;
    $('apply-go').classList.remove('busy');
    $('apply-go').textContent = 'Start';
  }
});

// A kit's provenance, for its tag: "Current", "Drafted with earlier inputs" (which ones changed), or "Inputs unknown".
const INPUT_NAMES = {cv: 'CV', profile: 'Profile', answers: 'standard answers'};
function kitLabel(state = '') {
  if (state === 'current') return {label: '📝 Kit', title: 'Current: drafted from your current CV, Profile and standard answers.'};
  if (state.startsWith('earlier')) {
    const changed = state.split(':')[1]?.split(',').map(name => INPUT_NAMES[name] || name).join(', ') || 'inputs';
    return {label: '📝 Kit · earlier inputs', title: `Drafted with earlier inputs: your ${changed} changed since. Redraft it from the ⋯ menu if you still want it.`};
  }
  return {label: '📝 Kit', title: 'Inputs unknown: drafted before Job Pilotto recorded which CV, Profile and answers a kit came from.'};
}

// ---------- Strategy: what you target, how matches score, what's avoided, counts, the latest insight ----------
function chips(items, tone = '') {
  const box = el('div', 'chip-list');
  box.append(...items.map(item => el('span', `chip-tag${tone ? ` tone-${tone}` : ''}`, item)));
  return box;
}
async function loadStrategy() {
  state = await window.pilot.state();
  message('strategy-message', '');
  // The last good read at once (lib/view-cache.js), then the fresh one.
  const saved = await window.pilot.cached('strategy');
  if (saved?.result?.ok && !strategyShown) {
    renderStrategy(saved.result);
    $('strategy-synced').textContent = `Saved ${savedAgo(saved.at)} · updating…`;
  } else if (!strategyShown) strategySkeleton();
  const data = await window.pilot.strategyData().catch(error => ({ok: false, error: error.message}));
  if (!data.ok) { $('strategy-view-loading')?.remove(); message('strategy-load', data.error, 'error'); return; }
  message('strategy-load', '');
  $('strategy-view-loading')?.remove();
  renderStrategy(data);
  $('strategy-synced').textContent = `Synced ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
}
let strategyShown = false;
// First load: every card in its final shape, greyed (the same rows, icons and chips), and a pill in the header.
function strategySkeleton() {
  const chipBones = n => { const box = el('div', 'chip-list'); for (let i = 0; i < n; i++) box.append(bone('chip')); return box; };
  const row = (glyph, label, value) => { const dt = el('dt'); dt.append(icon(glyph), label); const dd = el('dd'); dd.append(value); return [dt, dd]; };
  $('strategy-targets').replaceChildren(...row('briefcase', 'Roles', chipBones(3)), ...row('pin', 'Locations', chipBones(3)),
    ...row('chart', 'Compensation', bone('w-80 tall')), ...row('building', 'Company interests', chipBones(3)));
  $('strategy-scores').replaceChildren(...['settings', 'layers', 'pin', 'chart'].map(glyph => {
    const line = el('div', 'score-bar is-loading');
    line.append(icon(glyph), bone('w-name tall'), bone('w-track'), bone('w-level'));
    return line;
  }));
  $('strategy-avoid').replaceChildren(...[0, 1, 2].map(() => bone('chip wide')));
  $('strategy-glance').replaceChildren(...['file', 'layers', 'send'].map(glyph => {
    const line = el('div', 'glance-row is-loading');
    line.append(tile(glyph, 'neutral'), bone('w-count tall'), bone('w-label'), el('span', 'glance-arrow', '›'));
    return line;
  }));
  const insight = $('strategy-insight');
  insight.hidden = false;
  insight.classList.add('is-loading');
  $('strategy-insight-text').replaceChildren(bone('w-80'), bone('w-60'));
  const pill = el('span', 'loading-pill', 'Loading strategy…');
  pill.id = 'strategy-view-loading';
  $('strategy-synced').replaceChildren(pill);
}
function renderStrategy(data) {
  strategyShown = true;
  $('strategy-insight').classList.remove('is-loading');
  const row = (glyph, label, value) => {
    const dt = el('dt');
    dt.append(icon(glyph), label);
    const dd = el('dd');
    dd.append(value);
    return [dt, dd];
  };
  $('strategy-targets').replaceChildren(
    ...row('briefcase', 'Roles', chips(data.roles.slice(0, 6).map(titleCase))),
    ...row('pin', 'Locations', chips(data.locations.slice(0, 8).map(titleCase))),
    ...row('chart', 'Compensation', data.compensation || 'Not set in your Profile'),
    ...(data.stack.length ? row('layers', 'Tech stack', chips(data.stack.map(titleCase))) : []));
  const level = value => (value >= 70 ? ['High', 'good'] : value >= 50 ? ['Medium', 'warn'] : ['Low', 'bad']);
  $('strategy-score-note').textContent = !data.scored ? 'No scored matches yet: run a search with your AI key.'
    : `Average of each part of the fit score across your ${data.scored} scored matches.` +
      (data.stale ? ` Scores updating: ${data.stale} job${data.stale === 1 ? '' : 's'} wait for a new score after a Profile change (60 per search).` : '');
  show($('strategy-previous'), !!data.previous);
  if (data.previous) {
    $('strategy-previous-text').textContent = `${data.previous} score${data.previous === 1 ? ' is' : 's are'} from the previous scoring method ` +
      '(it also read your contact details and links). Kept to avoid the cost; they are re-scored when the job or your Profile changes.';
    $('strategy-rescore').textContent = `Re-score them now (≈ $${(data.previous * 0.015).toFixed(2)})`;
  }
  $('strategy-scores').replaceChildren(...data.components.map(part => {
    const [label, tone] = level(part.value);
    const line = el('div', 'score-bar');
    const track = el('span', 'score-track');
    const fill = el('span', 'score-fill');
    fill.style.width = `${part.value}%`;
    track.append(fill);
    line.append(el('span', 'score-name', part.label), track, el('span', `score-level tone-${tone}`, `${label} · ${part.value}`));
    return line;
  }));
  $('strategy-avoid').replaceChildren(...(data.avoid.length ? data.avoid : ['Nothing set']).map(item => el('span', 'chip-tag tone-bad', item)));
  const glance = (glyph, count, text, go) => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'glance-row'});
    button.append(tile(glyph, 'neutral'), el('b', '', String(count)), el('span', 'muted', text), el('span', 'glance-arrow', '›'));
    button.addEventListener('click', go);
    return button;
  };
  const jobsBy = kind => () => { openView('jobs'); if (kind) document.querySelector(`[data-stat="${kind}"]`)?.click(); };
  $('strategy-glance').replaceChildren(glance('file', data.counts.matches, 'scored matches', jobsBy('total')),
    glance('layers', data.counts.kits, 'application kits ready', jobsBy('')), glance('send', data.counts.sent, 'applications sent', jobsBy('applied')));
  show($('strategy-insight'), !!data.insight);
  if (data.insight) {
    $('strategy-insight-text').textContent = data.insight.action || data.insight.headline;
    $('strategy-insight-open').onclick = () => window.pilot.openExternal(data.insight.url);
  }
}
$('strategy-edit').addEventListener('click', event => window.pilot.openNotion(state.notion.NOTION_SEARCH_SETTINGS_PAGE || state.notion.NOTION_PROFILE_PAGE_ID, event.metaKey));
$('strategy-jobs').addEventListener('click', () => openView('jobs'));
$('strategy-rescore').addEventListener('click', async () => {
  $('strategy-rescore').disabled = true;
  const result = await window.pilot.rescorePrevious();
  $('strategy-rescore').disabled = false;
  toastMessage(result.ok ? 'Queued for re-scoring' : 'Not queued', result.ok ? `${result.queued} jobs get a new score over the next searches (60 per search).` : result.error);
  loadStrategy();
});

// ---------- Settings → Application profile: tabs (CV & details, Standard answers) ----------
function profileTab(name) {
  document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.profileTab === name));
  document.querySelectorAll('[data-profile-panel]').forEach(panel => {
    if (panel.id === 'cv-changed') return;  // shown only when the CV changed (showCvChanged)
    show(panel, panel.dataset.profilePanel === name);
  });
  if (name === 'answers') loadAnswers();
  else { loadCvSetting(); showCvChanged(); }
}
document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.addEventListener('click', () => profileTab(tab.dataset.profileTab)));
$('open-profile-details').addEventListener('click', event => window.pilot.openNotion(state.notion.NOTION_PROFILE_PAGE_ID, event.metaKey));
$('answers-review').addEventListener('click', event => window.pilot.openNotion(state.notion.NOTION_ANSWERS_PAGE_ID, event.metaKey));
// Professional links: shown as tiles; Edit shows the fields (saved with the details' Save changes).
function showLinks() {
  const value = name => document.querySelector(`[data-contact="${name}"]`).value.trim();
  $('links-view').replaceChildren(...[['linkedin', 'LinkedIn', 'user'], ['github', 'GitHub', 'bot'], ['website', 'Website', 'link']].map(([key, name, glyph]) => {
    const box = el('div', 'link-tile');
    const text = el('span');
    text.append(el('b', '', name), el('span', 'muted small', value(key).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || 'Not added'));
    box.append(tile(glyph, 'neutral'), text);
    return box;
  }));
}
$('links-edit').addEventListener('click', () => {
  const editing = $('links-form').hidden;
  show($('links-form'), editing);
  show($('links-view'), !editing);
  $('links-edit').textContent = editing ? 'Done' : 'Edit';
  if (!editing) showLinks();
});
// Standard answers: read from Notion, one expandable item per question; edits happen in Notion.
async function loadAnswers() {
  const result = await window.pilot.standardAnswers();
  if (!result.ok) { $('answers-list').replaceChildren(el('p', 'message error', result.error)); return; }
  const items = result.groups.flatMap(group => group.items.map(item => ({...item, category: group.category})));
  $('answers-count').textContent = `${items.length} standard answer${items.length === 1 ? '' : 's'}${items.some(item => item.open) ? ` · ${items.filter(item => item.open).length} need your answer` : ''}`;
  $('answers-list').replaceChildren(...items.map((item, index) => {
    const box = document.createElement('details');
    box.className = 'answer-item';
    box.open = index === 0;
    const summary = document.createElement('summary');
    const head = el('span', 'answer-head');
    head.append(el('b', '', item.question), pill(item.open ? 'Needs your answer' : item.category, item.open ? 'warn' : 'info'));
    const edit = el('button', 'link', 'Edit in Notion');
    edit.addEventListener('click', event => { event.preventDefault(); window.pilot.openNotion(state.notion.NOTION_ANSWERS_PAGE_ID, event.metaKey); });
    summary.append(head, el('span', 'muted answer-preview', item.answer.split('\n')[0]), edit);
    box.append(summary, el('p', 'answer-text', item.answer || '—'));
    return box;
  }));
}
$('open-profile').addEventListener('click', event => window.pilot.openNotion(state.notion.NOTION_PROFILE_PAGE_ID, event.metaKey));
$('open-answers').addEventListener('click', event => window.pilot.openNotion(state.notion.NOTION_ANSWERS_PAGE_ID, event.metaKey));

// Sidebar: the Notion pages, most used first. Click opens them in the app's Notion window; ⌘-click in the browser.
const NOTION_LINKS = [['NOTION_MATCHES_DB', 'Job matches', 'target'], ['NOTION_APPLICATIONS_DB', 'Applications', 'layers'],
  ['NOTION_EVENTS_DB', 'Replies & events', 'mail'], ['NOTION_INTERVIEWS_DB', 'Interviews', 'mic'], ['NOTION_INSIGHTS_DB', 'Insights', 'chart'],
  ['NOTION_PIPELINE_PAGE', 'Pipeline', 'columns'], ['NOTION_PROFILE_PAGE_ID', 'Profile', 'user'], ['NOTION_ANSWERS_PAGE_ID', 'Standard answers', 'file'],
  ['NOTION_SEARCH_SETTINGS_PAGE', 'Search settings', 'settings'], ['NOTION_KNOWLEDGE_PAGE', 'Form knowledge', 'bookmark'],
  ['NOTION_EMPLOYERS_DB', 'Employers', 'building'], ['NOTION_CRON_RUNS_DB', 'Search runs', 'search'], ['NOTION_AGENT_RUNS_DB', 'Form fills', 'bot']];
function renderNotionLinks() {
  const box = $('notion-links');
  box.querySelectorAll('.notion-link').forEach(link => link.remove());
  const links = NOTION_LINKS.filter(([env]) => state.notion?.[env]);
  show(box, links.length > 0);
  for (const [env, label, glyph] of links) {
    const link = Object.assign(document.createElement('button'), {className: 'notion-link', textContent: label,
      title: osText(`${state.notionTitles?.[env] || label}: opens in Notion (⌘-click: in a Job Pilotto window)`)});
    link.prepend(icon(glyph));
    link.addEventListener('click', event => window.pilot.openNotion(state.notion[env], event.metaKey || event.ctrlKey));
    box.append(link);
  }
}
renderNotionLinks();
$('strategy-redo').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('goals'); });

async function loadCvSetting() {
  const status = await window.pilot.cvStatus();
  // One glance: ready (and which design), or not read yet. ✂️ Tailor CV on a job uses it.
  $('cv-state').textContent = status.base ? `· ✅ ready · ${status.custom ? '🎨 your design' : 'default design'}` : '· ⚪ read on your first ✂️ Tailor CV';
  $('cv-view').hidden = !status.base;
  $('cv-import').textContent = status.base ? '🔄 Read my CV PDF again' : '🔄 Read my CV PDF';
}
$('cv-view').addEventListener('click', async () => {
  const result = await window.pilot.viewBaseCv();
  $('cv-message').textContent = !result.ok ? result.error : result.overflow?.length ? `Page ${result.overflow.join(', ')} is too full: its end is cut off.` : '';
});
$('cv-import').addEventListener('click', async () => {
  if ((await window.pilot.cvStatus()).base && !confirm('Replace your CV data (and any hand edits) with a fresh read of your CV PDF?')) return;
  const button = $('cv-import');
  button.disabled = true;
  button.classList.add('busy');
  $('cv-message').textContent = 'Reading your CV… (about 30 s)';
  const result = await window.pilot.importCv();
  button.disabled = false;
  button.classList.remove('busy');
  $('cv-message').textContent = result.ok ? `Done ($${result.usd.toFixed(2)}).` : result.error;
  loadCvSetting();
});
$('cv-folder').addEventListener('click', () => window.pilot.showCvFolder());

async function loadSettings() {
  state = await window.pilot.state();
  const hints = await window.pilot.secretHints();
  for (const [id, name, empty] of [['set-anthropic', 'ANTHROPIC_API_KEY', 'sk-ant-…'], ['set-notion', 'NOTION_TOKEN', 'ntn_…'],
    ['set-telegram', 'TELEGRAM_BOT_TOKEN', '123456789:AA…'], ['set-serpapi', 'SERPAPI_API_KEY', 'SerpApi key']]) {
    if ($(id)) $(id).placeholder = hints[name] ? `${hints[name]} · saved (paste a new one to replace it)` : empty;
  }
  renderNotionLinks();
  showCloud();
  showSchedule();
  showContact();
  $('share-reports').checked = !!state.settings.shareFillReports;
  $('claude-consent').checked = !!state.settings.claudeConsent;
  document.querySelectorAll('[data-secret]').forEach(line => {
    const set = state.secrets[line.dataset.secret];
    line.textContent = set ? '✓ Connected' : 'Not set';
    line.classList.toggle('on', set);
  });
  showGoogle();
  const ext = await window.pilot.extensionInfo();
  showExtensionStatus();
  $('ext-url').textContent = ext.url;
  $('ext-token').textContent = ext.token;
  $('data-folder').textContent = state.folder;
  $('auto-search').checked = state.settings.autoSearch !== false;
  $('open-login').checked = !!state.settings.openAtLogin;
  $('last-search').textContent = state.settings.lastSearchAt
    ? `${new Date(state.settings.lastSearchAt).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'})}${state.settings.lastSearchOk === false ? ' (with problems)' : ''}`
    : 'No search yet';
  if (state.settings.telegramBot && state.secrets.TELEGRAM_BOT_TOKEN) {
    const line = document.querySelector('[data-secret="TELEGRAM_BOT_TOKEN"]');
    line.textContent = `✓ Connected to @${state.settings.telegramBot}`;
  }
  renderOverview().catch(() => {});
}
$('set-telegram-save').addEventListener('click', async () => {
  const value = $('set-telegram').value.trim();
  if (!/^\d+:[\w-]{30,}$/.test(value)) { message('telegram-message', 'That doesn\'t look like a bot token (numbers, a colon, then letters).', 'error'); return; }
  $('set-telegram-save').disabled = true;
  message('telegram-message', 'Checking the token…');
  const result = await window.pilot.telegramConnect(value);
  $('set-telegram-save').disabled = false;
  if (!result.ok) { message('telegram-message', result.error, 'error'); return; }
  $('set-telegram').value = '';
  message('telegram-message', `Connected to @${result.username} ✓ Matches arrive there after each search.`, 'ok');
  loadSettings();
});
// ---------- your details for application forms (the extension asks the app for them) ----------
function showContact() {
  window.pilot.contact().then(contact => {
    document.querySelectorAll('[data-contact]').forEach(input => { input.value = contact[input.dataset.contact] || ''; });
    showLinks();
  }).catch(error => message('contact-message', `Couldn't read them from Notion: ${error.message}`, 'error'));
  $('contact-cv').textContent = state.settings.cvName || 'None yet';
}
$('contact-save').addEventListener('click', async () => {
  const field = name => document.querySelector(`[data-contact="${name}"]`);
  // Full name isn't shown: forms that ask for it get first + last.
  const first = field('first_name').value.trim(), last = field('last_name').value.trim();
  if (first && last) field('full_name').value = `${first} ${last}`;
  const contact = Object.fromEntries([...document.querySelectorAll('[data-contact]')]
    .map(input => [input.dataset.contact, input.value.trim()]).filter(([, value]) => value));
  $('contact-save').disabled = true;
  const result = await window.pilot.saveContact(contact);
  if (!result.ok) $('contact-save').disabled = false;
  message('contact-message', result.ok ? (state.notion ? 'Saved in your Notion Profile ✓ The extension uses these from the next form it fills.'
    : 'Saved ✓ The extension uses these from the next form it fills.') : result.error, result.ok ? 'ok' : 'error');
});

// ---------- Apply with Claude: what only the user can install (wizard, Optional extras) ----------
async function showClaudePrereqs() {
  const found = await window.pilot.claudePrereqs().catch(() => null);
  if (!found) return;
  const link = (href, text) => Object.assign(document.createElement('a'), {href, target: '_blank', textContent: text});
  const items = [
    [found.claude, 'Claude Code installed', link('https://claude.com/claude-code', 'Install Claude Code')],
    [found.signedIn, 'Signed in to Claude Code with your Claude account', document.createTextNode(
      found.windows ? 'Open PowerShell, run claude, then /login' : 'Open Terminal, run claude, then /login')],
    ...(found.windows ? [[found.git, 'Git for Windows installed (Claude Code needs it)', link('https://git-scm.com/downloads/win', 'Install Git for Windows')]] : []),
    [null, 'Claude in Chrome extension added and signed in', link('https://chromewebstore.google.com/search/Claude', 'Get it from the Chrome Web Store')],
    // Built into the app (nothing to install): sessions run inside Job Pilotto; without it, in Terminal windows.
    [found.inApp, found.inApp ? 'In-app terminal ready (built in): sessions run inside Job Pilotto' : 'In-app terminal unavailable',
      document.createTextNode('sessions open in Terminal windows instead')],
  ];
  $('claude-prereqs').replaceChildren(...items.map(([done, text, action]) => {
    const li = document.createElement('li');
    li.className = done ? 'done' : '';
    li.append(`${done ? '✓' : done === false ? '○' : '•'} ${text}`);
    if (!done) li.append(' · ', action);
    return li;
  }));
}
$('claude-prereqs-check').addEventListener('click', showClaudePrereqs);
showClaudePrereqs();

// ---------- Chrome extension: connected? (it checks in every 30 s) ----------
async function showExtensionStatus() {
  const seen = await window.pilot.extensionSeen();
  const on = seen && Date.now() - seen.at < 90 * 1000;
  $('ext-status').textContent = on ? `✓ Installed and connected${seen.version ? ` (version ${seen.version})` : ''}.`
    : 'Not connected: install it below, or open Chrome if it\'s installed (it checks in within 30 seconds).';
  $('ext-status').className = `status-line ${on ? 'on' : ''}`;
  $('ext-setup').open = !on;
}
setInterval(() => {
  if (document.querySelector('.view[data-view="settings"]').hidden) return;
  showExtensionStatus();
  if (!document.querySelector('[data-settings-page="overview"]').hidden) renderOverview().catch(() => {});
}, 10000);

// ---------- how often each job runs ----------
const SCHEDULE_DEFAULTS = {search: 4, kits: 0, insights: 'daily', scout: 'daily', mail: 3};
function showSchedule() {
  const schedule = {...SCHEDULE_DEFAULTS, ...(state.settings.schedule || {})};
  document.querySelectorAll('[data-schedule]').forEach(select => { select.value = String(schedule[select.dataset.schedule]); });
}
// Automation: the schedules, the daily target and reminders are saved together with Save changes (enabled once
// something changed); with Always on, the GitHub repo is updated to the new schedule too.
const automationChanged = () => { $('automation-save').disabled = false; message('schedule-message', ''); };
document.querySelectorAll('[data-schedule]').forEach(select => select.addEventListener('change', automationChanged));
$('automation-save').addEventListener('click', async () => {
  $('automation-save').disabled = true;
  const schedule = {...SCHEDULE_DEFAULTS, ...(state.settings.schedule || {})};
  document.querySelectorAll('[data-schedule]').forEach(select => {
    schedule[select.dataset.schedule] = /^\d+$/.test(select.value) ? Number(select.value) : select.value;
  });
  await window.pilot.saveSettings({schedule, focusReminders: $('set-remind').checked});
  $('focus-remind').checked = $('set-remind').checked;
  if (!(await saveDailyTarget($('set-target')))) { $('automation-save').disabled = false; return; }
  state = await window.pilot.state();
  if (!state.settings.cloud?.repo) { message('schedule-message', 'Saved ✓', 'ok'); return; }
  message('schedule-message', `Updating ${state.settings.cloud.repo}…`);
  const result = await window.pilot.cloudConnect();
  message('schedule-message', result.ok ? `Saved ✓ ${result.repo} follows the new schedule.` : result.error, result.ok ? 'ok' : 'error');
  if (!result.ok) $('automation-save').disabled = false;
});

// ---------- Always on: runs in the user's private GitHub repo, even with the Mac off ----------
function showCloud() {
  const cloud = state.settings.cloud;
  showRunMode();
  $('cloud-status').textContent = cloud?.repo
    ? osText(`✓ On: running from ${cloud.repo} on the schedule above, even with the Mac off.`) : 'Off: jobs run on this Mac while the app is open.';
  $('cloud-connect').textContent = cloud?.repo ? 'Update' : 'Turn on';
  $('cloud-open').hidden = $('cloud-off').hidden = !cloud?.repo;
  $('auto-search').disabled = !!cloud?.repo;
  showTelegramCloud();
}

// Telegram buttons, always on (the user's own Cloudflare Worker; lib/telegram-cloud.js).
function showTelegramCloud() {
  const on = state.settings.telegramCloud;
  show($('tg-cloud'), !!state.settings.cloud?.repo);
  $('tg-cloud-status').textContent = on ? osText(`✓ On: your bot answers from Cloudflare, even with the Mac off (${on.url.replace('https://', '')}).`)
    : 'Off: your bot answers buttons and commands only while this app is open.';
  show($('tg-cloud-howto'), !on);
  show($('tg-cloud-token'), !on);
  $('tg-cloud-on').textContent = on ? 'Update' : 'Turn on';
  show($('tg-cloud-off'), !!on);
}
$('tg-cloud-on').addEventListener('click', async () => {
  $('tg-cloud-on').disabled = true;
  message('tg-cloud-message', 'Setting up your bot helper on Cloudflare…');
  const result = await window.pilot.telegramCloudOn($('tg-cloud-token').value);
  $('tg-cloud-on').disabled = false;
  if (result.ok) { $('tg-cloud-token').value = ''; state = await window.pilot.state(); showTelegramCloud(); }
  message('tg-cloud-message', result.ok ? 'Done ✓ Try a button in Telegram.' : result.error, result.ok ? 'ok' : 'error');
});
$('tg-cloud-off').addEventListener('click', async () => {
  await window.pilot.telegramCloudOff();
  state = await window.pilot.state(); showTelegramCloud();
  message('tg-cloud-message', 'Off: the app answers your bot again while it\'s open.', 'ok');
});
$('cloud-connect').addEventListener('click', async () => {
  if (!state.secrets.ANTHROPIC_API_KEY || !state.secrets.NOTION_TOKEN) {
    message('cloud-message', 'Add your AI key and connect Notion first: the searches in GitHub use them.', 'error'); return;
  }
  $('cloud-connect').disabled = true;
  if (!cloudWaiting) message('cloud-message', 'Opening GitHub sign-in…');
  const result = await window.pilot.cloudConnect();
  $('cloud-connect').disabled = false;
  if (result.needsRepo) {
    // Signed in, not installed yet: open GitHub's install page (its repository picker) and wait for the install.
    cloudUrls = result;
    show($('cloud-steps'));
    if (!cloudWaiting) { window.pilot.openExternal(result.installUrl); cloudSince = Date.now(); }
    message('cloud-message', 'Signed in to GitHub ✓ Now pick the repository on GitHub. Waiting for the install…', 'waiting');
    cloudWaiting = true;
    if (Date.now() - cloudSince < 10 * 60 * 1000) setTimeout(() => $('cloud-connect').click(), 5000);
    else { cloudWaiting = false; message('cloud-message', 'Still not installed. Install Job Pilotto on a repository on GitHub, then press Turn on again.', 'error'); }
    return;
  }
  cloudWaiting = false;
  if (result.needsChoice) {
    show($('cloud-steps'), false);
    $('cloud-repo').replaceChildren(...result.repos.map(name => Object.assign(document.createElement('option'), {value: name, textContent: name})));
    show($('cloud-choose'));
    message('cloud-message', 'Job Pilotto is installed on several repositories: choose the one to use.', '');
    return;
  }
  if (!result.ok) { message('cloud-message', result.error, 'error'); return; }
  show($('cloud-steps'), false);
  state = await window.pilot.state();
  showCloud();
  message('cloud-message', `Connected to ${result.repo} ✓ ` +
    `${result.secrets.length} keys stored as encrypted secrets. The first run follows your schedule; press Search now to start one right away.`, 'ok');
});
window.pilot.onCloudStep(step => {
  if (step.code) {
    // The sign-in code, big and bold, with Copy: it's what the user has to find and type on github.com.
    const box = $('cloud-message');
    box.className = 'message';
    const code = Object.assign(document.createElement('b'), {className: 'device-code', textContent: step.code});
    const copy = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Copy'});
    copy.addEventListener('click', () => { navigator.clipboard.writeText(step.code); copy.textContent = 'Copied ✓'; });
    box.replaceChildren('In the browser tab that opened, enter this code and approve Job Pilotto:', document.createElement('br'),
      code, ' ', copy, document.createElement('br'), Object.assign(document.createElement('span'), {className: 'muted small', textContent: step.url}));
  }
  else message('cloud-message', step.text);
});
let cloudUrls = null;
let cloudWaiting = false;
let cloudSince = 0;
$('cloud-use').addEventListener('click', async () => {
  $('cloud-use').disabled = true;
  const result = await window.pilot.cloudConnect($('cloud-repo').value);
  $('cloud-use').disabled = false;
  if (!result.ok) { message('cloud-message', result.error, 'error'); return; }
  show($('cloud-choose'), false);
  state = await window.pilot.state();
  showCloud();
  message('cloud-message', `Connected to ${result.repo} ✓ ${result.secrets.length} keys stored as encrypted secrets.`, 'ok');
});
$('cloud-create').addEventListener('click', () => window.pilot.openExternal(cloudUrls.createUrl));
$('cloud-install').addEventListener('click', () => window.pilot.openExternal(cloudUrls.installUrl));
$('cloud-open').addEventListener('click', () => window.pilot.openExternal(`https://github.com/${state.settings.cloud.repo}`));
$('cloud-off').addEventListener('click', async () => {
  await window.pilot.cloudOff();
  state = await window.pilot.state();
  showCloud();
  message('cloud-message', 'Off. The app searches while it is open. Your GitHub repository is still there: delete it on GitHub, or turn this on again later.');
});
window.pilot.onTelegramWaiting(username => {
  message('telegram-message', `Now open t.me/${username} in Telegram and press Start (waiting up to 2 minutes)…`);
  window.pilot.openExternal(`https://t.me/${username}`);
});
$('auto-search').addEventListener('change', () => window.pilot.setAutomation({autoSearch: $('auto-search').checked}));
$('open-login').addEventListener('change', () => window.pilot.setAutomation({openAtLogin: $('open-login').checked}));

async function showGoogle() {
  const google = await window.pilot.googleStatus().catch(() => ({connected: false}));
  $('google-status').textContent = google.connected ? `✓ Connected as ${google.email}` : google.error ? 'Sign-in expired: connect again' : 'Not connected';
  $('google-status').classList.toggle('on', !!google.connected);
  $('google-connect').textContent = google.connected ? 'Reconnect' : 'Connect Google';
}
$('google-connect').addEventListener('click', async () => {
  $('google-connect').disabled = true;
  message('google-message', 'Finish the sign-in in your browser (Google may call the app unverified: Advanced → Go to Job Pilotto).');
  const result = await window.pilot.googleConnect();
  $('google-connect').disabled = false;
  message('google-message', result.ok ? 'Connected ✓' : result.error, result.ok ? 'ok' : 'error');
  showGoogle();
});
$('set-notion-oauth').addEventListener('click', async () => {
  $('set-notion-oauth').disabled = true;
  message('set-notion-message', 'Waiting for Notion: approve in your browser, then come back here…', 'waiting');
  const result = await window.pilot.notionOAuth();
  $('set-notion-oauth').disabled = false;
  message('set-notion-message', result.ok ? 'Reconnected ✓' : result.error || 'Not connected.', result.ok ? 'ok' : 'error');
  if (result.ok) { state = await window.pilot.state(); loadSettings(); }
});
$('set-notion-save').addEventListener('click', async () => {
  const value = $('set-notion').value.trim();
  if (!value) return;
  const result = await window.pilot.notionConnect(value);
  if (!result.ok) { alertLine('NOTION_TOKEN', result.error || `Not found: ${(result.missing || []).join(', ') || 'columns missing'}`); return; }
  $('set-notion').value = '';
  loadSettings();
});
for (const [id, name, check] of [['anthropic', 'ANTHROPIC_API_KEY', true], ['serpapi', 'SERPAPI_API_KEY', false]]) {
  $(`set-${id}-save`).addEventListener('click', async () => {
    const value = $(`set-${id}`).value.trim();
    if (!value) return;
    const checked = check ? await window.pilot.checkAnthropic(value) : {ok: true};
    if (!checked.ok) { alertLine(name, checked.error || 'That key was rejected'); return; }
    try {
      await window.pilot.saveSecret(name, value);
    } catch (error) {
      alertLine(name, error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      return;
    }
    $(`set-${id}`).value = '';
    loadSettings();
  });
}
function alertLine(name, text) { const line = document.querySelector(`[data-secret="${name}"]`); line.textContent = text; line.classList.remove('on'); }
$('open-extension-folder').addEventListener('click', () => window.pilot.showFolder('extension'));
$('open-data').addEventListener('click', () => window.pilot.showFolder('data'));
$('rerun-wizard').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('welcome'); });

// ---------- actions (every Telegram command) ----------
function answer(text) { const box = $('command-answer'); show(box); box.textContent = text; box.scrollIntoView({behavior: 'smooth'}); }
// Lists the app already shows: the Jobs list with that filter (the Telegram bot sends them as messages).
const COMMAND_FILTER = {saved: 'saved', applied: 'applied'};
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', async () => {
  const command = button.dataset.command;
  if (COMMAND_FILTER[command]) {
    openView('jobs');
    $('filter-status').value = COMMAND_FILTER[command];
    $('filter-status').dispatchEvent(new Event('change'));
    return;
  }
  // Only a task that runs in the background opens Recent activity (its row and log); an instant answer
  // (Status, Help) shows right here, not behind the panel.
  const task = !!COMMAND_KIND[command];
  if (task) {
    // On the Actions page its banner and Recent runs follow it; from elsewhere (⌘K), Recent activity opens.
    if (document.querySelector('.view[data-view="actions"]').hidden) openActivity(true);
    awaitedRun = {kind: COMMAND_KIND[command], since: Date.now() - 2000};
    refreshActivity();
  }
  if (command === 'status') { showStatusCard(); return; }
  button.disabled = true;
  const result = await window.pilot.command(command);
  button.disabled = false;
  if (task) { refreshActivity(); show($('command-answer'), false); return; }  // its row, then its result, show in Recent activity
  answer(result.text + (result.telegram ? '\n\n(Also sent to Telegram.)' : ''));
}));
// Replace CV: the new file is used for uploads at once; the review of what it changes in the Profile (and so in
// the fit scores) is offered, never applied by itself.
$('replace-cv').addEventListener('click', async () => {
  const name = await window.pilot.chooseCv();
  if (!name) return;
  state = await window.pilot.state();
  $('contact-cv').textContent = name;
  message('strategy-message', `CV replaced: ${name}. New applications use it now. Review what it changes in your strategy when you're ready.`, 'ok');
  showCvChanged();
});
$('strategy-cv-review').addEventListener('click', openCvChange);

// ---------- a replaced CV: what follows it (suggested Profile edits, tailoring base, unsent kits), never a rebuild ----------
let cvSuggestions = [];
async function showCvChanged() {
  const change = await window.pilot.cvChange();
  $('cv-changed-text').textContent = `Your CV changed${change.at ? ` on ${new Date(change.at).toLocaleDateString()}` : ''}: review what it changes.`;
  show($('cv-changed'), !!change.at);
  show($('strategy-cv-changed'), !!change.at);
}
async function openCvChange() {
  const change = await window.pilot.cvChange();
  // What applying Profile edits costs: every scored job is re-scored over the next searches.
  $('cv-impact').textContent = '';
  window.pilot.strategyData().then(data => {
    if (!data?.ok || !data.scored) return;
    const searches = Math.max(1, Math.ceil(data.scored / 60));
    $('cv-impact').textContent = `Applying Profile edits re-scores ${data.scored} jobs over the next ${searches} search${searches === 1 ? '' : 'es'} ` +
      `(≈ $${(data.scored * 0.015).toFixed(2)})${data.counts?.kits ? `; ${data.counts.kits} unsent kits were drafted with the old Profile` : ''}.`;
  }).catch(() => {});
  $('cv-dialog-name').textContent = `${change.previous ? `${change.previous} → ` : ''}${change.name || 'your CV'}`;
  $('cv-suggestions').replaceChildren();
  show($('cv-apply-row'), false);
  message('cv-review-message', '');
  $('cv-compare').disabled = !change.comparable;
  if (!change.comparable) $('cv-profile-text').textContent = 'The previous CV is not on this computer, so there is nothing to compare. Edit the Profile in Notion if needed.';
  $('cv-base-text').textContent = change.base ? 'made from the previous CV. Read the new one so tailored CVs start from it.' : 'read from this CV on your first ✂️ Tailor CV. Nothing to do.';
  show($('cv-base-actions'), change.base);
  const kits = allJobs.filter(job => job.kit && job.code && job.status !== 'applied' && job.status !== 'dismissed');
  $('cv-kits').replaceChildren(...kits.map(job => {
    const row = el('div', 'cv-kit');
    const redraft = el('button', 'ghost', '↻ Redraft');
    redraft.addEventListener('click', async () => {
      redraft.disabled = true;
      redraft.textContent = 'Redrafting…';
      const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
      redraft.textContent = result.ok ? '✓ Redrafted' : 'Retry';
      redraft.disabled = !!result.ok;
    });
    row.append(el('span', '', `${job.title} · ${job.company}`), redraft);
    return row;
  }));
  show($('cv-kits-row'), kits.length > 0);
  if (!$('cv-dialog').open) $('cv-dialog').showModal();
}
$('cv-changed-open').addEventListener('click', openCvChange);
$('cv-compare').addEventListener('click', async () => {
  const button = $('cv-compare');
  button.disabled = true;
  button.classList.add('busy');
  message('cv-review-message', 'Claude is comparing your CVs with your Profile… (about 30 s)', 'waiting');
  const result = await window.pilot.cvReview();
  button.disabled = false;
  button.classList.remove('busy');
  if (!result.ok) return message('cv-review-message', result.error, 'error');
  cvSuggestions = result.suggestions;
  message('cv-review-message', `${result.summary} ($${result.usd.toFixed(2)})${cvSuggestions.length ? '' : ' Nothing in your Profile needs to change.'}`, 'ok');
  const label = {update: ['Update', 'info'], add: ['Add', 'good'], remove: ['Remove', 'bad']};
  $('cv-suggestions').replaceChildren(...cvSuggestions.map(s => {
    const row = el('label', 'radio cv-suggestion');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = s.kind !== 'remove';  // removals are opt-in
    box.dataset.id = s.id;
    const body = el('span');
    body.append(pill(label[s.kind][0], label[s.kind][1]), ' ');
    if (s.kind !== 'add') body.append(el('s', 'muted', s.block.text), s.kind === 'update' ? ' → ' : '');
    if (s.kind !== 'remove') body.append(el('b', '', s.text));
    if (s.kind === 'add') body.append(el('span', 'muted', ` (after “${s.block.text.slice(0, 60)}”)`));
    body.append(el('div', 'muted small', s.why));
    row.append(box, body);
    return row;
  }));
  show($('cv-apply-row'), cvSuggestions.length > 0);
});
$('cv-apply').addEventListener('click', async () => {
  const picked = new Set([...$('cv-suggestions').querySelectorAll('input:checked')].map(box => Number(box.dataset.id)));
  const accepted = cvSuggestions.filter(s => picked.has(s.id));
  if (!accepted.length) return message('cv-review-message', 'Nothing selected.', 'waiting');
  $('cv-apply').disabled = true;
  const result = await window.pilot.cvApply(accepted);
  $('cv-apply').disabled = false;
  if (!result.ok) return message('cv-review-message', result.error, 'error');
  message('cv-review-message', result.failed.length ? `${result.applied} applied; not applied: ${result.failed.join('; ')}`
    : `✓ ${result.applied} change${result.applied === 1 ? '' : 's'} saved to your Profile in Notion.`, result.failed.length ? 'error' : 'ok');
  if (!result.failed.length) { $('cv-suggestions').replaceChildren(); show($('cv-apply-row'), false); }
});
$('cv-base-read').addEventListener('click', async () => {
  const button = $('cv-base-read');
  button.disabled = true;
  button.textContent = 'Reading your CV… (about 30 s)';
  const result = await window.pilot.importCv();
  button.textContent = result.ok ? `✓ Done ($${result.usd.toFixed(2)})` : 'Retry';
  button.disabled = !!result.ok;
  loadCvSetting();
});
$('cv-later').addEventListener('click', () => { $('cv-dialog').close(); showCvChanged(); });
$('cv-done').addEventListener('click', async () => { await window.pilot.cvChangeDone(); $('cv-dialog').close(); showCvChanged(); });

// ---------- your data: export / import ----------
window.pilot.onExportProgress(({pages, rows}) => message('data-message', `Copying your Notion data… ${pages} pages, ${rows} rows so far`, 'waiting'));
$('export-data').addEventListener('click', async () => {
  $('export-data').disabled = true;
  const result = await window.pilot.exportProfile({keys: $('export-keys').checked, notion: $('export-notion').checked});
  $('export-data').disabled = false;
  if (result.ok) message('data-message', `Exported ✓ ${result.file}${result.notion ? ` (with Notion: ${result.notion.pages} pages, ${result.notion.rows} rows)` : ''}`, 'ok');
  else if (result.error) message('data-message', `Export failed: ${result.error}`, 'error');
});
$('import-data').addEventListener('click', async () => {
  const result = await window.pilot.importProfile();
  if (result?.error) message('data-message', `Import failed: ${result.error}`, 'error');
});

// ---------- automatic backup of this computer's data (lib/backup.js) ----------
async function showBackup() {
  const status = await window.pilot.backupStatus();
  const where = status.folder.includes('CloudDocs') ? 'iCloud Drive → Job Pilotto Backups' : 'Documents → Job Pilotto Backups';
  $('backup-last').textContent = status.at ? new Date(status.at).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : 'None yet';
  $('backup-where').textContent = where.replace(' → ', ' / ');
}
showBackup();
$('backup-now').addEventListener('click', async () => {
  $('backup-now').disabled = true;
  const result = await window.pilot.backupNow();
  $('backup-now').disabled = false;
  message('data-message', result.ok ? `Backed up ✓ ${result.file}` : `Backup failed: ${result.error}`, result.ok ? 'ok' : 'error');
  showBackup();
});
$('backup-show').addEventListener('click', () => window.pilot.showBackups());

// ---------- danger zone: reset this computer's Job Pilotto data ----------
$('reset-confirm').addEventListener('input', () => { $('reset-go').disabled = $('reset-confirm').value.trim() !== 'RESET'; });
$('reset-go').addEventListener('click', async () => {
  if ($('reset-confirm').value.trim() !== 'RESET') return;
  const result = await window.pilot.resetProfile({backup: $('reset-backup').checked, freshNotion: $('reset-notion').checked});
  if (result?.error) message('reset-message', result.error, 'error');
  else if (!result?.ok) message('reset-message', 'Not reset.', 'waiting');
});
$('reset-notion-day').textContent = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}).replace('Sept', 'Sep');
window.pilot.lastReset().then(done => {
  if (done?.imported) toastMessage('Data imported ✓', `Your previous data is in ${done.backup}.`);
  else if (done?.backup) toastMessage('Job Pilotto was reset', `Your previous data is in ${done.backup}.`);
  else if (done?.deleted) toastMessage('Job Pilotto was reset', 'Your previous data on this computer was deleted.');
  if (done?.archived) toastMessage('Old Notion workspace archived', `"${done.archived.title}" is kept in Notion. The setup builds a new workspace: share a new, empty page with Job Pilotto.`);
});

// ---------- start ----------
// Notion is required (it's where Job Pilotto keeps your data): set up without it -> the Notion step first.
if (state.settings.setupDone && state.notion) {
  show($('app'));
  loadJobs();
  // After a reload (⌘R), the page and Settings section it was on, once all the code below has loaded (every page's
  // state is declared by then); else Focus.
  const view = remembered('view'), section = remembered('settingsPage');
  if (view && view !== 'focus' && document.querySelector(`.view[data-view="${view}"]`)) {
    setTimeout(() => {
      openView(view);
      if (view === 'settings' && section && document.querySelector(`[data-settings-page="${section}"]`)) settingsPage(section);
    }, 0);
  } else openView('focus');
} else {
  show($('wizard'));
  const resume = state.settings.setupDone ? 'notion' : state.settings.wizardStep || 'welcome';
  if (resume === 'draft') toDraft(); else goStep(resume);
}

// In-window notifications (when macOS blocks system ones).
window.pilot.onToast(toastMessage);
function toastMessage(title, body, hint) {
  if (typeof title === 'object') ({title, body, hint} = title);
  const toast = Object.assign(document.createElement('div'), {className: 'toast'});
  toast.append(Object.assign(document.createElement('b'), {textContent: title}), Object.assign(document.createElement('span'), {textContent: body}));
  if (hint) toast.append(Object.assign(document.createElement('small'), {textContent:
    window.pilot.platform === 'win32' ? 'Windows notifications are off for this app: Settings → System → Notifications → Job Pilotto → On.'
      : 'macOS notifications are off for this app: System Settings → Notifications → Electron (or Job Pilotto) → Allow notifications.'}));
  toast.addEventListener('click', () => toast.remove());
  $('toasts').append(toast);
  setTimeout(() => toast.remove(), hint ? 20000 : 8000);
  return toast;
}

// Help improve Job Pilotto (opt-in anonymous form reports).
$('share-reports').addEventListener('change', async () => { state.settings = await window.pilot.saveSettings({shareFillReports: $('share-reports').checked}); });
$('claude-consent').addEventListener('change', async () => {
  state.settings = await window.pilot.saveSettings({claudeConsent: $('claude-consent').checked ? new Date().toISOString() : null});
});

// ---------- interviews: drafts on this Mac, saved ones in Notion 🎤 Interviews ----------
const iv = window.pilot.interviews;
let ivOpen = null;          // the draft in the editor
let ivSavedRows = [];
const plainId = id => String(id || '').replace(/-/g, '');
const linkable = () => allJobs.filter(job => job.notion_url);   // jobs with a Notion Applications row
const jobName = job => `${job.company} — ${job.title}${job.status === 'applied' ? ' (applied)' : ''}`;
const jobForPage = pageId => allJobs.find(job => job.notion_url && plainId(job.notion_url).includes(plainId(pageId)));

// Every job in the list (applied and tracked ones first); one not in Applications yet is added there on save.
const PASTE = '__paste__';
function jobOptions(select, chosenUrl, emptyLabel) {
  const rank = job => (job.status === 'applied' ? 0 : job.notion_url ? 1 : 2);
  const jobs = allJobs.filter(job => job.url && job.status !== 'dismissed')
    .sort((a, b) => rank(a) - rank(b) || a.company.localeCompare(b.company));
  select.replaceChildren(new Option(emptyLabel, ''), ...jobs.map(job => new Option(jobName(job), job.url, false, job.url === chosenUrl)));
  if (chosenUrl && !jobs.some(job => job.url === chosenUrl)) select.append(new Option(chosenUrl, chosenUrl, false, true));
  select.append(new Option('Paste a job link…', PASTE));
}
const jobUrlOf = (select, input) => (select.value === PASTE ? (/^https?:\/\//.test(input.value.trim()) ? input.value.trim() : '') : select.value);

// Which macOS permission is missing, with a button to its System Settings page and one to restart
// (macOS applies Screen & System Audio Recording only after the app restarts).
let permissionKind = 'screen';
async function showPermission(noCallAudio = false) {
  const access = await iv.access();
  // npm start: macOS may list the terminal that started the app instead of Electron.
  const who = access.dev ? 'your terminal app (e.g. <b>iTerm</b>; quit and reopen it)' : '<b>Job Pilotto</b> (+ to add it)';
  let text = '';
  if (access.microphone === 'denied' || access.microphone === 'restricted') {
    permissionKind = 'microphone';
    text = `🎙️ <b>Allow the microphone</b>: Privacy &amp; Security → Microphone → ${who}, then restart.`;
  } else if (await iv.tapAvailable()) {
    // AudioTee: only "System Audio Recording Only" is needed; shown when a recording hears no call audio.
    if (noCallAudio) {
      permissionKind = 'screen';
      text = `🔊 <b>No call audio yet</b>: Privacy &amp; Security → Screen &amp; System Audio Recording → <b>System Audio Recording Only</b> → ${who}, then restart.`;
    }
  } else if (access.screen !== 'granted' || noCallAudio) {
    permissionKind = 'screen';
    text = `🔊 <b>Allow the call's audio</b>: Privacy &amp; Security → Screen &amp; System Audio Recording → <b>top list</b> (not "System Audio Recording Only") → ${who}, then restart.`;
  }
  $('iv-permission-text').innerHTML = text;
  show($('iv-permission'), !!text);
}
$('iv-permission-open').addEventListener('click', () => iv.openPrivacy(permissionKind));
$('iv-permission-restart').addEventListener('click', () => { if (!recorder) iv.relaunch(); });

async function loadInterviews() {
  showPermission();
  if (!allJobs.length) { try { allJobs = (await window.pilot.jobs()).jobs; } catch {} }
  renderDrafts(await iv.drafts());
  loadSaved();
}

function renderDrafts(drafts) {
  show($('iv-drafts-block'), drafts.length > 0);
  $('iv-unsaved').textContent = `${drafts.length} unsaved`;
  // Status: words for the meta line, and a pill.
  const STATUS = {new: 'Not transcribed', recording: 'Recording…', transcribing: 'Transcribing…', stopped: 'Stopped: transcribe again',
    failed: 'Failed', ready: 'Transcript ready'};
  const PILL = {ready: ['good', 'Ready'], transcribing: ['signal', 'Transcribing'], recording: ['signal', 'Recording'], failed: ['bad', 'Failed']};
  $('iv-drafts').replaceChildren(...drafts.map(draft => {
    const busy = draft.status === 'recording' || draft.status === 'transcribing';
    const row = el('div', `iv-draft${draft.id === ivOpen ? ' open' : ''}`);
    const text = el('div', 'iv-draft-text');
    const when = new Date(draft.createdAt).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    const meta = el('div', 'muted small');
    const parts = [when, draft.seconds ? `${Math.max(1, Math.round(draft.seconds / 60))} min` : '', STATUS[draft.status] || draft.status,
      draft.pageUrl ? 'Transcript in Notion' : 'Stored on this Mac'].filter(Boolean);
    meta.textContent = parts.join('  ·  ');
    text.append(el('b', '', draft.title), meta);
    const [tone, label] = PILL[draft.status] || ['neutral', STATUS[draft.status] || draft.status];
    const state = pill(label, tone, {dot: true});
    // The next step for this draft: transcribe it, or review the transcript and save it.
    const needsTranscript = draft.kind === 'audio' && ['new', 'stopped', 'failed'].includes(draft.status);
    const main = Object.assign(el('button', 'primary iv-main', draft.status === 'ready' ? 'Review & save' : needsTranscript ? 'Transcribe' : 'Open'),
      {disabled: busy && draft.id !== ivOpen});
    main.addEventListener('click', () => openDraft(draft.id));
    const menu = [{label: 'Open', run: () => openDraft(draft.id)}];
    if (draft.pageUrl) menu.push({label: '↗ Transcript in Notion', run: () => window.pilot.openExternal(draft.pageUrl)});
    menu.push({label: osText('Show in Finder'), run: () => iv.recordings(), title: 'The recordings kept on this Mac'});
    if (!busy) {
      menu.push('-', {label: draft.pageId ? 'Delete here and in Notion' : 'Delete recording', danger: true, run: async () => {
        if (!confirm(draft.pageId ? `Delete "${draft.title}" on this Mac and in Notion?` : `Delete "${draft.title}" and its recording?`)) return;
        await iv.discard(draft.id);
        if (ivOpen === draft.id) { ivOpen = null; show($('iv-editor'), false); }
        renderDrafts(await iv.drafts());
      }});
    }
    const actions = el('div', 'row-actions');
    actions.append(main, moreButton(menu, 'More: open, show in Finder, delete'));
    row.append(tile(draft.kind === 'audio' ? 'mic' : 'file'), text, state, actions);
    return row;
  }));
}

async function openDraft(id) {
  const draft = (await iv.drafts()).find(d => d.id === id);
  if (!draft) return;
  ivOpen = id;
  show($('iv-editor'));
  $('iv-title').value = draft.title || '';
  const busy = draft.status === 'transcribing';
  show($('iv-transcribe'), draft.kind === 'audio' && ['new', 'stopped', 'failed'].includes(draft.status));
  show($('iv-progress'), busy);
  show($('iv-ready'), draft.status === 'ready');
  if (draft.status === 'failed') message('iv-message', draft.error || 'Transcription failed', 'error');
  if (draft.status === 'ready') {
    $('iv-text').value = await iv.transcript(id);
    jobOptions($('iv-job'), draft.jobUrl, 'Let Claude find the job when reviewing');
    show($('iv-job-url'), false);
    $('iv-job-url').value = '';
    renderSpeakers();
  }
  renderDrafts(await iv.drafts());
  $('iv-editor').scrollIntoView({behavior: 'smooth', block: 'start'});
}

// One field per speaker; renaming rewrites every "[time] Name:" line of the transcript.
function renderSpeakers() {
  const names = [...new Set([...$('iv-text').value.matchAll(/^\[\d\d:\d\d:\d\d\] ([^:\n]{1,60}):/gm)].map(m => m[1]))];
  $('iv-speakers').replaceChildren(...names.map(name => {
    const label = Object.assign(document.createElement('label'), {textContent: name});
    const input = Object.assign(document.createElement('input'), {value: name, placeholder: 'e.g. You, Recruiter, Hiring manager'});
    input.addEventListener('change', () => {
      const to = input.value.replace(/[:\n[\]]/g, ' ').trim();
      if (!to || to === name) { input.value = name; return; }
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      $('iv-text').value = $('iv-text').value.replace(new RegExp(`^(\\[\\d\\d:\\d\\d:\\d\\d\\] )${escaped}:`, 'gm'), `$1${to}:`);
      saveOpenDraft();
      renderSpeakers();
    });
    label.append(input);
    return label;
  }));
}

let draftTimer;
function saveOpenDraft() {
  if (!ivOpen) return Promise.resolve();
  clearTimeout(draftTimer);
  return iv.saveDraft(ivOpen, {title: $('iv-title').value, jobUrl: jobUrlOf($('iv-job'), $('iv-job-url')),
    ...($('iv-ready').hidden ? {} : {text: $('iv-text').value})});
}
$('iv-title').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveOpenDraft, 600); });
$('iv-text').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => { saveOpenDraft(); renderSpeakers(); }, 800); });
$('iv-job').addEventListener('change', () => {
  show($('iv-job-url'), $('iv-job').value === PASTE);
  if ($('iv-job').value === PASTE) $('iv-job-url').focus(); else saveOpenDraft();
});
$('iv-job-url').addEventListener('change', saveOpenDraft);
$('iv-close').addEventListener('click', async () => { await saveOpenDraft(); ivOpen = null; show($('iv-editor'), false); renderDrafts(await iv.drafts()); });

$('iv-transcribe-go').addEventListener('click', async () => {
  const id = ivOpen;
  await saveOpenDraft();
  message('iv-message', '');
  show($('iv-transcribe'), false);
  show($('iv-progress'));
  $('iv-progress-text').textContent = 'Starting';
  $('iv-progress-bar').style.width = '2%';
  const meta = await iv.transcribe(id, {speakers: Number($('iv-count').value)});
  if (ivOpen === id) openDraft(id);
  if (meta.status !== 'ready') message('iv-message', meta.error || 'Transcription failed', 'error');
});
window.pilot.onInterviewProgress(({id, percent, text}) => {
  if (id !== ivOpen) return;
  show($('iv-progress'));
  $('iv-progress-text').textContent = text;
  $('iv-progress-percent').textContent = percent == null ? '' : `${percent}%`;
  if (percent != null) $('iv-progress-bar').style.width = `${Math.max(2, percent)}%`;
});

$('iv-add').addEventListener('click', async () => {
  const draft = await iv.add();
  if (!draft) return;
  if (draft.error) { message('iv-message', draft.error, 'error'); return; }
  message('iv-message', '');
  openDraft(draft.id);
});

async function saveToNotion(andReview) {
  await saveOpenDraft();
  const id = ivOpen;
  for (const button of ['iv-save', 'iv-save-review']) $(button).disabled = true;
  message('iv-message', 'Saving to Notion…');
  try {
    const result = await iv.save(id);
    if (!result.ok) { message('iv-message', result.error, 'error'); return; }
    ivOpen = null;
    show($('iv-editor'), false);
    renderDrafts(await iv.drafts());
    message('iv-message', 'Saved to Notion 🎤 Interviews.', 'ok');
    await loadSaved();
    if (andReview) reviewRow(result.id);
  } finally {
    for (const button of ['iv-save', 'iv-save-review']) $(button).disabled = false;
  }
}
$('iv-save').addEventListener('click', () => saveToNotion(false));
$('iv-save-review').addEventListener('click', () => saveToNotion(true));
$('iv-discard').addEventListener('click', async () => {
  if (!ivOpen) return;
  await iv.discard(ivOpen);
  ivOpen = null;
  show($('iv-editor'), false);
  renderDrafts(await iv.drafts());
});

// Saved interviews, from Notion. Changing the job updates the row's Application there.
const reviewing = new Set();
const OUTCOME = {positive: 'Positive', neutral: 'Neutral', negative: 'Negative'};
const OUTCOME_TONE = {positive: 'good', neutral: 'warn', negative: 'bad'};
// While the library loads from Notion (like the Jobs list): a spinner in the empty table the first time;
// afterwards the rows stay and the subtitle says it's refreshing.
const IV_SAVED_TO = 'Saved to Notion 🎤 Interviews';
function showSavedLoading() {
  show($('iv-empty'), false);
  if (ivSavedRows.length) { $('iv-lib-stats').textContent = 'Refreshing from Notion…'; return; }
  const box = el('div', 'list-loading');
  box.append(el('span', 'spinner'), el('div', '', 'Loading your interviews from Notion…'),
    el('div', 'muted small', 'Interviews and their applications, usually a few seconds'));
  const td = Object.assign(document.createElement('td'), {colSpan: 5});
  td.append(box);
  const tr = document.createElement('tr');
  tr.append(td);
  $('iv-saved').replaceChildren(tr);
  $('iv-lib-stats').textContent = 'Loading from Notion…';
}
async function loadSaved() {
  showSavedLoading();
  const result = await iv.saved().catch(error => ({ok: false, error: String(error?.message || error)}));
  $('iv-lib-stats').textContent = IV_SAVED_TO;
  if (!result.ok) { ivSavedRows = []; $('iv-saved').replaceChildren(); show($('iv-empty')); $('iv-empty').textContent = result.error; return; }
  ivSavedRows = result.interviews;
  renderSaved();
}
function renderSaved() {
  closeMenu();
  const text = $('iv-filter').value.trim().toLowerCase(), outcome = $('iv-outcome').value;
  const rows = ivSavedRows.filter(row => {
    const job = row.application[0] ? jobForPage(row.application[0]) : null;
    const words = `${row.title} ${row.round || ''} ${row.next_step || ''} ${job?.title || ''} ${job?.company || ''}`.toLowerCase();
    return (!text || words.includes(text)) && (!outcome || (outcome === 'none' ? !row.overall : row.overall === outcome));
  });
  show($('iv-empty'), rows.length === 0);
  $('iv-empty').textContent = ivSavedRows.length ? 'No interview matches this filter.' : 'No interviews in Notion yet.';
  $('iv-saved').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    const cell = (...children) => { const td = document.createElement('td'); td.append(...children); tr.append(td); return td; };
    const job = row.application[0] ? jobForPage(row.application[0]) : null;
    cell(row.date ? new Date(`${row.date}T12:00:00`).toLocaleDateString([], {day: 'numeric', month: 'short', year: 'numeric'}) : '').className = 'iv-date';

    // Interview: company badge, the job (or the interview's own title), company · round, next step.
    const who = el('div', 'iv-who');
    const logo = avatar(job?.company || row.title);
    const badge = el('span', 'logo', logo.initials);
    badge.style.setProperty('--hue', logo.hue);
    const lines = el('div', '');
    lines.append(el('b', '', job ? job.title : row.title));
    const sub = [job?.company, row.round].filter(Boolean).join(' · ') || (job ? '' : 'No job linked');
    if (sub) lines.append(el('div', 'muted small', sub));
    lines.append(el('div', 'muted small', row.next_step ? `Next: ${row.next_step}` : 'Next step not stated'));
    who.append(badge, lines);
    // Change job…: the job picker, shown on the row when asked for from the menu.
    const picker = el('div', 'iv-picker');
    picker.hidden = true;
    const select = document.createElement('select');
    jobOptions(select, job?.url || '', row.application[0] && !job ? 'Linked in Notion (job not in this list)' : 'No job linked');
    if (row.application[0] && !job) select.value = '';
    const pasted = Object.assign(document.createElement('input'), {type: 'url', placeholder: 'https://… then Enter', hidden: true});
    const relink = async url => {
      select.disabled = pasted.disabled = true;
      message('iv-message', 'Linking in Notion…');
      const done = await iv.link(row.id, url);
      select.disabled = pasted.disabled = false;
      message('iv-message', done.ok ? `"${row.title}" is now ${url ? 'linked to that job' : 'not linked to a job'} in Notion.` : done.error, done.ok ? 'ok' : 'error');
      if (done.ok) {
        if (url && !allJobs.some(j => j.url === url && j.notion_url)) { try { allJobs = (await window.pilot.jobs()).jobs; } catch {} }  // just added to Applications
        loadSaved();
      }
    };
    select.addEventListener('change', () => {
      show(pasted, select.value === PASTE);
      if (select.value === PASTE) pasted.focus(); else relink(select.value);
    });
    pasted.addEventListener('change', () => { if (/^https?:\/\//.test(pasted.value.trim())) relink(pasted.value.trim()); });
    picker.append(select, pasted);
    cell(who, picker);

    // Where: the job in this list, else the linked Applications row (a job applied to outside Job Pilotto).
    const place = job || row.place || {};
    cell(placeAndMode(place.location, place.work_mode) || '–').className = 'iv-where';
    cell(row.overall ? pill(OUTCOME[row.overall] || row.overall, OUTCOME_TONE[row.overall] || 'neutral', {dot: true})
      : pill(reviewing.has(row.id) ? 'Reviewing…' : 'Not reviewed', reviewing.has(row.id) ? 'signal' : 'neutral', {dot: true}));

    // Actions: open the review (or get one), then the rest in ⋯.
    const actions = el('div', 'row-actions');
    let main;
    if (row.overall) {
      main = el('button', 'secondary iv-main', 'Open review');
      main.title = 'The review and transcript, in Notion';
      main.addEventListener('click', event => window.pilot.openNotion(row.url, event.metaKey));
    } else {
      main = Object.assign(el('button', 'secondary iv-main', reviewing.has(row.id) ? 'Reviewing…' : 'Review'), {disabled: reviewing.has(row.id),
        title: 'Claude reviews it question by question (about $0.05); the review is added to the Notion page'});
      main.addEventListener('click', () => reviewRow(row.id));
    }
    const menu = [
      {label: '↗ Open in Notion', run: event => window.pilot.openNotion(row.url, event.metaKey)},
      {label: 'Change job…', run: () => { picker.hidden = false; select.focus(); }, title: 'Link this interview to another job (updates Notion)'},
      '-',
      {label: 'Delete', danger: true, title: osText("Moves the row to Notion's trash (restorable for 30 days) and deletes its recording on this Mac"), run: async () => {
        if (!confirm(osText(`Delete "${row.title}"? It goes to Notion's trash (30 days) and its recording is removed from this Mac.`))) return;
        const done = await iv.remove(row.id);
        message('iv-message', done.ok ? osText(`Deleted "${row.title}": in Notion's trash for 30 days${done.removed ? ', its recording removed from this Mac' : ''}.`)
          : done.error, done.ok ? 'ok' : 'error');
        loadSaved();
      }},
    ];
    actions.append(main, moreButton(menu, 'More: open in Notion, change job, delete'));
    cell(actions);
    return tr;
  }));
}
$('iv-filter').addEventListener('input', renderSaved);
$('iv-outcome').addEventListener('change', renderSaved);

async function reviewRow(pageId) {
  if (!state.secrets?.ANTHROPIC_API_KEY) { message('iv-message', 'Add your Anthropic key in Settings to get reviews.', 'error'); return; }
  reviewing.add(pageId);
  message('iv-message', 'Claude is reviewing the interview (about a minute)…');
  loadSaved();
  const result = await iv.review(pageId);
  reviewing.delete(pageId);
  message('iv-message', result.ok ? `${result.summary}. The review is on the Notion page.` : result.error, result.ok ? 'ok' : 'error');
  loadSaved();
}
$('iv-refresh').addEventListener('click', loadSaved);
$('iv-recordings').addEventListener('click', () => iv.recordings());

// Recorder: your microphone on the left channel, the call's audio (screen capture) on the right, so the
// transcript can tell which speaker is you. Without the call's audio it records the microphone alone.
let recorder = null;
// Consent first: Record stays off until the box is ticked, and the tick is asked again for every call.
$('iv-consent').addEventListener('change', () => { $('iv-record').disabled = !$('iv-consent').checked || !!recorder; });
// Record starts only with the call's audio (otherwise only your voice would be kept); the permission panel
// says what to allow. "Record my microphone only" is the explicit choice for in-person or speaker calls.
async function callAudio() {
  // Without macOS Screen & System Audio Recording permission the request may never answer: give up after 5 s.
  try {
    const request = navigator.mediaDevices.getDisplayMedia({audio: true, video: {frameRate: 1, width: 320, height: 200}});
    const call = await Promise.race([request, new Promise(resolve => setTimeout(() => resolve(null), 5000))]);
    if (!call) { request.then(late => late.getTracks().forEach(t => t.stop()), () => {}); return null; }
    if (!call.getAudioTracks().length) { call.getTracks().forEach(t => t.stop()); return null; }
    return call;
  } catch { return null; }
}

$('iv-record').addEventListener('click', () => startRecording(false));
$('iv-mic-only').addEventListener('click', () => startRecording(true));

let levelListener = null;
window.pilot.onCallLevel(level => levelListener?.(level));

async function startRecording(micOnly) {
  message('iv-message', '');
  if (!$('iv-consent').checked) { message('iv-message', 'First ask everyone on the call and tick the consent box.', 'error'); return; }
  if (recorder) return;
  $('iv-record').disabled = true;
  let call = null;
  const tap = !micOnly && await iv.tapAvailable();  // the call's audio through AudioTee, no screen capture
  if (!micOnly && !tap) {
    message('iv-message', 'Connecting to the call\'s audio…');
    call = await callAudio();
    if (!call) {
      message('iv-message', 'Not recording: allow the call\'s audio first (above), or choose Mic only.', 'error');
      await showPermission(true);
      $('iv-record').disabled = !$('iv-consent').checked;
      $('iv-permission').scrollIntoView({behavior: 'smooth', block: 'center'});
      return;
    }
    message('iv-message', '');
  }
  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}});
  } catch {
    call?.getTracks().forEach(t => t.stop());
    message('iv-message', 'Job Pilotto may not use the microphone yet: allow it (see above), then restart.', 'error');
    showPermission();
    $('iv-record').disabled = !$('iv-consent').checked;
    return;
  }
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const mono = stream => {
    const gain = context.createGain();
    Object.assign(gain, {channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers'});
    context.createMediaStreamSource(stream).connect(gain);
    return gain;
  };
  if (call) {
    const merger = context.createChannelMerger(2);
    mono(mic).connect(merger, 0, 0);
    mono(call).connect(merger, 0, 1);
    destination.channelCount = 2;
    merger.connect(destination);
  } else {
    destination.channelCount = 1;
    mono(mic).connect(destination);
  }
  const id = await iv.recordStart({stereo: !!call || tap});
  if (tap) {
    const tapped = await iv.tapStart(id);
    if (!tapped.ok) {
      mic.getTracks().forEach(t => t.stop());
      context.close();
      await iv.recordStop(id, 0);
      await iv.discard(id);
      message('iv-message', `Not recording: the call's audio couldn't start (${tapped.error}). Try again, or choose Mic only.`, 'error');
      $('iv-record').disabled = !$('iv-consent').checked;
      return;
    }
  }
  const media = new MediaRecorder(destination.stream, {mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: call ? 96000 : 48000});
  // AudioTee's level: the meter moves when the other people speak; flat for 20 s = likely no permission.
  let heard = false;
  const quiet = tap ? setTimeout(() => {
    if (!heard && recorder === media) {
      $('iv-sources').textContent = 'No call audio heard yet.';
      showPermission(true);
    }
  }, 20000) : null;
  levelListener = ({id: tapped, level}) => {
    if (tapped !== id) return;
    if (level > 0.02 && !heard) { heard = true; $('iv-sources').textContent = 'Your microphone and the call\'s audio'; show($('iv-permission'), false); }
    $('iv-meter-bar').style.width = `${Math.min(100, Math.round(Math.sqrt(level) * 140))}%`;
  };
  const started = Date.now();
  let writing = Promise.resolve();
  media.ondataavailable = event => {
    if (event.data.size) writing = writing.then(async () => iv.recordChunk(id, new Uint8Array(await event.data.arrayBuffer())));
  };
  const timer = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    $('iv-timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  media.onstop = async () => {
    clearInterval(timer);
    await writing;
    [mic, call].filter(Boolean).forEach(stream => stream.getTracks().forEach(track => track.stop()));
    context.close();
    clearTimeout(quiet);
    levelListener = null;
    await iv.recordStop(id, (Date.now() - started) / 1000, {micStartedAt});
    recorder = null;
    show($('iv-recorder'), false);
    $('iv-consent').checked = false;
    $('iv-record').disabled = true;
    openDraft(id);
  };
  media.start(5000);  // a chunk every 5 s goes to disk
  const micStartedAt = Date.now();
  recorder = media;
  $('iv-record').disabled = true;
  $('iv-timer').textContent = '00:00';
  $('iv-sources').textContent = call ? 'Your microphone and the call\'s audio' : tap ? 'Listening for the call\'s audio…' : 'Your microphone only (as you chose)';
  show($('iv-meter'), tap);
  $('iv-meter-bar').style.width = '0';
  show($('iv-permission'), false);
  show($('iv-recorder'));
}
$('iv-stop').addEventListener('click', () => recorder?.state === 'recording' && recorder.stop());

// ---------- Focus: what to do next (src/focus.py, from Notion, no AI) ----------
function focusButton(label, className, run) {
  const button = Object.assign(document.createElement('button'), {className, textContent: label});
  button.addEventListener('click', run);
  return button;
}
function openLink(url, event) {
  if (/notion\.(so|com)\//.test(url)) window.pilot.openNotion(url, event?.metaKey); else window.pilot.openExternal(url);
}
const bone = (className = '') => el('span', `skeleton ${className}`);  // a grey placeholder bar while loading
// First load: skeleton cards (the page's shape, greyed); later the content stays while it refreshes.
function focusSkeleton() {
  $('focus-count-note').textContent = 'Checking replies, interviews and applications';
  $('focus-list').replaceChildren(...[0, 1, 2].map(() => {
    const li = el('li', 'focus-item is-loading');
    const body = el('div', 'focus-body');
    body.append(bone('w-20'), bone('w-60 tall'), bone('w-40'));
    const actions = el('div', 'focus-actions');
    actions.append(bone('button'), bone('button small'));
    li.append(el('span', 'focus-round skeleton-round'), body, actions);
    return li;
  }));
  $('focus-count').replaceChildren(bone('w-number tall'));
  $('focus-pct').textContent = '';
  $('focus-summary').replaceChildren(bone('w-80'), bone('w-60'));
  const insight = el('div', 'focus-insight-box is-loading');
  insight.append(el('span', 'focus-round skeleton-round'), (() => { const d = el('div', 'focus-body'); d.append(bone('w-60 tall'), bone('w-80')); return d; })());
  $('focus-insight').replaceChildren(insight);
  show($('focus-insight-card'));
  $('funnel-steps').replaceChildren(...[0, 1, 2, 3, 4].map(() => {
    const li = el('li', 'funnel-step is-loading');
    li.append(bone('w-40'), bone('w-30 tall'), bone('w-80'));
    return li;
  }));
  show($('focus-funnel'));
  show($('focus-empty'), false);
}
function focusStatus(text, busy = false) {
  $('focus-status').replaceChildren(...(busy ? [el('span', 'spinner small')] : []), document.createTextNode(text));
}
let focusUpdatedAt = 0;
setInterval(() => {  // "Updated 3 min ago" stays true while the page is open
  if (focusUpdatedAt && !focusLoading) focusStatus(`Updated ${savedAgo(new Date(focusUpdatedAt).toISOString())}`);
}, 60000);
function loadFocus() {
  focusLoading ||= loadFocusOnce().catch(error => {
    // Never a blank page: say what went wrong where the list goes.
    focusStatus('Could not load');
    const li = el('li', 'focus-item muted');
    li.textContent = /No handler registered/.test(String(error?.message))
      ? 'Job Pilotto was updated while it was open. Restart it to load Focus.'
      : `Focus could not load: ${error?.message || error}. Try Refresh.`;
    $('focus-list').replaceChildren(li);
  }).finally(() => { focusLoading = null; $('focus-refresh').disabled = false; });
  return focusLoading;
}
async function loadFocusOnce() {
  $('focus-refresh').disabled = true;
  focusStatus('Syncing your jobs…', true);
  const setting = await window.pilot.dailyTarget();
  $('focus-target').value = setting.target;
  $('focus-remind').checked = setting.reminders;
  $('focus-of').textContent = `/ ${setting.target} applications today`;
  if (!focusShown) {  // the last good Focus at once (lib/view-cache.js), else the skeleton; the fresh one follows
    const saved = await window.pilot.cached('focus');
    if (saved?.result?.focus) { renderFocus(saved.result.focus); focusStatus(`Saved ${savedAgo(saved.at)} · updating…`, true); }
    else focusSkeleton();
  }
  const result = await window.pilot.focus();
  if (!result.ok) {
    focusStatus(result.error || 'Could not read your Notion.');
    if (!focusShown) $('focus-list').replaceChildren();
    return;
  }
  renderFocus(result.focus);
  focusUpdatedAt = Date.now();
  focusStatus('Updated just now');
}
function focusCard(item) {
  const li = el('li', `focus-item tone-${item.tone || 'neutral'}`);
  const round = el('span', 'focus-round');
  round.append(icon(item.icon || 'check'));
  const body = el('div', 'focus-body');
  const meta = el('div', 'focus-meta muted small');
  (item.meta || []).forEach((part, i) => { if (i) meta.append(el('span', 'sep', '·')); meta.append(el('span', '', part)); });
  const top = el('div', 'focus-top');  // the headline and its badge on one line: a compact row
  top.append(el('span', 'focus-headline', item.headline || item.title), pill(item.badge || '', item.tone || 'neutral', {dot: true}));
  body.append(top, meta);
  body.title = item.detail || '';
  const actions = el('div', 'focus-actions');
  if (item.link) actions.append(focusButton(item.link_label || 'Open', 'primary', event => openLink(item.link, event)));
  if (item.kind === 'apply') actions.append(focusButton('Browse jobs', 'primary', () => openView('jobs')));
  if (item.kind === 'review') actions.append(focusButton('Interviews', 'primary', () => openView('interviews')));
  if (!item.link && ['reply', 'book', 'offer', 'prepare', 'nudge'].includes(item.kind) && item.notion_url) {
    actions.append(focusButton('Open', 'primary', event => openLink(item.notion_url, event)));
  }
  if (item.done && item.page_id) actions.append(focusButton('Done', 'secondary', async event => {
    event.currentTarget.disabled = true;
    const done = await window.pilot.focusDone(item.page_id);
    if (!done.ok) toastMessage('Not saved', done.error || 'Notion refused it. Try again.');
    loadFocus();
  }));
  const more = [];
  if (item.notion_url) more.push({label: '🗂 Open in Notion', run: event => openLink(item.notion_url, event)});
  if (item.job_url && item.job_url !== item.link && !/jobpilotto|mail\.google/.test(item.job_url)) more.push({label: '↗ Open posting', run: () => window.pilot.openExternal(item.job_url)});
  if (item.kind === 'apply') more.push({label: '🎯 Change the daily target', run: () => editTarget()});
  if (item.detail) more.push({label: 'ℹ️ Details', run: () => toastMessage(item.headline || item.title, item.detail)});
  if (more.length) actions.append(moreButton(more, 'More'));
  li.append(round, body, actions);
  return li;
}
function renderFocus({items, today, funnel, insight, summary}) {
  focusShown = true;
  $('focus-count-note').replaceChildren(pill(`${items.length} action${items.length === 1 ? '' : 's'}`, 'neutral'));
  $('focus-list').replaceChildren(...items.map(focusCard));
  show($('focus-empty'), !items.length);
  const pct = Math.min(100, Math.round(100 * today.applied / Math.max(today.target, 1)));
  $('focus-count').textContent = String(today.applied);
  $('focus-of').textContent = `/ ${today.target} applications today`;
  $('focus-target').value = today.target;
  $('focus-bar').style.width = `${pct}%`;
  $('focus-pct').textContent = `${pct}%`;
  $('focus-summary').textContent = summary || '';
  renderInsight(insight);
  renderFunnel(funnel);
}
// The latest rejection lesson, as the page's one insight.
function renderInsight(insight) {
  show($('focus-insight-card'), !!insight);
  if (!insight) return;
  const box = el('div', 'focus-insight-box');
  const round = el('span', 'focus-round tone-warn');
  round.append(icon('alert'));
  const body = el('div', 'focus-body');
  body.append(el('div', 'focus-headline', insight.headline), el('div', 'muted small', `${insight.reason} · ${insight.detail}`));
  body.title = insight.lesson || '';
  box.append(round, body);
  if (insight.notion_url) box.append(focusButton('Review rejection', 'secondary', event => openLink(insight.notion_url, event)));
  $('focus-insight').replaceChildren(box);
}
// The application funnel: each step's count, a bar and its share of the first step; the full view is in Notion.
function renderFunnel(funnel) {
  const steps = (funnel?.steps || []).slice(0, 5);
  show($('focus-funnel'), steps.length > 0);
  if (!steps.length) return;
  const first = Math.max(steps[0].reached, 1);
  const nodes = [];
  steps.forEach((step, i) => {
    if (i) nodes.push(Object.assign(el('li', 'funnel-arrow'), {ariaHidden: 'true'}));
    if (i) nodes[nodes.length - 1].append(icon('chevron'));
    const share = Math.round(100 * step.reached / first);
    const li = el('li', `funnel-step${funnel.improve?.step === step.step ? ' is-weak' : ''}`);
    const bar = el('div', 'funnel-bar');
    const fill = el('span', '');
    fill.style.width = `${Math.max(share, step.reached ? 4 : 0)}%`;
    bar.append(fill);
    // Ever reached (big), then how many are there now (the Jobs boxes' number), e.g. Screening 2 · 1 now.
    const now = i && step.now != null ? ` · ${step.now} now` : '';
    li.title = i ? `${step.reached} ever reached this step; ${step.now ?? '?'} ${step.now === 1 ? 'is' : 'are'} there now` : '';
    li.append(el('span', 'funnel-name', step.step.replace(/^\S+\s/, '')), el('b', 'funnel-count', String(step.reached)), bar, el('span', 'muted small', `${share}%${now}`));
    nodes.push(li);
  });
  $('funnel-steps').replaceChildren(...nodes);
  $('funnel-improve').textContent = funnel.improve ? `To improve: ${funnel.improve.step.replace(/^\S+\s/, '')}. ${funnel.improve.advice}` : '';
  show($('funnel-improve'), !!funnel.improve);
  $('focus-funnel-notion').dataset.url = funnel.notion_url || '';
  show($('focus-funnel-notion'), !!funnel.notion_url);
}
$('focus-funnel-notion').addEventListener('click', event => {
  event.preventDefault();
  if (event.currentTarget.dataset.url) window.pilot.openNotion(event.currentTarget.dataset.url, event.metaKey);
});
function editTarget() {
  show($('focus-target-row'));
  $('focus-target').focus();
  $('focus-target').select();
}
$('focus-edit-target').addEventListener('click', event => { event.preventDefault(); editTarget(); });
$('focus-edit-reminders').addEventListener('click', event => {
  event.preventDefault();
  openView('settings');
  openSetting('schedule');
});
// The target is a line of ⚙️ Search settings in Notion; changing it here (or in Settings) writes it there.
async function saveDailyTarget(input) {
  input.disabled = true;
  const result = await window.pilot.setDailyTarget(input.value);
  input.disabled = false;
  if (!result.ok) { toastMessage('Target not changed', result.error); return false; }
  for (const id of ['focus-target', 'set-target']) $(id).value = result.target;
  return true;
}
$('focus-refresh').addEventListener('click', loadFocus);
$('focus-target').addEventListener('change', async () => {
  if (await saveDailyTarget($('focus-target'))) { show($('focus-target-row'), false); loadFocus(); }
});
$('set-target').addEventListener('input', automationChanged);
$('set-remind').addEventListener('change', automationChanged);
$('focus-remind').addEventListener('change', async () => {  // the Focus page saves at once; Settings with Save changes
  const on = $('focus-remind').checked;
  await window.pilot.saveSettings({focusReminders: on});
  $('set-remind').checked = on;
  state = await window.pilot.state();
});

// The running app is older than this window (updated while open): offer a restart, once.
window.addEventListener('pilot-outdated', () => {
  if (outdatedShown) return;
  outdatedShown = true;
  const toast = toastMessage('Job Pilotto was updated', 'Restart it to finish the update: some buttons won\'t work until then. Click here to restart.');
  if (toast) toast.onclick = () => window.pilot.interviews.relaunch();
});

// ---------- Application sessions: Apply with Claude inside the app (lib/terminals.js) ----------
// A dock of cards above the activity bar (one per session) and a session page with the live terminal (xterm.js),
// Claude's question when it waits for you, quick answers and a message box. Sessions report their state through
// Claude Code hooks; the app notifies you when one needs you.
function sessionFor(url) {
  const key = pageKey(url || '');
  return sessionList.filter(item => pageKey(item.url) === key).pop() || null;
}
const sessionJob = item => allJobs.find(job => pageKey(job.url) === pageKey(item.url)) || {};
const sessionTitle = item => item.title || sessionJob(item).title || 'Application';
const sessionCompany = item => item.company || sessionJob(item).company || new URL(item.url || 'https://job').hostname.replace(/^www\./, '');
async function refreshSessions() {
  sessionList = await window.pilot.sessions().catch(() => []);
  renderDock();
  if (!document.querySelector('.view[data-view="sessions"]').hidden) renderSessionPage();
}
function sessionLogo(item) {
  const {initials, hue} = avatar(sessionCompany(item));
  const badge = el('span', 'logo', initials);
  badge.style.setProperty('--hue', hue);
  return badge;
}
function renderDock() {
  const live = sessionList.filter(item => !item.endedAt || item.status === 'done');
  // Not on the sessions page itself (it lists them all): the tray would only repeat what's on screen.
  const onSessionsPage = !document.querySelector('.view[data-view="sessions"]')?.hidden;
  show($('sessions-dock'), sessionList.length > 0 && !onSessionsPage);
  if (!sessionList.length) return;
  const running = sessionList.filter(item => !item.endedAt).length, waiting = sessionList.filter(item => item.status === 'input').length;
  // Two pills: how many are active (blue), how many wait for you (amber).
  $('sd-summary').replaceChildren(pill(`${running} active`, 'info'), ...(waiting ? [pill(`${waiting} need${waiting === 1 ? 's' : ''} input`, 'warn')] : []));
  $('sd-toggle').setAttribute('aria-expanded', dockOpen);
  $('sessions-dock').classList.toggle('is-closed', !dockOpen);
  const order = {input: 0, running: 1, done: 2, failed: 3, ended: 4};
  const shown = [...(live.length ? live : sessionList)].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5)).slice(0, 3);
  $('sd-cards').replaceChildren(...shown.map(item => {
    const [label, tone] = sessionState(item);
    const card = el('div', `sd-card tone-${tone}`);
    const words = el('div', 'sd-words');
    const title = el('b', 'focus-headline', `${sessionCompany(item)} · ${sessionTitle(item)}`);
    title.title = title.textContent;
    const state = el('div', 'sd-state');  // the badge, then what it's doing (or asking), on one line under the title
    const note = el('span', 'muted small sd-note', item.status === 'input' ? item.brief || item.note || '' : item.note || '');
    note.title = note.textContent;
    state.append(pill(label, tone, {dot: item.status === 'running'}), note);
    words.append(title, state);
    const action = el('button', item.status === 'input' ? 'primary' : 'secondary', item.status === 'input' ? 'Respond' : item.status === 'done' ? 'Review' : 'Open session');
    action.addEventListener('click', () => openSession(item.id));
    card.addEventListener('click', event => { if (!event.target.closest('button')) openSession(item.id); });  // the whole card
    card.append(sessionLogo(item), words, action);  // stop / open posting: on the session page (⋯), keeping cards compact
    return card;
  }));
}
function sessionMenu(item) {
  const menu = [{label: '↗ Open posting', run: () => window.pilot.openExternal(item.url)}];
  if (!item.endedAt) menu.push({label: '⏸ Pause Claude (Esc)', run: () => pauseSession()});
  if (!item.endedAt) menu.push({label: '⏹ Stop session', danger: true, run: () => window.pilot.sessionStop(item.id)});
  else menu.push({label: '✕ Remove from the list', run: async () => { await window.pilot.sessionRemove(item.id); if (openSessionId === item.id) openSessionId = null; refreshSessions(); }});
  return menu;
}
// Claude's last message, sorted for the page: the lines it flags (its bullet list), the audit note ("Audit …:"),
// and the rest (its intro and question). Its words are kept; only where they're shown changes.
function readSessionMessage(text) {
  const checks = [], intro = [];
  let audit = '';
  for (const raw of String(text || '').split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    const auditLine = line.match(/^\**(?:form\s+)?audit[^:*]*:\**\s*(.*)$/i);
    if (bullet) checks.push(bullet[1]);
    else if (auditLine) audit = auditLine[1].replace(/^\*+\s*/, '');
    else intro.push(line);
  }
  return {checks, audit, intro};
}
// Waiting for you after filling the form (its message says so) counts as "ready for review", like a finished one.
const REVIEW_WORDS = /form (?:is )?(?:now )?(?:filled|ready|complete)|filled (?:the|every|all|\d+)|ready for (?:your )?review|before you submit|submit it yourself/i;
// A message that ends on a question still waits for your answer first.
const sessionReview = item => item.status === 'done'
  || (item.status === 'input' && REVIEW_WORDS.test(item.question || '') && !/\?\s*$/.test(item.brief || item.question || ''));
const sessionState = item => (sessionReview(item) ? SESSION_STATE.done : SESSION_STATE[item.status] || SESSION_STATE.ended);
function sessionDuration(item) {
  const end = item.endedAt || item.needsYouSince;
  const seconds = Math.max(0, Math.round(((end ? new Date(end) : new Date()) - new Date(item.startedAt)) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}
const hhmmOf = iso => new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
function pauseSession() { if (openSessionId) window.pilot.sessionWrite(openSessionId, '\x1b'); }  // Esc interrupts Claude
// Open or closed as you last left it for this session; until then open while Claude works.
function openLog(open, remember = true) {
  if (remember && openSessionId) logChoice[openSessionId] = open;
  show($('ss-log-body'), open);
  show($('ss-log-last'), !open);
  $('ss-expand').textContent = open ? 'Collapse log' : 'Expand log';
  $('ss-expand').setAttribute('aria-expanded', open);
  if (open) setTimeout(() => { fitTerminal(); if (remember) xterm?.focus(); }, 30);
}
function sessionButton(text, kind, run, glyph) {
  const button = el('button', `${kind}${glyph ? ' with-icon' : ''}`);
  if (glyph) button.append(icon(glyph));
  button.append(el('span', '', text));
  button.addEventListener('click', run);
  return button;
}
function renderNextStep(item) {
  const review = sessionReview(item), asking = item.status === 'input' && !review, running = item.status === 'running';
  const {checks, audit, intro} = readSessionMessage(item.question);
  const tone = review || asking ? 'warn' : running ? 'info' : item.status === 'failed' ? 'bad' : 'neutral';
  $('ss-decision').className = `ss-next tone-${tone}`;
  $('ss-next-icon').className = `focus-round tone-${tone}`;
  $('ss-next-icon').replaceChildren(icon(review || asking ? 'alert' : running ? 'pulse' : 'info'));
  const brief = item.brief || '';
  const ask = /\?$/.test(brief) ? brief : '';
  $('ss-next-title').textContent = review ? 'Review the filled application'
    : asking ? ask || 'Claude needs your answer'
    : running ? 'Claude is filling the application' : item.status === 'failed' ? 'The session stopped' : 'The session ended';
  // What to read: one line when the form is ready (Claude's words stay one click away), else Claude's own text.
  const said = intro.filter(line => line.replace(/\*/g, '') !== ask);
  const words = review ? [el('p', 'rich-p', 'The form is ready in Chrome. Check the answers and legal boxes, then submit it yourself.')]
    : asking ? richText(said.join('\n')) : [el('p', 'rich-p muted', item.note || '')];
  if (review && item.question) {
    const full = el('details', 'ss-full');
    full.append(el('summary', '', 'Claude\'s full message'), ...richText(item.question));
    words.push(full);
  }
  $('ss-question').replaceChildren(...words);
  show($('ss-steps'), review);
  const actions = [];
  if (review) {
    actions.push(sessionButton('Open filled form', 'primary', () => window.pilot.showBrowser(item.url), 'link'));
    actions.push(sessionButton('Skip this role', 'secondary', () => say('Skip this role: close its tab and finish without filling anything.')));
    const never = el('span', 'ss-never muted small');
    never.append(icon('info'), el('span', '', 'Job Pilotto never clicks Submit.'));
    actions.push(never);
  } else if (asking) {
    actions.push(sessionButton('Continue', 'primary', () => say('Continue.')));
    actions.push(sessionButton('Skip this role', 'secondary', () => say('Skip this role: close its tab and finish without filling anything.')));
    actions.push(sessionButton('Answer in your own words', 'link', () => openLog(true), 'chat'));
  } else if (running) {
    actions.push(sessionButton('Pause', 'secondary', pauseSession));
    actions.push(sessionButton('Watch the log', 'link', () => openLog(true), 'eye'));
  }
  $('ss-actions').replaceChildren(...actions);
  // Its state, on the right: finished (when), waiting (since when) or working (since when).
  const side = el('div', 'ss-side');
  const mark = el('span', `focus-round tone-${review ? 'good' : tone}`);
  mark.append(icon(review ? 'check' : asking ? 'clock' : running ? 'refresh' : 'info'));
  const since = item.needsYouSince || item.endedAt || item.startedAt;
  side.append(mark, el('b', '', review ? `Claude finished at ${hhmmOf(since)}` : asking ? `Waiting since ${hhmmOf(since)}`
    : running ? `Started at ${hhmmOf(item.startedAt)}` : `Ended at ${hhmmOf(since)}`),
  el('span', 'muted small', review ? (item.status === 'done' ? 'Form filled in Chrome and recorded in Notion.' : 'Form filled in Chrome.')
    : asking ? 'Claude is paused until you answer.' : running ? 'You can leave this page; you\'ll be notified.' : ''));
  $('ss-next-side').replaceChildren(side);
  // What Claude flagged, and its audit note, as two cards under the step.
  show($('ss-checks-card'), checks.length > 0);
  $('ss-checks-card').querySelector('b').textContent = review ? 'Before you submit' : 'What Claude flagged';
  $('ss-checks').replaceChildren(...checks.map(text => {
    const li = el('li', 'ss-check');
    const [, head, rest] = text.match(/^\*\*([^*]+?):?\*\*:?\s*(.*)$/) || [null, '', text];
    const short = head || rest.split(/(?<=[.;])\s/)[0];
    const more = head ? rest : rest.slice(short.length).trim();
    const line = el('div', 'ss-check-line');
    line.append(icon('chevron'), ...richText(short).flatMap(node => [...node.childNodes]));
    li.append(line);
    if (more) {
      const detail = el('div', 'muted small ss-check-more');
      detail.append(...richText(more).flatMap(node => [...node.childNodes]));
      detail.hidden = true;
      li.classList.add('has-more');
      li.addEventListener('click', () => { detail.hidden = !detail.hidden; li.classList.toggle('is-open', !detail.hidden); });
      li.append(detail);
    }
    return li;
  }));
  show($('ss-audit-card'), !!audit);
  if (audit) {
    const sentences = audit.split(/(?<=\.)\s+/);
    const fixes = (audit.match(/\b(?:corrected|removed|fixed)\b/gi) || []).length;
    $('ss-audit-pill').replaceChildren(...(fixes ? [pill(`${fixes} correction${fixes === 1 ? '' : 's'}`, 'warn', {dot: true})] : [pill('Checked', 'good', {dot: true})]));
    $('ss-audit-summary').replaceChildren(...richText(sentences[0]).flatMap(node => [...node.childNodes]));
    $('ss-audit-detail').replaceChildren(...richText(sentences.slice(1).join(' ') || audit));
    show($('ss-audit-more'), sentences.length > 1);
  }
  show($('ss-facts'), checks.length > 0 || !!audit);
  $('ss-facts').classList.toggle('is-single', !(checks.length && audit));
}
document.querySelector('.sd-head').addEventListener('click', event => {
  if (event.target.closest('#sd-all')) return;
  if (event.target.closest('.sd-link')) { openSession(openSessionId || sessionList[0]?.id); return; }
  dockOpen = !dockOpen;
  renderDock();
});
$('sd-all').addEventListener('click', event => { event.preventDefault(); openSession(openSessionId || sessionList[0]?.id); });
$('ss-crumb-all').addEventListener('click', event => { event.preventDefault(); openSession(openSessionId || sessionList[0]?.id); });
document.querySelectorAll('.crumbs [data-go]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); openView(link.dataset.go); }));
$('ss-new').addEventListener('click', () => openView('jobs'));

async function openSession(id) {
  if (!id) return;
  openSessionId = id;
  openView('sessions');
  await refreshSessions();
  await attachTerminal(id);
}
function renderSessionPage() {
  const item = sessionList.find(entry => entry.id === openSessionId) || sessionList[0];
  show($('ss-list-empty'), !sessionList.length);
  $('ss-list').replaceChildren(...sessionList.slice().reverse().map(entry => {
    const [label, tone] = sessionState(entry);
    const li = el('li', `ss-row tone-${tone}${entry.id === item?.id ? ' is-current' : ''}`);
    const words = el('div', 'ss-row-words');
    const top = el('div', 'ss-row-top');
    top.append(el('b', '', sessionCompany(entry)), el('span', 'muted small', clockTime(entry.startedAt)));
    words.append(top, el('span', 'small', sessionTitle(entry)), pill(label, tone, {dot: true}));
    li.append(sessionLogo(entry), words);
    li.addEventListener('click', () => openSession(entry.id));
    return li;
  }));
  if (!item) return;
  const [label, tone] = sessionState(item);
  $('ss-crumb').textContent = sessionCompany(item);
  $('ss-title').textContent = sessionCompany(item);
  $('ss-role').textContent = sessionTitle(item);
  $('ss-status').replaceChildren(pill(sessionReview(item) ? 'Ready for your review' : label, tone, {dot: true}));
  $('ss-more').replaceChildren(moreButton(sessionMenu(item), 'More'));
  const job = sessionJob(item);
  const head = el('div', 'ss-job-card');
  const words = el('div', 'ss-job-words');
  const place = [...String(item.location || job.location || '').split(/\s*;\s*/), item.workMode || job.work_mode].filter(Boolean).join(' · ');
  words.append(el('b', '', `${sessionCompany(item)} · ${sessionTitle(item)}`), el('span', 'muted', place));
  const view = Object.assign(el('a', 'link small', 'View job ↗'), {href: '#'});
  view.addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal(item.url); });
  head.append(sessionLogo(item), words, view);
  $('ss-job').replaceChildren(head);
  renderNextStep(item);
  const review = sessionReview(item);
  const [logLabel, logTone] = item.status === 'running' ? ['Working', 'info'] : review ? ['Completed', 'good']
    : item.status === 'input' ? ['Waiting for your reply', 'warn'] : [label, tone];
  $('ss-live-state').replaceChildren(pill(`${logLabel} · ${sessionDuration(item)}`, logTone, {dot: true}));
  $('ss-log-last').textContent = `> ${review ? 'Form filled in Chrome. Waiting for your review.' : item.note || 'Starting…'}`;
  openLog(logChoice[item.id] ?? item.status === 'running', false);
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
async function attachTerminal(id) {
  const {Terminal} = await import('../node_modules/@xterm/xterm/lib/xterm.mjs');
  const {FitAddon} = await import('../node_modules/@xterm/addon-fit/lib/addon-fit.mjs');
  if (!xterm) {
    xterm = new Terminal({fontFamily: cssVar('--font-mono'), fontSize: 13, cursorBlink: true, convertEol: false, scrollback: 5000,
      theme: {background: cssVar('--navy'), foreground: cssVar('--on-navy'), cursor: cssVar('--signal'), selectionBackground: cssVar('--navy-active')}});
    xtermFit = new FitAddon();
    xterm.loadAddon(xtermFit);
    xterm.open($('ss-terminal'));
    xterm.onData(data => openSessionId && window.pilot.sessionWrite(openSessionId, data));
    new ResizeObserver(() => fitTerminal()).observe($('ss-terminal'));
  }
  xterm.reset();
  xterm.write(await window.pilot.sessionOutput(id));
  fitTerminal();
}
function fitTerminal() {
  if (!xterm || document.querySelector('.view[data-view="sessions"]').hidden || $('ss-log-body').hidden) return;
  try { xtermFit.fit(); } catch { return; }
  if (openSessionId) window.pilot.sessionResize(openSessionId, xterm.cols, xterm.rows);
}
// Typing a reply: the text, then Enter (Claude Code sends a message on Return).
function say(text) {
  if (!openSessionId || !text.trim()) return;
  window.pilot.sessionWrite(openSessionId, text.trim());
  setTimeout(() => window.pilot.sessionWrite(openSessionId, '\r'), 60);
  xterm?.focus();
}
document.querySelectorAll('[data-say]').forEach(button => button.addEventListener('click', () => say(button.dataset.say)));
$('ss-copy').addEventListener('click', async () => {
  const text = (await window.pilot.sessionOutput(openSessionId)).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  await navigator.clipboard.writeText(text);
  toastMessage('Log copied', 'The session\'s output is on the clipboard.');
});
$('ss-expand').addEventListener('click', () => openLog($('ss-log-body').hidden));
$('ss-log-last').addEventListener('click', () => openLog(true));
window.pilot.onSession((event, payload) => {
  if (event === 'data') { if (payload.id === openSessionId) xterm?.write(payload.data); return; }
  if (event === 'open') { openSession(payload.id); return; }
  refreshSessions().then(() => { if (!document.querySelector('.view[data-view="jobs"]').hidden) renderJobs(); });
});
refreshSessions();

// Status: what's running, the last and next search, the last and next Gmail check, as a small card.
async function showStatusCard() {
  const data = await window.pilot.runs();
  const {running, runs, nextSearchAt, nextMailAt} = data;
  const lastSearch = runs.find(run => kindOf(run) === 'search'), lastMail = runs.find(run => kindOf(run) === 'mail');
  const when = at => (at <= Date.now() ? 'due now' : `${new Date(at).toLocaleDateString([], {weekday: 'short'})} ${hhmm(at)}`);
  const rows = [
    running && ['▶️', 'Running now', `${KIND[kindOf(running)].icon} ${KIND[kindOf(running)].name} · ${running.step || 'starting'}`],
    ['🔎', 'Last search', lastSearch ? `${clockTime(lastSearch.endedAt || lastSearch.startedAt)} · ${capital(outcome(lastSearch))}` : 'none yet'],
    ['⏭', 'Next search', nextSearchAt ? when(nextSearchAt) : 'only when you ask'],
    ['📧', 'Last Gmail check', lastMail ? `${clockTime(lastMail.endedAt || lastMail.startedAt)} · ${capital(outcome(lastMail))}` : 'none yet'],
    ['⏭', 'Next Gmail check', nextMailAt ? when(nextMailAt) : 'off'],
  ].filter(Boolean);
  const card = $('status-card');
  card.replaceChildren(el('h2', '', '🩺 Status'), ...rows.map(([glyph, label, value]) => {
    const row = el('div', 'status-row');
    row.append(el('span', 'status-glyph', glyph), el('span', 'muted', label), el('b', '', value));
    return row;
  }));
  const more = Object.assign(el('a', 'link small', 'See Recent activity →'), {href: '#'});
  more.addEventListener('click', event => { event.preventDefault(); openActivity(true); });
  card.append(more);
  show(card);
  show($('command-answer'), false);
  card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

// Actions page: the live banner (what runs now), Recent runs, and Telegram's state. Fed by the activity data.
const TASK_ICON = {search: 'search', mail: 'mail', insight: 'chart', weekly: 'file', today: 'send', scout: 'building'};
const TASK_TITLE = {search: 'Search for new jobs', mail: 'Gmail & Calendar check', insight: 'Insight', weekly: 'Weekly report',
  today: "Today's matches", scout: 'Find new employers'};
function runWhen(iso) {
  const at = new Date(iso), today = new Date();
  const time = at.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  return at.toDateString() === today.toDateString() ? `Today ${time}` : `${at.toLocaleDateString([], {weekday: 'short'})} ${time}`;
}
function renderActionsPage(data) {
  if (!data) return;
  const {running, runs = []} = data;
  const connected = !!(state.settings.telegramChatId || state.settings.telegramCloud);
  $('actions-telegram').replaceChildren(el('span', `dot ${connected ? 'is-on' : ''}`), document.createTextNode(connected ? 'Telegram connected' : 'Telegram not connected'));
  show($('run-banner'), !!running);
  if (running) {
    const kind = kindOf(running);
    $('run-banner-title').textContent = `${TASK_TITLE[kind] || KIND[kind]?.name || 'A task'} is running`;
    $('run-banner-step').textContent = `Started ${new Date(running.startedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} · ${running.step || 'starting'}`;
  }
  const rows = runs.slice(0, 5).map(run => {
    const kind = kindOf(run);
    const [label, tone] = run.ok && !run.off ? ['Completed', 'good'] : ['Needs a look', 'bad'];
    const li = el('li', 'runs-row');
    const tile = el('span', 'task-tile small');
    tile.append(icon(TASK_ICON[kind] || 'pulse'));
    li.append(tile, el('b', '', KIND[kind]?.name || 'Task'), pill(label, tone), el('span', 'muted', runWhen(run.endedAt || run.startedAt)),
      el('span', 'muted runs-result', capital(outcome(run))), el('span', 'runs-go', '›'));
    li.addEventListener('click', () => { selectedRun = run.id; openActivity(true); renderActivity(lastActivity); });
    return li;
  });
  $('runs-table').replaceChildren(...(rows.length ? rows : [el('li', 'muted runs-empty', 'Nothing has run yet. Press Run on a task above.')]));
}
$('run-banner-view').addEventListener('click', () => openActivity(true));
$('runs-all').addEventListener('click', event => { event.preventDefault(); openActivity(true); });
$('actions-automation').addEventListener('click', event => {
  event.preventDefault();
  openView('settings');
  document.getElementById('setting-schedule')?.scrollIntoView({behavior: 'smooth', block: 'start'});
});

// Claude's message, readable: paragraphs, bullet and numbered lists, **bold** and `code` (built as DOM, never HTML).
function richText(text) {
  const inline = line => {
    const nodes = [];
    for (const part of String(line).split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (/^\*\*[^*]+\*\*$/.test(part)) nodes.push(el('b', '', part.slice(2, -2)));
      else if (/^`[^`]+`$/.test(part)) nodes.push(el('code', '', part.slice(1, -1)));
      else if (part) nodes.push(document.createTextNode(part));
    }
    return nodes;
  };
  const blocks = [];
  let list = null;
  for (const raw of String(text).split(/\n/)) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!list) { list = el(/^\d/.test(line) ? 'ol' : 'ul', 'rich-list'); blocks.push(list); }
      const li = el('li');
      li.append(...inline(item[1]));
      list.append(li);
      continue;
    }
    list = null;
    if (!line) continue;
    const p = el('p', 'rich-p');
    p.append(...inline(line.replace(/^#+\s*/, '')));
    blocks.push(p);
  }
  return blocks;
}
