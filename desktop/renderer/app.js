import {looksLikeLink, matches} from './filter.js';

// The window: setup wizard on first run, then Jobs, Strategy and Settings.
// It only talks to the app through window.pilot (preload.cjs); it never sees a key's value.
const $ = id => document.getElementById(id);
const STEPS = ['welcome', 'ai', 'notion', 'cv', 'goals', 'draft', 'extras'];
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
  const line = $('search-status');
  line.classList.toggle('busy', !!running);
  if (running) { line.textContent = `Searching now (${TRIGGER[running.trigger] || running.trigger}): ${running.step}`; return; }
  if (!lastSearchAt) { line.textContent = 'No search yet.'; return; }
  const last = runs[0];
  line.textContent = `Last search ${clockTime(lastSearchAt)}${last?.new != null ? ` · ${last.new} new` : ''}${last?.usd ? ` · $${last.usd.toFixed(2)}` : ''}`;
}
let wasRunning = false;
setInterval(async () => {
  if ($('app').hidden) return;
  const {running} = await window.pilot.runs();
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
  if (!result.ok) { message('draft-save-message', `${result.error} Your strategy is saved on this Mac; try Save again.`, 'error'); return; }
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
  if (name === 'strategy') loadStrategy();
  if (name === 'settings') loadSettings();
}
document.querySelectorAll('.nav').forEach(nav => nav.addEventListener('click', () => openView(nav.dataset.view)));

// Job pages open in Chrome now (reported by the extension; refreshed every 2 s), plus ones just opened here.
let openedInChrome = new Set();
// Apply with Claude: offered (and recommended) when Claude Code is installed and Notion is connected.
let claudeReady = false;
const claudeStarted = new Set();
const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');

function renderJobs() {
  const filter = $('filter-status').value;
  const text = $('filter-text').value.trim();
  // A pasted link finds that job whatever its status; words filter within the chosen status.
  const anyStatus = looksLikeLink(text);
  const rows = allJobs.filter(job => (anyStatus || filter === 'all' || (filter === 'open' ? job.status === 'unreviewed' : job.status === filter)) &&
    matches(job, text));
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
    // Open the job: its kit (answers, cover letter, verdict) on its Notion page, or the posting.
    const links = Object.assign(document.createElement('div'), {className: 'job-links'});
    const addLink = (label, open, title) => {
      const a = Object.assign(document.createElement('a'), {href: '#', textContent: label, title});
      a.addEventListener('click', event => { event.preventDefault(); open(event); });
      links.append(a);
    };
    if (job.notion_url) addLink(job.kit ? '📝 Kit' : '🗂 Notion', event => window.pilot.openNotion(job.notion_url, event.metaKey),
      job.kit ? 'Application kit: form answers, cover letter, eligibility (in Notion)' : 'This job in your Notion');
    addLink('↗ Posting', () => window.pilot.openExternal(job.url), 'The job posting');
    if (job.kit && job.code) {
      // Draft the kit again from the current Profile and standard answers (replaces it in Notion).
      addLink('↻ Redraft', async event => {
        const a = event.target;
        if (a.dataset.busy) return;
        a.dataset.busy = '1';
        a.textContent = '↻ Redrafting…';
        const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
        delete a.dataset.busy;
        a.textContent = result.ok ? '↻ Redraft' : '↻ Retry redraft';
        if (result.ok) loadJobs();
      }, 'Draft the kit again from your current Profile and standard answers (~20 s)');
    }
    if (job.code) {
      // A CV tailored to this posting (reworded, reordered bullets from your own CV; the extension uploads it here).
      if (job.tailored) addLink('📄 Tailored CV', () => window.pilot.openTailoredCv(job.code), 'Your CV tailored to this job, with the changes highlighted');
      addLink(job.tailored ? '↻ Re-tailor' : '✂️ Tailor CV', async event => {
        const a = event.target;
        if (a.dataset.busy) return;
        a.dataset.busy = '1';
        const label = a.textContent;
        a.textContent = '✂️ Tailoring…';
        a.classList.add('busy-link');
        const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`);
        delete a.dataset.busy;
        a.classList.remove('busy-link');
        a.textContent = result.ok ? label : '✂️ Retry tailoring';
        if (!result.ok) a.title = result.error;
        if (result.ok) { job.tailored = true; renderJobs(); }
      }, 'Make a version of your CV for this job: bullets reordered and reworded toward the posting, only from facts in your CV (about 1–2 min, ~10–15¢)');
    }
    role.append(links);
    const company = Object.assign(document.createElement('td'), {textContent: job.company});
    const place = Object.assign(document.createElement('td'), {textContent: job.location});
    const status = document.createElement('td');
    status.append(Object.assign(document.createElement('span'), {className: `status ${job.status}`,
      textContent: {unreviewed: 'New', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed'}[job.status] || job.status}));
    // The kit's eligibility verdict: a badge, with the reason on hover.
    if (job.ineligible) status.append(Object.assign(document.createElement('span'), {className: 'badge-ineligible tip', textContent: '⛔ Not eligible',
      tabIndex: 0}));
    status.lastChild?.classList.contains('badge-ineligible') && (status.lastChild.dataset.tip = job.ineligible);
    const actions = document.createElement('td');
    const box = Object.assign(document.createElement('div'), {className: 'row-actions'});
    // Actions read as verbs (the Status column shows where a job stands): no check marks that look like a state.
    const action = (label, next, title) => {
      const button = Object.assign(document.createElement('button'), {className: 'secondary', textContent: label, title});
      button.addEventListener('click', async () => { await window.pilot.setStatus(job.url, next); job.status = next; renderJobs(); });
      box.append(button);
    };
    if (job.status !== 'applied' && job.url && job.kit) {
      // The kit already answered this form: Chrome opens it and the extension fills it at once.
      // Stays "Opened in Chrome" for the session (until marked applied); a click opens it again.
      const opened = openedInChrome.has(pageKey(job.url));
      const fill = Object.assign(document.createElement('button'), {
        className: claudeReady ? `secondary${opened ? ' state-opened' : ''}` : `row-main ${opened ? 'state-opened' : 'state-apply'}`,
        textContent: opened ? 'Opened in Chrome ↻' : claudeReady ? 'Fill in Chrome' : 'Apply',
        title: opened ? 'Open it in Chrome again' : 'Open in Chrome: the extension fills the form from your kit; you review and submit'});
      fill.addEventListener('click', async () => {
        const result = await window.pilot.applyOne(job.url);
        if (result.ok) { openedInChrome.add(pageKey(job.url)); renderJobs(); } else fill.textContent = 'No link';
      });
      if (claudeReady) {
        // Recommended: a Claude session drives Chrome from the posting through the employer's site
        // (its own Apply buttons, sign-up, every page) to a filled form; it asks you for CAPTCHAs.
        const started = claudeStarted.has(pageKey(job.url));
        const claude = Object.assign(document.createElement('button'), {className: `row-main ${started ? 'state-opened' : 'state-apply'}`,
          textContent: started ? 'Claude is applying' : 'Apply with Claude', disabled: started,
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
      }
      box.append(fill);
    } else if (job.status !== 'applied' && job.url && job.code) {
      // No kit yet: draft it first (reads the form's questions, answers each, writes a cover letter).
      const prepare = Object.assign(document.createElement('button'), {className: 'row-main state-prepare', textContent: 'Prepare',
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
    if (job.status !== 'saved') action('Save', 'saved', 'Keep this job on your list');
    if (job.status !== 'applied') action('Mark applied', 'applied', 'You applied to this job: track it in Applications');
    if (job.status !== 'dismissed') action('Dismiss', 'dismissed', 'Not interested: hide this job');
    actions.append(box);
    tr.append(fit, role, company, place, status, actions);
    body.append(tr);
  }
  show($('jobs-empty'), rows.length === 0);
  $('jobs-empty').innerHTML = !allJobs.length ? 'No jobs here yet. Click <b>Find new jobs</b>; the first search takes a few minutes.'
    : anyStatus ? 'That job isn\'t in your list: not found by a search yet, or hidden by your language or company filters.'
    : text || filter !== 'all' ? 'No job matches this filter.' : 'No open jobs right now.';
}
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
const NOTION_LINKS = [['NOTION_MATCHES_DB', '🎯 Job matches'], ['NOTION_APPLICATIONS_DB', '💠 Applications'],
  ['NOTION_EVENTS_DB', '📈 Replies & events'], ['NOTION_INTERVIEWS_DB', '🎤 Interviews'], ['NOTION_INSIGHTS_DB', '💡 Insights'],
  ['NOTION_PIPELINE_PAGE', '📊 Pipeline'], ['NOTION_PROFILE_PAGE_ID', '👤 Profile'], ['NOTION_ANSWERS_PAGE_ID', '📝 Standard answers'],
  ['NOTION_EMPLOYERS_DB', '🌍 Employers'], ['NOTION_CRON_RUNS_DB', '⏱️ Search runs'], ['NOTION_AGENT_RUNS_DB', '🤖 Form fills']];
function renderNotionLinks() {
  const box = $('notion-links');
  box.querySelectorAll('.notion-link').forEach(link => link.remove());
  const links = NOTION_LINKS.filter(([env]) => state.notion?.[env]);
  show(box, links.length > 0);
  for (const [env, label] of links) {
    const link = Object.assign(document.createElement('button'), {className: 'notion-link', textContent: label,
      title: `${state.notionTitles?.[env] || label}: opens in Notion (⌘-click: in a Job Pilotto window)`});
    link.addEventListener('click', event => window.pilot.openNotion(state.notion[env], event.metaKey));
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
  $('cv-state').textContent = status.base ? (status.custom ? 'Using your own design (style.css).' : 'Using the default design.')
    : 'Not read yet: it happens the first time you tailor, or now.';
  $('cv-view').hidden = !status.base;
  $('cv-import').textContent = status.base ? 'Read my CV PDF again' : 'Read my CV PDF';
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
  loadCvSetting();
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
  const contact = state.settings.contact || {};
  document.querySelectorAll('[data-contact]').forEach(input => { input.value = contact[input.dataset.contact] || ''; });
  $('contact-cv').textContent = state.settings.cvName ? `now: ${state.settings.cvName}` : 'none yet';
}
$('contact-save').addEventListener('click', async () => {
  const contact = Object.fromEntries([...document.querySelectorAll('[data-contact]')]
    .map(input => [input.dataset.contact, input.value.trim()]).filter(([, value]) => value));
  state.settings = await window.pilot.saveSettings({contact});
  message('contact-message', 'Saved ✓ The extension uses these from the next form it fills.', 'ok');
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
    ? `✓ On: working from ${cloud.repo} on the schedule above, even with the Mac off.` : 'Off: Job Pilotto works only while this app is open.';
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
let transcript = null;
$('interview-file').addEventListener('click', async () => {
  transcript = await window.pilot.chooseTranscript();
  $('interview-file-name').textContent = transcript ? transcript.split('/').pop() : '';
});
$('interview-go').addEventListener('click', async () => {
  const label = $('interview-label').value.trim();
  const notes = $('interview-notes').value.trim();
  if (!transcript && notes.length < 40) { answer('Choose a transcript file, or paste a few lines of notes.'); return; }
  await window.pilot.reviewInterview({path: transcript, label, notes});
  answer('Reviewing the interview (about a minute). The review lands in Notion 🎤 Interviews' +
    (state.settings.telegramChatId ? ' and in Telegram.' : '; progress shows above.'));
  transcript = null; $('interview-file-name').textContent = ''; $('interview-notes').value = '';
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
window.pilot.onToast(({title, body, hint}) => {
  const toast = Object.assign(document.createElement('div'), {className: 'toast'});
  toast.append(Object.assign(document.createElement('b'), {textContent: title}), Object.assign(document.createElement('span'), {textContent: body}));
  if (hint) toast.append(Object.assign(document.createElement('small'), {textContent:
    'macOS notifications are off for this app: System Settings → Notifications → Electron (or Job Pilotto) → Allow notifications.'}));
  toast.addEventListener('click', () => toast.remove());
  $('toasts').append(toast);
  setTimeout(() => toast.remove(), hint ? 20000 : 8000);
});

// Help improve Job Pilotto (opt-in anonymous form reports).
$('share-reports').addEventListener('change', async () => { state.settings = await window.pilot.saveSettings({shareFillReports: $('share-reports').checked}); });
