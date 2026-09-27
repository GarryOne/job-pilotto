// The window: setup wizard on first run, then Jobs, Strategy and Settings.
// It only talks to the app through window.pilot (preload.cjs); it never sees a key's value.
const $ = id => document.getElementById(id);
const STEPS = ['welcome', 'ai', 'cv', 'goals', 'draft', 'extras'];
let state = await window.pilot.state();
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

$('ai-save').addEventListener('click', async () => {
  const key = $('anthropic-key').value.trim();
  if (!key.startsWith('sk-ant-')) { message('ai-message', 'Anthropic keys start with sk-ant-. Copy the whole key.', 'error'); return; }
  $('ai-save').disabled = true;
  message('ai-message', 'Checking the key…');
  const result = await window.pilot.checkAnthropic(key);
  $('ai-save').disabled = false;
  if (!result.ok) { message('ai-message', result.error, 'error'); return; }
  state.secrets = await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
  $('anthropic-key').value = '';
  message('ai-message', 'Saved ✓', 'ok');
  goStep('cv');
});
$('ai-skip').addEventListener('click', () => goStep('cv'));

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
  try {
    draft = await window.pilot.draftStrategy(answers);
  } catch (error) {
    show($('draft-loading'), false);
    $('draft-error').textContent = `Couldn't draft your strategy: ${error.message.replace(/^Error invoking remote method '[^']+': /, '')}`;
    show($('draft-error'));
    return;
  }
  show($('draft-loading'), false); show($('draft-view'));
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
$('goals-next').addEventListener('click', buildDraft);
$('draft-again').addEventListener('click', buildDraft);
$('draft-save').addEventListener('click', async () => {
  await window.pilot.saveStrategy({...draft, profile_markdown: $('draft-profile').value, answers_markdown: $('draft-answers').value});
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
}
$('finish').addEventListener('click', finishSetup);

// ---------- app ----------
function openView(name) {
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  if (name === 'strategy') loadStrategy();
  if (name === 'settings') loadSettings();
}
document.querySelectorAll('.nav').forEach(nav => nav.addEventListener('click', () => openView(nav.dataset.view)));

function renderJobs() {
  const filter = $('filter-status').value;
  const text = $('filter-text').value.trim().toLowerCase();
  const rows = allJobs.filter(job => (filter === 'all' || (filter === 'open' ? job.status === 'unreviewed' : job.status === filter)) &&
    (!text || `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(text)));
  const body = $('jobs-body');
  body.replaceChildren();
  for (const job of rows.slice(0, 300)) {
    const tr = document.createElement('tr');
    const fit = document.createElement('td');
    const badge = Object.assign(document.createElement('span'), {className: 'fit', textContent: job.fit ?? '–'});
    if (job.fit >= 70) badge.classList.add('high'); else if (job.fit >= 50) badge.classList.add('mid');
    badge.title = job.fit == null ? 'Not scored yet (needs the AI key)' : 'Fit with your profile, out of 100';
    fit.append(badge);
    const role = document.createElement('td');
    role.className = 'role';
    const link = Object.assign(document.createElement('a'), {href: '#', textContent: job.title});
    link.addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal(job.url); });
    role.append(link);
    if (job.reason) role.append(Object.assign(document.createElement('div'), {className: 'reason', textContent: job.reason}));
    const company = Object.assign(document.createElement('td'), {textContent: job.company});
    const place = Object.assign(document.createElement('td'), {textContent: job.location});
    const status = document.createElement('td');
    status.append(Object.assign(document.createElement('span'), {className: `status ${job.status}`,
      textContent: {unreviewed: 'New', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed'}[job.status] || job.status}));
    const actions = document.createElement('td');
    const box = Object.assign(document.createElement('div'), {className: 'row-actions'});
    const action = (label, next) => {
      const button = Object.assign(document.createElement('button'), {className: 'secondary', textContent: label});
      button.addEventListener('click', async () => { await window.pilot.setStatus(job.url, next); job.status = next; renderJobs(); });
      box.append(button);
    };
    if (job.status !== 'saved') action('⭐ Save', 'saved');
    if (job.status !== 'applied') action('✅ Applied', 'applied');
    if (job.status !== 'dismissed') action('✕', 'dismissed');
    actions.append(box);
    tr.append(fit, role, company, place, status, actions);
    body.append(tr);
  }
  show($('jobs-empty'), rows.length === 0);
}
$('filter-status').addEventListener('change', renderJobs);
$('filter-text').addEventListener('input', renderJobs);

async function loadJobs() {
  try {
    const data = await window.pilot.jobs();
    allJobs = data.jobs;
    const scored = allJobs.filter(job => job.fit != null).length;
    $('jobs-stats').textContent = `${data.total} open · ${scored} scored · ${allJobs.filter(j => j.fit >= 70).length} strong matches` +
      (data.filtered ? ` · ${data.filtered} hidden (language or company)` : '');
  } catch (error) {
    $('jobs-stats').textContent = `Couldn't read your jobs: ${error.message}`;
  }
  renderJobs();
}

window.pilot.onLog(line => {
  const log = $('log');
  show(log);
  log.textContent += line + '\n';
  log.scrollTop = log.scrollHeight;
});
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  $('refresh').textContent = 'Searching…';
  $('log').textContent = '';
  try {
    const result = await window.pilot.refresh();
    $('log').textContent += result.ok ? '\nDone.\n' : '\nFinished with problems; see above.\n';
  } finally {
    $('refresh').disabled = false;
    $('refresh').textContent = 'Find new jobs';
    loadJobs();
  }
});

$('apply-open').addEventListener('click', () => { message('apply-message', ''); $('apply-dialog').showModal(); });
$('apply-go').addEventListener('click', async event => {
  event.preventDefault();
  const mode = document.querySelector('input[name="apply-mode"]:checked').value;
  const result = await window.pilot.apply({n: $('apply-n').value, mode});
  message('apply-message', result.ok ? result.message : result.error, result.ok ? 'ok' : 'error');
});

async function loadStrategy() {
  const text = await window.pilot.profileText();
  $('strategy-profile').value = text.profile;
  $('strategy-answers').value = text.answers;
  message('strategy-message', '');
}
$('strategy-save').addEventListener('click', async () => {
  await window.pilot.saveProfileText({profile: $('strategy-profile').value, answers: $('strategy-answers').value});
  message('strategy-message', 'Saved ✓ New jobs are scored against it from the next search.', 'ok');
});
$('strategy-redo').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('goals'); });

async function loadSettings() {
  state = await window.pilot.state();
  document.querySelectorAll('[data-secret]').forEach(line => {
    const set = state.secrets[line.dataset.secret];
    line.textContent = set ? '✓ Connected' : 'Not set';
    line.classList.toggle('on', set);
  });
  const ext = await window.pilot.extensionInfo();
  $('ext-url').textContent = ext.url;
  $('ext-token').textContent = ext.token;
  $('data-folder').textContent = state.folder;
}
for (const [id, name, check] of [['anthropic', 'ANTHROPIC_API_KEY', true], ['notion', 'NOTION_TOKEN', false], ['serpapi', 'SERPAPI_API_KEY', false]]) {
  $(`set-${id}-save`).addEventListener('click', async () => {
    const value = $(`set-${id}`).value.trim();
    if (!value) return;
    if (check && !(await window.pilot.checkAnthropic(value)).ok) { alertLine(name, 'That key was rejected'); return; }
    await window.pilot.saveSecret(name, value);
    $(`set-${id}`).value = '';
    loadSettings();
  });
}
function alertLine(name, text) { const line = document.querySelector(`[data-secret="${name}"]`); line.textContent = text; line.classList.remove('on'); }
$('open-extension-folder').addEventListener('click', () => window.pilot.showFolder('extension'));
$('open-data').addEventListener('click', () => window.pilot.showFolder('data'));
$('rerun-wizard').addEventListener('click', () => { show($('app'), false); show($('wizard')); goStep('welcome'); });

// ---------- start ----------
if (state.settings.setupDone) { show($('app')); loadJobs(); } else { show($('wizard')); goStep('welcome'); }
