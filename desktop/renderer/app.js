import {replaceCell, replaceLine, withLine} from './markdown-edit.js';
import {looksLikeLink, matches} from './filter.js';
import {icon, fillIcons} from './icons.js';
import {ago, applicationStats, avatar, band, byStat, matchLabel, placeAndMode, sorted, stats, statusPill, tags, workMode} from './jobs-view.js';
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
for (const line of document.querySelectorAll('[data-version]')) line.textContent = `Version ${state.about.label}`;
let draft = null;
let allJobs = [];
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
  if (searching) { title.textContent = `Searching now · ${TRIGGER[running.trigger] || running.trigger}`; detail.textContent = running.step; return; }
  if (!lastSearchAt) { title.textContent = 'No search yet'; detail.textContent = ''; return; }
  const last = runs.find(run => (run.kind || 'search') === 'search');
  title.textContent = 'Last search done';
  detail.textContent = `${clockTime(lastSearchAt)}${last?.new != null ? ` · ${last.new} new` : ''}${last?.usd ? ` · $${last.usd.toFixed(2)}` : ''}`;
}

// ---------- activity bar (bottom of every screen) ----------
// Plain-language phases of a search, recognised from its log lines.
const PHASES = [
  {match: /^Searching job boards/, label: 'Job boards (jobs.ch, TechTree)'},
  {match: /^Checking employer career pages/, label: 'Employer career pages, then reading and scoring new jobs'},
];
const KIND = {search: {icon: '🔎', name: 'Search'}, mail: {icon: '📧', name: 'Gmail check'}, insight: {icon: '💡', name: 'Insight'},
  weekly: {icon: '📊', name: 'Weekly report'}, today: {icon: '📋', name: "Today's list"}, scout: {icon: '🔭', name: 'Find employers'}};
const kindOf = run => run?.kind || 'search';
const WHO = {schedule: 'scheduled', you: 'started by you', first: 'first search'};
let logLines = [];      // the running task's lines, live
let idleSeen = true;    // nothing was running at the last check: the next log line starts a new task
let selectedRun = null; // id of the past run picked in "Recent activity"; null = the latest
let lastActivity = null;
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
function renderActivity(data) {
  lastActivity = data;
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
    $('activity-title').textContent = `${kind.icon} ${kind.name} running (${WHO[running.trigger] || running.trigger})`;
    $('activity-step').textContent = running.step || 'Starting…';
    $('activity-meta').textContent = [duration(running.startedAt, new Date().toISOString()), checked && `${checked} companies checked`].filter(Boolean).join(' · ');
  } else if (lastSearch || lastMail) {
    $('activity-title').textContent = lastSearch ? (lastSearch.ok ? 'Last search done' : 'Last search had problems') : 'No search yet';
    $('activity-step').textContent = lastSearch ? `${clockTime(lastSearch.endedAt || lastSearch.startedAt)} · ${outcome(lastSearch)}` +
      (lastSearch.ok ? '' : ' · click to see why') : '';
    $('activity-meta').textContent = [mailNote, nextSearchAt && `Next search ${hhmm(nextSearchAt)}`].filter(Boolean).join(' · ');
  } else {
    $('activity-title').textContent = 'No search yet';
    $('activity-step').textContent = 'Click "Find new jobs" to start one.';
    $('activity-meta').textContent = mailNote;
  }

  // Recent activity: newest first; click one to see its log below.
  const shown = runs.find(run => run.id === selectedRun) || null;
  const recent = (running ? [{...running, live: true}] : []).concat(runs.slice(0, 8));
  $('activity-count').textContent = `${recent.length} recent`;
  $('activity-recent').replaceChildren(...recent.map(run => {
    const item = document.createElement('li');
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'recent-row'});
    button.classList.toggle('current', run.live ? !shown : shown ? run.id === shown.id : run === last && !running);
    button.dataset.state = run.live ? 'busy' : run.ok && !run.off ? 'ok' : 'error';
    const kind = KIND[kindOf(run)];
    // Status circle (✓ / ! / spinner), what ran, when and what it found, who started it.
    button.append(el('span', 'run-status'), el('span', 'run-kind', `${kind.icon} ${kind.name}`),
      el('span', 'muted run-what', run.live ? 'Running now' : `${clockTime(run.endedAt || run.startedAt)} · ${capital(outcome(run))}`),
      pill(capital(WHO[run.trigger] || run.trigger), run.trigger === 'you' ? 'good' : 'neutral'));
    button.addEventListener('click', () => { selectedRun = run.live ? null : run.id; renderActivity(lastActivity); });
    item.append(button);
    return item;
  }));
  if (!runs.length && !running) $('activity-recent').append(Object.assign(document.createElement('li'), {className: 'muted', textContent: 'Nothing has run yet.'}));

  // How often: from Settings → How often (the cloud does it when "Keep working while my Mac is off" is on).
  const cloud = !!state?.settings?.cloud?.repo;
  // A card per scheduled task: what, which day, and the time in large type (or why there's none).
  const slot = (glyph, name, at, none) => {
    const card = el('div', 'ap-slot');
    const words = el('div', '');
    const due = at && at <= Date.now();
    words.append(el('b', '', name), el('small', 'muted', at ? (due ? 'at the next check' : new Date(at).toLocaleDateString([], {weekday: 'short'})) : none));
    card.append(tile(glyph, 'info'), words, el('span', 'ap-time', at ? (due ? 'Due now' : hhmm(at)) : ''));
    return card;
  };
  $('activity-schedule').replaceChildren(...[
    cloud ? el('p', 'muted small', osText('☁️ Runs in your GitHub repo, even with the Mac off')) : null,
    slot('search', 'Next search', nextSearchAt, cloud ? 'In the cloud' : 'Only when you ask'),
    slot('mail', 'Next Gmail check', nextMailAt, cloud ? 'In the cloud' : 'Off'),
  ].filter(Boolean));

  // The selected run (or the live / latest one): what it did, its phases, and its full log.
  const run = shown || (running ? {...running, live: true} : last);
  const lines = shown ? shown.log || [] : liveLines || last?.log || [];
  const kind = run ? KIND[kindOf(run)] : null;
  $('activity-selected').textContent = !run ? '' : run.live ? `${kind.icon} ${kind.name} · running now` :
    `${kind.icon} ${kind.name} · ${clockTime(run.startedAt)} · ${capital(outcome(run))}`;
  show($('activity-notion'), !!run?.notionUrl);
  $('activity-notion').dataset.url = run?.notionUrl || '';
  const updates = !run?.live && kindOf(run) === 'mail' ? run.updates || [] : [];
  const at = run && kindOf(run) === 'search' ? phaseIndex(lines) : -1;
  const live = !!run?.live;
  $('activity-phases').replaceChildren(...(updates.length ? updates.map(text => Object.assign(document.createElement('li'), {className: 'update', textContent: text}))
    : PHASES.map((phase, i) => {
      const status = i < at || (i === at && !live) ? 'done' : i === at ? 'now' : 'todo';
      return Object.assign(document.createElement('li'), {className: status, textContent: phase.label});
    })));
  show($('activity-phases'), updates.length > 0 || at >= 0);
  // The full log stays folded unless the task is running or went wrong (then it's what you want to see).
  const failed = run && !run.live && (!run.ok || run.off);
  if (run && $('activity-log').dataset.for !== String(run.id)) {
    $('activity-log').dataset.for = String(run.id);
    $('activity-log').open = !!run.live || !!failed;
  }
  $('log-count').textContent = lines.length ? `(${plural(lines.length, 'line')})` : '';
  const log = $('log');
  const text = lines.join('\n') || 'Nothing to show yet.';
  if (log.textContent !== text) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.textContent = text;
    if (atBottom) log.scrollTop = log.scrollHeight;  // follow new lines unless the user scrolled up to read
  }
}
$('activity-notion').addEventListener('click', event => {
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
function openActivity(open) {
  show($('activity-panel'), open);
  show($('activity-backdrop'), open);  // dims the page, so the card stands apart from what's behind it
  $('activity').classList.toggle('open', open);
  $('activity-toggle').setAttribute('aria-expanded', open);
  if (open) $('log').scrollTop = $('log').scrollHeight;
}
$('activity-toggle').addEventListener('click', () => openActivity($('activity-panel').hidden));
$('activity-close').addEventListener('click', () => openActivity(false));
$('activity-backdrop').addEventListener('click', () => openActivity(false));
$('activity-manage').addEventListener('click', event => {
  event.preventDefault();
  openActivity(false);
  openView('settings');
  setTimeout(() => $('setting-schedule')?.scrollIntoView({behavior: 'smooth', block: 'start'}), 150);
});
// Close the card with Escape or a click outside it, like a popover.
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('activity-panel').hidden) openActivity(false); });
document.addEventListener('mousedown', event => {
  if (!$('activity-panel').hidden && !$('activity').contains(event.target)) openActivity(false);
});

let wasRunning = false;
setInterval(async () => {
  if ($('app').hidden) return;
  const runsNow = await window.pilot.runs();
  const {running} = runsNow;
  renderActivity(runsNow);
  const tabs = new Set(await window.pilot.openTabs());
  if (tabs.size !== openedInChrome.size || [...tabs].some(url => !openedInChrome.has(url))) { openedInChrome = tabs; renderJobs(); }
  if (wasRunning && !running) loadJobs();  // a search just finished: show its jobs
  wasRunning = !!running;
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
  notice_period: 'q-notice', companies_to_skip: 'q-skip', anything_else: 'q-more'};
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
const titleCase = text => text.replace(/\b\w/g, c => c.toUpperCase()).replace(/\b(Aws|Gcp|Sre|Eks|Ecs|Slo|Ci|Cd)\b/g, w => w.toUpperCase());
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
$('draft-again').addEventListener('click', buildDraft);
async function saveDraft() {
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
  const result = await window.pilot.saveStrategy({...draft, profile_markdown: $('draft-profile').value, answers_markdown: $('draft-answers').value});
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
// First setup: save straight away. Setup done before: say what a new strategy replaces, and ask.
$('draft-save').addEventListener('click', () => {
  if (!state.settings.setupDone) { saveDraft(); return; }
  $('replace-when').textContent = new Date().toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
  $('replace-jobs').textContent = allJobs.length ? `Your ${allJobs.length} open job matches` : 'Your open job matches';
  $('replace-ok').checked = false; $('replace-go').disabled = true;
  $('replace-dialog').showModal();
});
$('replace-ok').addEventListener('change', () => { $('replace-go').disabled = !$('replace-ok').checked; });
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
$('replace-go').addEventListener('click', () => { $('replace-dialog').close(); saveDraft(); });
$('save-retry').addEventListener('click', saveDraft);
$('save-close').addEventListener('click', () => $('save-dialog').close());
$('save-dialog').addEventListener('cancel', event => { if (!$('save-close').hidden) return; event.preventDefault(); });  // no Esc while saving
// "Set up" on the last step: finish the setup, open that Settings card, and offer the way back to the wizard.
document.querySelectorAll('[data-goto-settings]').forEach(button => button.addEventListener('click', async () => {
  await finishSetup();
  openView('settings');
  show($('back-to-setup'));
  $(`setting-${button.dataset.gotoSettings}`).scrollIntoView({behavior: 'smooth'});
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

// ---------- app ----------
function openView(name) {
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  if (name === 'strategy') { loadStrategy(); loadCvSetting(); showCvChanged(); }
  if (name === 'settings') loadSettings();
  if (name === 'interviews') loadInterviews();
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
    const {label: statusLabel, tone: statusTone} = statusPill(job);

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
    if (job.kit && job.notion_url) chips.append(tag('📝 Kit', {title: 'Application kit: form answers, cover letter, eligibility (in Notion)',
      onClick: event => window.pilot.openNotion(job.notion_url, event.metaKey)}));
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
        const started = claudeStarted.has(pageKey(job.url));
        const claude = Object.assign(el('button', `row-main ${started ? 'state-opened' : 'state-apply'}`, started ? 'Claude is applying' : 'Apply with Claude'), {
          disabled: started,
          title: started ? 'A Claude session is filling this one in its window: answer it there' :
            'Recommended. Claude opens the posting in Chrome, follows Apply to the employer\'s site, creates an account there ' +
            'if it asks (password saved in your Keychain) and fills every page from your kit. You solve CAPTCHAs, tick the terms and submit.'});
        claude.addEventListener('click', async () => {
          claude.disabled = true;
          const result = await window.pilot.applyWithClaude(job.url);
          if (result.ok) { claudeStarted.add(pageKey(job.url)); renderJobs(); return; }
          claude.disabled = false;
          claude.title = result.error;
          // The list said there was a kit but Notion has none (removed or redrafting): show Prepare again.
          if (/kit/i.test(result.error || '')) { claude.textContent = 'Prepare first'; loadJobs(); } else claude.textContent = 'Not ready';
        });
        box.append(claude);
        menu.push({label: opened ? '🧩 Fill in Chrome again' : '🧩 Fill in Chrome', run: () => fillInChrome(),
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
      menu.push({label: '↻ Redraft kit', title: 'Draft the kit again from your current Profile and standard answers (~20 s)', run: () =>
        background('↻ Redrafting kit…', async () => {
          const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
          if (result.ok) loadJobs(); else toastMessage('Redraft failed', result.error || 'Try again.');
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
  show($('jobs-empty'), rows.length === 0);
  $('jobs-empty').innerHTML = !allJobs.length ? 'No jobs here yet. Click <b>Run new search</b>; the first search takes a few minutes.'
    : anyStatus ? 'That job isn\'t in your list: not found by a search yet, or hidden by your language or company filters.'
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
  message('applied-message', '');
  $('applied-go').disabled = false;
  $('applied-dialog').showModal();
  $('applied-url').focus();
});
$('applied-go').addEventListener('click', async event => {
  event.preventDefault();
  const url = $('applied-url').value.trim();
  if (!/^https?:\/\//.test(url)) { message('applied-message', 'Paste the job link (it starts with https://).', 'error'); return; }
  $('applied-go').disabled = true;
  message('applied-message', 'Reading the posting and adding it to Notion…', 'waiting');
  const result = await window.pilot.addApplied(url, $('applied-when').value.trim());
  $('applied-go').disabled = false;
  message('applied-message', result.text, result.ok ? 'ok' : 'error');
  if (!result.ok) return;
  $('applied-url').value = ''; $('applied-when').value = '';
  $('filter-status').value = 'applied';  // show it where it now is
  loadJobs();
});
// A recruiter's message: Claude reads it into a recruiter lead in Notion (like /add <message> in Telegram).
let leadShot = null;  // {name, type, data (base64)} of a pasted or dropped screenshot
function setLeadShot(file) {
  if (!file || !/^image\//.test(file.type)) return false;
  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result);
    leadShot = {name: file.name || 'screenshot.png', type: file.type, data: url.slice(url.indexOf(',') + 1)};
    $('lead-shot').src = url;
    $('lead-shot-box').hidden = false;
  };
  reader.readAsDataURL(file);
  return true;
}
function clearLeadShot() { leadShot = null; $('lead-shot').removeAttribute('src'); $('lead-shot-box').hidden = true; }
// Which job?: Claude decides (default), a new job, or one of the applications in Notion.
function leadTargets() {
  const tracked = allJobs.filter(job => job.stage && !['Dismissed', 'Closed'].includes(job.stage))
    .sort((a, b) => `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`));
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  const group = document.createElement('optgroup');
  group.label = 'Your applications';
  tracked.forEach(job => group.append(option(job.url, `${job.company || '—'} · ${job.title} (${job.stage})`)));
  $('lead-target').replaceChildren(option('', 'Let Claude decide (recommended)'), option('new', 'A new job'), ...(tracked.length ? [group] : []));
}
$('lead-open').addEventListener('click', () => {
  message('lead-message', '');
  $('lead-go').disabled = false;
  leadTargets();
  $('lead-dialog').showModal();
  $('lead-text').focus();
});
$('lead-dialog').addEventListener('paste', event => {
  const file = [...(event.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
  if (file && setLeadShot(file)) event.preventDefault();
});
$('lead-dialog').addEventListener('dragover', event => event.preventDefault());
$('lead-dialog').addEventListener('drop', event => {
  const file = [...(event.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
  if (file) { event.preventDefault(); setLeadShot(file); }
});
$('lead-shot-remove').addEventListener('click', clearLeadShot);
$('lead-go').addEventListener('click', async event => {
  event.preventDefault();
  const text = $('lead-text').value.trim();
  if (!leadShot && text.length < 40) { message('lead-message', 'Paste the whole message, or a screenshot of it.', 'error'); return; }
  $('lead-go').disabled = true;
  message('lead-message', 'Claude is reading it and updating Notion…', 'waiting');
  const result = await window.pilot.addLead(text, $('lead-talking').checked, leadShot, $('lead-target').value);
  $('lead-go').disabled = false;
  message('lead-message', result.text, result.ok ? 'ok' : 'error');
  if (!result.ok) return;
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
  claudeReady = (await window.pilot.claudeReady().catch(() => ({ok: false}))).ok;
  try {
    const data = await window.pilot.jobs();
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
  } catch (error) {
    $('jobs-stats').textContent = `Couldn't read your jobs: ${error.message}`;
  }
  renderJobs();
}

window.pilot.onLog(line => {
  if (idleSeen || /^Searching job boards/.test(line)) { logLines = []; idleSeen = false; selectedRun = null; }
  logLines.push(line);
  refreshActivity();
});
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  $('refresh').querySelector('span').textContent = 'Searching…';
  selectedRun = null;
  try {
    await window.pilot.refresh();
  } finally {
    $('refresh').disabled = false;
    $('refresh').querySelector('span').textContent = 'Run new search';
    loadJobs();
    refreshActivity();
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
  const result = await window.pilot.apply({n: $('apply-n').value, mode});
  message('apply-message', result.ok ? result.message : result.error, result.ok ? 'ok' : 'error');
});

async function loadStrategy() {
  state = await window.pilot.state();
  message('strategy-message', '');
}
$('open-profile').addEventListener('click', event => window.pilot.openNotion(state.notion.NOTION_PROFILE_PAGE_ID, event.metaKey));
$('open-answers').addEventListener('click', event => window.pilot.openNotion(state.notion.NOTION_ANSWERS_PAGE_ID, event.metaKey));
$('open-workspace').addEventListener('click', event => window.pilot.openNotion(state.notion.NOTION_MATCHES_DB, event.metaKey));

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
    ? `Last search: ${new Date(state.settings.lastSearchAt).toLocaleString()}${state.settings.lastSearchOk === false ? ' (with problems)' : ''}`
    : 'No search yet.';
  if (state.settings.telegramBot && state.secrets.TELEGRAM_BOT_TOKEN) {
    const line = document.querySelector('[data-secret="TELEGRAM_BOT_TOKEN"]');
    line.textContent = `✓ Connected to @${state.settings.telegramBot}`;
  }
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
  }).catch(error => message('contact-message', `Couldn't read them from Notion: ${error.message}`, 'error'));
  $('contact-cv').textContent = state.settings.cvName ? `now: ${state.settings.cvName}` : 'none yet';
}
$('contact-save').addEventListener('click', async () => {
  const contact = Object.fromEntries([...document.querySelectorAll('[data-contact]')]
    .map(input => [input.dataset.contact, input.value.trim()]).filter(([, value]) => value));
  const result = await window.pilot.saveContact(contact);
  message('contact-message', result.ok ? (state.notion ? 'Saved in your Notion Profile ✓ The extension uses these from the next form it fills.'
    : 'Saved ✓ The extension uses these from the next form it fills.') : result.error, result.ok ? 'ok' : 'error');
});
$('contact-cv-replace').addEventListener('click', async () => {
  const name = await window.pilot.chooseCv();
  if (name) { state = await window.pilot.state(); showContact(); message('contact-message', `CV replaced: ${name}`, 'ok'); }
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
setInterval(() => { if (!document.querySelector('.view[data-view="settings"]').hidden) showExtensionStatus(); }, 10000);

// ---------- how often each job runs ----------
const SCHEDULE_DEFAULTS = {search: 4, kits: 0, insights: 'daily', scout: 'daily', mail: 3};
function showSchedule() {
  const schedule = {...SCHEDULE_DEFAULTS, ...(state.settings.schedule || {})};
  document.querySelectorAll('[data-schedule]').forEach(select => { select.value = String(schedule[select.dataset.schedule]); });
}
document.querySelectorAll('[data-schedule]').forEach(select => select.addEventListener('change', async () => {
  const schedule = {...SCHEDULE_DEFAULTS, ...(state.settings.schedule || {})};
  const value = select.value;
  schedule[select.dataset.schedule] = /^\d+$/.test(value) ? Number(value) : value;
  await window.pilot.saveSettings({schedule});
  state = await window.pilot.state();
  if (!state.settings.cloud?.repo) { message('schedule-message', 'Saved ✓', 'ok'); return; }
  message('schedule-message', `Updating ${state.settings.cloud.repo}…`);
  const result = await window.pilot.cloudConnect();
  message('schedule-message', result.ok ? `Saved ✓ ${result.repo} follows the new schedule.` : result.error, result.ok ? 'ok' : 'error');
}));

// ---------- keep working while the Mac is off (the user's private GitHub repo) ----------
function showCloud() {
  const cloud = state.settings.cloud;
  $('cloud-status').textContent = cloud?.repo
    ? osText(`✓ On: working from ${cloud.repo} on the schedule above, even with the Mac off.`) : 'Off: Job Pilotto works only while this app is open.';
  $('cloud-connect').textContent = cloud?.repo ? 'Update' : 'Turn on';
  $('cloud-open').hidden = $('cloud-off').hidden = !cloud?.repo;
  $('auto-search').disabled = !!cloud?.repo;
  showTelegramCloud();
}

// Telegram buttons while this computer is off (the user's own Cloudflare Worker; lib/telegram-cloud.js).
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
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', async () => {
  openActivity(true);  // feedback at once: what runs and its log, in Recent activity
  button.disabled = true;
  const result = await window.pilot.command(button.dataset.command);
  button.disabled = false;
  answer(result.text + (result.telegram ? '\n\n(Also sent to Telegram.)' : ''));
}));
$('replace-cv').addEventListener('click', async () => {
  const name = await window.pilot.chooseCv();
  if (!name) return;
  message('strategy-message', `CV replaced: ${name}.`, 'ok');
  openCvChange();
});

// ---------- a replaced CV: what follows it (suggested Profile edits, tailoring base, unsent kits), never a rebuild ----------
let cvSuggestions = [];
async function showCvChanged() {
  const change = await window.pilot.cvChange();
  $('cv-changed-text').textContent = `Your CV changed${change.at ? ` on ${new Date(change.at).toLocaleDateString()}` : ''}: review what it changes.`;
  show($('cv-changed'), !!change.at);
}
async function openCvChange() {
  const change = await window.pilot.cvChange();
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
  $('backup-status').textContent = `· ${status.at ? `last ${new Date(status.at).toLocaleString()}` : 'none yet'} · ${where}`;
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
if (state.settings.setupDone && state.notion) { show($('app')); loadJobs(); } else {
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
