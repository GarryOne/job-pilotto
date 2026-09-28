import {looksLikeLink, matches} from './filter.js';
import {icon, fillIcons} from './icons.js';
import {ago, avatar, band, matchLabel, sorted, stats, tags, workMode} from './jobs-view.js';
import {localize, osText as swap} from './os.js';

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
  }
  if (name === 'notion' && notionReady() && !$('notion-key').value) {
    message('notion-message', '✓ Connected to your Job Pilotto workspace. Continue, or paste a new token to reconnect.', 'ok');
  }
  document.querySelectorAll('.step').forEach(step => show(step, step.dataset.step === name));
  document.querySelectorAll('#step-list li').forEach((li, i) => {
    li.classList.toggle('current', i === index);
    li.classList.toggle('done', i < index);
  });
  if (name === 'cv') refreshCv();
}
document.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => goStep('ai')));
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
  const current = STEPS.find(step => !document.querySelector(`.step[data-step="${step}"]`).hidden);
  goStep(STEPS[Math.max(0, STEPS.indexOf(current) - 1)]);
}));

const notionReady = () => !!state.notion && Object.keys(state.notion).length >= 11;

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
$('notion-connect').addEventListener('click', async () => {
  const key = $('notion-key').value.trim();
  if (!key && notionReady()) { goStep('cv'); return; }  // connected earlier: just continue
  if (!key) { message('notion-message', 'Paste the API token from step 2.', 'error'); return; }
  $('notion-connect').disabled = true;
  message('notion-message', 'Looking for your Job Pilotto workspace…', 'waiting');
  const result = await window.pilot.notionConnect(key);
  $('notion-connect').disabled = false;
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
    message('notion-message', 'Connected ✓ Your workspace is ready.', 'ok');
    setTimeout(() => goStep('cv'), 900);
  } else if (result.error) {
    message('notion-message', result.error, 'error');
  } else if (result.missing?.length) {
    message('notion-message', 'The connection can\'t see these pages yet. Check step 1 (Duplicate) and step 3 (Content access → Edit access → tick Job Pilotto → Save). Just saved it? Notion can take a minute to share every database: Connect again shortly.', 'error');
  } else {
    message('notion-message', `Columns are missing: ${result.problems.map(p => `${p.title} (${p.missing.slice(0, 3).join(', ')})`).join('; ')}. Duplicate the template again rather than editing columns.`, 'error');
  }
});

window.pilot.onNotionProgress(({found, total, ids, titles}) => {
  message('notion-message', `Notion is still sharing your workspace with the connection: ${found} of ${total} found. This can take a minute; the app keeps checking.`, 'waiting');
  const list = $('notion-found');
  list.replaceChildren();
  show(list);
  for (const [env, title] of Object.entries(titles)) {
    list.append(Object.assign(document.createElement('div'), {className: ids[env] ? 'yes' : 'pending', textContent: `${ids[env] ? '✓' : '…'} ${title}`}));
  }
});

window.pilot.onDraftProgress(({part, percent}) => {
  $('draft-part').textContent = part;
  $('draft-percent').textContent = `${percent}%`;
  $('draft-bar').style.width = `${Math.max(2, percent)}%`;
});

window.pilot.onSaveProgress(({page, done, total}) => {
  message('draft-save-message', `Writing your ${page} to Notion: ${Math.round(done / total * 100)}%`, 'waiting');
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
const KIND = {search: {icon: '🔎', name: 'Search'}, mail: {icon: '📧', name: 'Gmail check'}};
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
// One line on what a finished run did.
function outcome(run) {
  if (kindOf(run) === 'mail') {
    if (run.off) return 'Gmail not connected (Settings → Gmail and Calendar)';
    if (!run.ok) return 'had problems';
    return run.updates?.length ? plural(run.updates.length, 'application update') : 'nothing new';
  }
  if (!run.ok) return 'had problems';
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
  $('activity-recent').replaceChildren(...(running ? [{...running, live: true}] : []).concat(runs.slice(0, 8)).map(run => {
    const item = document.createElement('li');
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'recent-row'});
    button.classList.toggle('current', run.live ? !shown : shown ? run.id === shown.id : run === last && !running);
    button.dataset.state = run.live ? 'busy' : run.ok && !run.off ? 'ok' : 'error';
    const kind = KIND[kindOf(run)];
    button.append(Object.assign(document.createElement('span'), {className: 'activity-dot'}),
      Object.assign(document.createElement('span'), {textContent: `${kind.icon} ${kind.name}`}),
      Object.assign(document.createElement('span'), {className: 'muted', textContent: run.live ? 'running now' : `${clockTime(run.endedAt || run.startedAt)} · ${outcome(run)}`}),
      Object.assign(document.createElement('small'), {className: 'muted', textContent: WHO[run.trigger] || run.trigger}));
    button.addEventListener('click', () => { selectedRun = run.live ? null : run.id; renderActivity(lastActivity); });
    item.append(button);
    return item;
  }));
  if (!runs.length && !running) $('activity-recent').append(Object.assign(document.createElement('li'), {className: 'muted', textContent: 'Nothing has run yet.'}));

  // How often: from Settings → How often (the cloud does it when "Keep working while my Mac is off" is on).
  const cloud = !!state?.settings?.cloud?.repo;
  $('activity-schedule').replaceChildren(...[
    cloud ? osText('☁️ Runs in your GitHub repo, even with the Mac off') : null,
    `🔎 Next search: ${nextSearchAt ? soon(nextSearchAt) : cloud ? 'in the cloud' : 'only when you ask'}`,
    `📧 Next Gmail check: ${nextMailAt ? soon(nextMailAt) : cloud ? 'in the cloud' : 'off'}`,
  ].filter(Boolean).map(text => Object.assign(document.createElement('li'), {textContent: text})));

  // The selected run (or the live / latest one): what it did, its phases, and its full log.
  const run = shown || (running ? {...running, live: true} : last);
  const lines = shown ? shown.log || [] : liveLines || last?.log || [];
  const kind = run ? KIND[kindOf(run)] : null;
  $('activity-selected').textContent = !run ? '' : run.live ? `${kind.icon} ${kind.name}, running now` :
    `${kind.icon} ${kind.name} · ${clockTime(run.startedAt)} (${WHO[run.trigger] || run.trigger}) · ${outcome(run)}`;
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
  $('activity-toggle').setAttribute('aria-expanded', open);
  if (open) $('log').scrollTop = $('log').scrollHeight;
}
$('activity-toggle').addEventListener('click', () => openActivity($('activity-panel').hidden));
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

function renderDraft() {
  show($('draft-loading'), false); show($('draft-error'), false); show($('draft-view'));
  $('draft-summary').textContent = draft.summary;
  for (const id of ['chips-roles', 'chips-places', 'chips-queries', 'chips-languages']) $(id).replaceChildren();
  draft.search.role_keywords.forEach(k => chip($('chips-roles'), readable(k)));
  [...draft.search.locations.top_tier, ...draft.search.locations.country_wide.slice(0, 4), ...draft.search.locations.abroad]
    .forEach(k => chip($('chips-places'), readable(k)));
  draft.search.jobs_board_search_queries.forEach(k => chip($('chips-queries'), k));
  draft.preferences.disqualifying_languages.forEach(k => chip($('chips-languages'), k));
  const open = $('open-questions');
  show(open, draft.open_questions.length > 0);
  open.querySelector('ul').replaceChildren(...draft.open_questions.map(q => Object.assign(document.createElement('li'), {textContent: q})));
  $('draft-profile').value = draft.profile_markdown;
  $('draft-answers').value = draft.answers_markdown;
  $('draft-cost').textContent = `Drafted by Claude for about USD ${draft.usd.toFixed(2)}.`;
  $('draft-save').disabled = false;
}
// Same answers as the cached draft: show it again (no new Claude call). Changed answers or "Draft again": redraft.
async function toDraft() {
  const cached = await window.pilot.cachedDraft();
  if (cached && JSON.stringify(cached.answers) === JSON.stringify(currentAnswers())) {
    draft = cached.draft;
    goStep('draft');
    renderDraft();
    return;
  }
  buildDraft();
}
let editsTimer;
for (const [id, field] of [['draft-profile', 'profile_markdown'], ['draft-answers', 'answers_markdown']]) {
  $(id).addEventListener('input', () => {
    clearTimeout(editsTimer);
    editsTimer = setTimeout(() => window.pilot.cacheDraftEdits({[field]: $(id).value}), 400);
  });
}
$('goals-next').addEventListener('click', toDraft);
$('draft-again').addEventListener('click', buildDraft);
$('draft-save').addEventListener('click', async () => {
  // Writing the pages to Notion takes a while (one request per block): lock the buttons and show progress.
  const buttons = [$('draft-save'), $('draft-again'), ...document.querySelectorAll('.step[data-step="draft"] [data-back]')];
  buttons.forEach(button => { button.disabled = true; });
  message('draft-save-message', 'Saving your strategy to Notion…', 'waiting');
  const result = await window.pilot.saveStrategy({...draft, profile_markdown: $('draft-profile').value, answers_markdown: $('draft-answers').value});
  buttons.forEach(button => { button.disabled = false; });
  if (!result.ok) { message('draft-save-message', osText(`${result.error} Your strategy is saved on this Mac; try Save again.`), 'error'); return; }
  message('draft-save-message', 'Saved ✓', 'ok');
  state = await window.pilot.state();
  goStep('extras');
});
document.querySelectorAll('[data-goto-settings]').forEach(button => button.addEventListener('click', async () => {
  await finishSetup();
  openView('settings');
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
// Back through the wizard with everything already filled in (keys, Notion, CV, answers, the last draft).
$('rerun-setup').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('welcome'); });

// ---------- app ----------
function openView(name) {
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  if (name === 'strategy') { loadStrategy(); loadCvSetting(); }
  if (name === 'settings') loadSettings();
  if (name === 'interviews') loadInterviews();
}
document.querySelectorAll('.nav').forEach(nav => nav.addEventListener('click', () => openView(nav.dataset.view)));

// Job pages open in Chrome now (reported by the extension; refreshed every 2 s), plus ones just opened here.
let openedInChrome = new Set();
// Apply with Claude: offered (and recommended) when Claude Code is installed and Notion is connected.
let claudeReady = false;
const claudeStarted = new Set();
const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');

// The ⋯ menu of a job row: one floating list, closed by Esc, a click outside, scrolling, or picking an item.
const rowMenu = Object.assign(document.createElement('div'), {className: 'row-menu', hidden: true, role: 'menu'});
document.body.append(rowMenu);
function closeRowMenu() {
  rowMenu.hidden = true;
  document.querySelector('.more[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
}
function openRowMenu(anchor, items) {
  const wasOpen = anchor.getAttribute('aria-expanded') === 'true';
  closeRowMenu();
  if (wasOpen) return;
  rowMenu.replaceChildren(...items.map(item => {
    if (item === '-') return document.createElement('hr');
    const button = Object.assign(document.createElement('button'), {textContent: item.label, title: item.title || '', className: item.danger ? 'danger' : ''});
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', event => { closeRowMenu(); item.run(event); });
    return button;
  }));
  rowMenu.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  const box = anchor.getBoundingClientRect();
  const below = box.bottom + 6 + rowMenu.offsetHeight <= window.innerHeight;
  rowMenu.style.top = `${Math.max(8, below ? box.bottom + 6 : box.top - rowMenu.offsetHeight - 6)}px`;
  rowMenu.style.left = `${Math.max(8, box.right - rowMenu.offsetWidth)}px`;
  rowMenu.querySelector('button')?.focus();
}
document.addEventListener('click', event => { if (!rowMenu.hidden && !event.target.closest('.row-menu, .more')) closeRowMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeRowMenu(); });
document.querySelector('main').addEventListener('scroll', closeRowMenu);

const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? {className} : {}, text != null ? {textContent: text} : {});
// Work in progress on a job (redrafting its kit, tailoring its CV), shown on its row while the menu is closed.
const busyNotes = new Map();

function renderJobs() {
  closeRowMenu();
  const filter = $('filter-status').value;
  const text = $('filter-text').value.trim();
  // A pasted link finds that job whatever its status; words filter within the chosen status.
  const anyStatus = looksLikeLink(text);
  const rows = sorted(allJobs.filter(job => (anyStatus || filter === 'all' || (filter === 'open' ? job.status === 'unreviewed' : job.status === filter)) &&
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
    const statusLabel = {unreviewed: 'New', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed'}[job.status] || job.status;

    const role = el('div', 'role');
    const titleLine = el('div', 'title-line');
    const link = Object.assign(el('a', '', job.title), {href: '#', title: 'Open the posting'});
    link.addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal(job.url); });
    titleLine.append(link, el('span', `status inline ${job.status}`, statusLabel));
    role.append(titleLine);
    // Compact list: company · place · mode · age on one line, in place of those columns.
    const meta = el('div', 'meta');
    const small = avatar(job.company);
    const smallBadge = el('span', 'logo', small.initials);
    smallBadge.style.setProperty('--hue', small.hue);
    meta.append(smallBadge, el('b', '', job.company));
    for (const part of [job.location, job.work_mode && workMode(job.work_mode).label, ago(job.first_seen_at)].filter(Boolean)) {
      meta.append(el('span', 'sep', '·'), el('span', '', part));
    }
    role.append(meta);
    if (job.reason) role.append(Object.assign(el('div', 'reason', job.reason), {title: job.reason}));
    const chips = el('div', 'tags');
    // Three skill tags, the rest behind "+N".
    const skills = tags(job, 8);
    for (const tag of skills.slice(0, 3)) chips.append(el('span', 'tag', tag));
    if (skills.length > 3) chips.append(Object.assign(el('span', 'tag more-tags', `+${skills.length - 3}`), {title: skills.slice(3).join(', ')}));
    if (job.kit && job.notion_url) {
      const kit = Object.assign(el('button', 'tag link-tag', '📝 Kit'), {title: 'Application kit: form answers, cover letter, eligibility (in Notion)'});
      kit.addEventListener('click', event => window.pilot.openNotion(job.notion_url, event.metaKey));
      chips.append(kit);
    }
    if (job.tailored && job.code) {
      const cv = Object.assign(el('button', 'tag link-tag', '📄 Tailored CV'), {title: 'Your CV tailored to this job, with the changes highlighted'});
      cv.addEventListener('click', () => window.pilot.openTailoredCv(job.code));
      chips.append(cv);
    }
    if (busyNotes.has(job.url)) chips.append(el('span', 'tag busy-note', busyNotes.get(job.url)));
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
      line.append(icon('globe'), Object.assign(el('span', `mode ${mode.kind}`, mode.label), {title: job.work_mode}));
      place.append(line);
    }

    const status = el('div', 'status-cell');
    status.append(el('span', `status ${job.status}`, statusLabel));
    // The kit's eligibility verdict: a badge, with the reason on hover.
    if (job.ineligible) {
      const verdict = Object.assign(el('span', 'badge-ineligible tip', '⛔ Not eligible'), {tabIndex: 0});
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
          title: started ? 'A Claude session is filling this one in Terminal: answer it there' :
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
    const more = Object.assign(el('button', 'secondary more'), {title: 'More: save, dismiss, kit, posting, tailor CV'});
    more.setAttribute('aria-label', 'More actions');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.append(icon('more'));
    more.addEventListener('click', () => openRowMenu(more, menu));
    box.append(more);

    row.append(fit, role, company, place, status, box);
    body.append(row);
  }
  $('jobs-count').textContent = `${rows.length} job${rows.length === 1 ? '' : 's'}`;
  show($('jobs-empty'), rows.length === 0);
  $('jobs-empty').innerHTML = !allJobs.length ? 'No jobs here yet. Click <b>Run new search</b>; the first search takes a few minutes.'
    : anyStatus ? 'That job isn\'t in your list: not found by a search yet, or hidden by your language or company filters.'
    : text || filter !== 'all' ? 'No job matches this filter.' : 'No open jobs right now.';
}
$('sort-by').addEventListener('change', renderJobs);
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
async function loadQuestions() {
  const list = await window.pilot.openQuestions();
  show($('questions'), list.length > 0);
  $('questions-list').replaceChildren(...list.map(q => {
    const row = Object.assign(document.createElement('div'), {className: 'question'});
    const label = Object.assign(document.createElement('label'), {textContent: q.question});
    if (q.company) label.append(Object.assign(document.createElement('small'), {textContent: ` · asked by ${q.company}`}));
    const input = Object.assign(document.createElement('input'), {type: 'text', placeholder: 'Your standard answer'});
    const save = Object.assign(document.createElement('button'), {className: 'secondary', textContent: 'Save'});
    const skip = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Skip', title: 'Not a question to keep an answer for'});
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

async function loadJobs() {
  loadQuestions();
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
  const inNotion = !!state.notion?.NOTION_PROFILE_PAGE_ID;
  show($('strategy-notion'), inNotion);
  for (const id of ['strategy-profile', 'strategy-answers', 'strategy-save']) show($(id), !inNotion);
  document.querySelectorAll('label[for="strategy-profile"], label[for="strategy-answers"]').forEach(l => show(l, !inNotion));
  if (inNotion) return;
  const text = await window.pilot.profileText();
  $('strategy-profile').value = text.profile;
  $('strategy-answers').value = text.answers;
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
$('strategy-save').addEventListener('click', async () => {
  await window.pilot.saveProfileText({profile: $('strategy-profile').value, answers: $('strategy-answers').value});
  message('strategy-message', 'Saved ✓ New jobs are scored against it from the next search.', 'ok');
});
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
}
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
  button.disabled = true;
  const result = await window.pilot.command(button.dataset.command);
  button.disabled = false;
  answer(result.text + (result.telegram ? '\n\n(Also sent to Telegram.)' : ''));
}));
$('add-go').addEventListener('click', async () => {
  const url = $('add-url').value.trim();
  if (!/^https?:\/\//.test(url)) { answer('Paste the job link first (it starts with https://).'); return; }
  const result = await window.pilot.command('add', `${url} ${$('add-date').value.trim()}`.trim());
  answer(result.text);
  $('add-url').value = ''; $('add-date').value = '';
});
$('replace-cv').addEventListener('click', async () => {
  const name = await window.pilot.chooseCv();
  if (name) message('strategy-message', `CV replaced: ${name}. Use "Rebuild from CV…" to redraft your strategy from it.`, 'ok');
});

// ---------- start ----------
if (state.settings.setupDone) { show($('app')); loadJobs(); } else {
  show($('wizard'));
  const resume = state.settings.wizardStep || 'welcome';
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

// A delete button that asks once more: the first click changes its label, a second within 4 s deletes.
function confirmButton(label, ask, onConfirm, disabled = false) {
  const button = Object.assign(document.createElement('button'), {className: 'ghost danger', textContent: label, disabled});
  let armed = null;
  button.addEventListener('click', async () => {
    if (!armed) {
      button.textContent = ask;
      armed = setTimeout(() => { armed = null; button.textContent = label; }, 4000);
      return;
    }
    clearTimeout(armed);
    button.disabled = true;
    await onConfirm();
  });
  return button;
}

function renderDrafts(drafts) {
  show($('iv-drafts-block'), drafts.length > 0);
  const STATUS = {new: 'Not transcribed', recording: 'Recording…', transcribing: 'Transcribing…', stopped: 'Stopped: transcribe again',
    failed: 'Failed', ready: 'Transcript ready'};
  $('iv-drafts').replaceChildren(...drafts.map(draft => {
    const row = Object.assign(document.createElement('div'), {className: `iv-draft${draft.id === ivOpen ? ' open' : ''}`});
    const when = new Date(draft.createdAt).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    row.append(Object.assign(document.createElement('b'), {textContent: draft.title}),
      Object.assign(document.createElement('span'), {className: 'muted small', textContent: `${when} · ${STATUS[draft.status] || draft.status}`}));
    const open = Object.assign(document.createElement('button'), {className: 'secondary', textContent: 'Open'});
    open.addEventListener('click', () => openDraft(draft.id));
    const remove = confirmButton('Delete', 'Delete recording?', async () => {
      await iv.discard(draft.id);
      if (ivOpen === draft.id) { ivOpen = null; show($('iv-editor'), false); }
      renderDrafts(await iv.drafts());
    }, draft.status === 'recording' || draft.status === 'transcribing');
    row.append(open, remove);
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
async function loadSaved() {
  const result = await iv.saved();
  if (!result.ok) { $('iv-saved').replaceChildren(); show($('iv-empty')); $('iv-empty').textContent = result.error; return; }
  ivSavedRows = result.interviews;
  show($('iv-empty'), ivSavedRows.length === 0);
  $('iv-empty').textContent = 'No interviews in Notion yet.';
  $('iv-saved').replaceChildren(...ivSavedRows.map(row => {
    const tr = document.createElement('tr');
    const cell = (...children) => { const td = document.createElement('td'); td.append(...children); tr.append(td); return td; };
    cell(row.date || '');
    const title = cell(Object.assign(document.createElement('b'), {textContent: row.title}));
    if (row.next_step) title.append(Object.assign(document.createElement('div'), {className: 'reason', textContent: `Next: ${row.next_step}`}));
    const select = document.createElement('select');
    const job = row.application[0] ? jobForPage(row.application[0]) : null;
    jobOptions(select, job?.url || '', row.application[0] && !job ? 'Linked in Notion (job not in this list)' : 'No job linked');
    if (row.application[0] && !job) select.value = '';
    const pasted = Object.assign(document.createElement('input'), {type: 'url', placeholder: 'https://… then Enter', hidden: true});
    const relink = async url => {
      select.disabled = pasted.disabled = true;
      message('iv-message', 'Linking in Notion…');
      const done = await iv.link(row.id, url);
      select.disabled = pasted.disabled = false;
      message('iv-message', done.ok ? `"${row.title}" is now ${url ? 'linked to that job' : 'not linked to a job'} in Notion.` : done.error, done.ok ? 'ok' : 'error');
      if (done.ok && url && !allJobs.some(job => job.url === url && job.notion_url)) {
        try { allJobs = (await window.pilot.jobs()).jobs; } catch {}  // it was just added to Applications
        loadSaved();
      }
    };
    select.addEventListener('change', () => {
      show(pasted, select.value === PASTE);
      if (select.value === PASTE) pasted.focus(); else relink(select.value);
    });
    pasted.addEventListener('change', () => { if (/^https?:\/\//.test(pasted.value.trim())) relink(pasted.value.trim()); });
    cell(select, pasted);
    cell(row.overall ? Object.assign(document.createElement('span'), {className: `review-tag ${row.overall}`, textContent: `${row.overall}${row.round ? ` · ${row.round}` : ''}`})
      : reviewing.has(row.id) ? Object.assign(document.createElement('span'), {className: 'muted small', textContent: 'Reviewing…'})
        : Object.assign(document.createElement('span'), {className: 'muted small', textContent: 'Not reviewed'}));
    const actions = Object.assign(document.createElement('div'), {className: 'row-actions'});
    if (!row.overall) {
      const review = Object.assign(document.createElement('button'), {className: 'secondary', textContent: 'Review', disabled: reviewing.has(row.id),
        title: 'Claude reviews it question by question (about $0.05); the review is added to the Notion page'});
      review.addEventListener('click', () => reviewRow(row.id));
      actions.append(review);
    }
    const open = Object.assign(document.createElement('button'), {className: 'secondary', textContent: 'Open'});
    open.addEventListener('click', event => window.pilot.openNotion(row.url, event.metaKey));
    const remove = confirmButton('Delete', 'Sure?', async () => {
      const done = await iv.remove(row.id);
      message('iv-message', done.ok ? osText(`Deleted "${row.title}": in Notion's trash for 30 days${done.removed ? ', its recording removed from this Mac' : ''}.`)
        : done.error, done.ok ? 'ok' : 'error');
      loadSaved();
    });
    remove.title = osText("Moves the row to Notion's trash (restorable for 30 days) and deletes its recording on this Mac");
    actions.append(open, remove);
    cell(actions);
    return tr;
  }));
}

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
