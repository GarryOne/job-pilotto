// Jobs: the list, adding jobs and messages, questions to answer once.
import {closeMenu, el, moreButton, pill, tag} from '../components.js';
import {looksLikeLink, matches} from '../filter.js';
import {icon} from '../icons.js';
import {ago, applicationStats, avatar, band, byStat, inProcess, isStuck, matchLabel, placeAndMode, sorted, stats, statusPill, tags, workMode} from '../jobs-view.js';
import {shared} from './shared.js';
import {openActivity, refreshActivity, showSearchStatus} from './activity.js';
import {$, message, savedAgo, show} from './core.js';
import {openSession} from './session-log.js';
import {SESSION_PILL, refreshSessions, removeSession, sessionFor, sessionJob, sessionList} from './sessions.js';
import {toastMessage} from './startup.js';
import {openFeedback} from './feedback.js';

let jobsLoading = false;  // the first load from Notion is under way: the list keeps its spinner
let leftOpenAsked = false;  // the start-up question about sessions left open was asked (once per launch)
let statFilter = null;  // the counter clicked above the list: 'applied', 'waiting', 'interviews', 'closed', 'high', 'week', 'companies', 'stuck' or null
// Apply with Claude: offered (and recommended) when Claude Code is installed and Notion is connected.
let claudeReady = false;
const claudeStarted = new Set();
export const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');
// Applying, with no session open for it: one to settle (banner on Jobs).
const stuck = job => isStuck(job, entry => sessionList.some(item => pageKey(item.url) === pageKey(entry.url)));
function renderStuck() {
  const count = shared.allJobs.filter(stuck).length;
  show($('jobs-stuck'), count > 0);
  $('jobs-stuck-text').textContent = `${count} job${count === 1 ? ' is' : 's are'} still marked Applying but ${count === 1 ? 'has' : 'have'} no open session. Did you submit ${count === 1 ? 'it' : 'them'}?`;
}

// Pill tones: where a job stands, and how it's worked.
const MODE_TONE = {remote: 'good', hybrid: 'info'};
// Work in progress on a job (redrafting its kit, tailoring its CV), shown on its row while the menu is closed.
const busyNotes = new Map();

// Why a fit score: its five parts (risk: lower is better), what speaks for the job and what against.
const PARTS = [['role_fit', 'Role'], ['location', 'Location'], ['compensation', 'Pay'], ['growth', 'Growth'], ['risk', 'Risk']];
function fitDetail(job) {
  const {parts = {}, strengths = '', gaps = ''} = job.fit_detail || {};
  const box = el('div', 'fit-detail');
  const scores = el('div', 'fit-parts');
  for (const [key, label] of PARTS) {
    if (parts[key] == null) continue;
    const good = key === 'risk' ? 100 - parts[key] : parts[key];
    const part = el('span', `fit-part ${band(good)}`);
    part.append(el('b', '', String(parts[key])), el('span', 'muted small', key === 'risk' ? `${label} (lower is better)` : label));
    scores.append(part);
  }
  const list = (title, text, tone) => {
    const items = String(text || '').split(/;\s+/).filter(Boolean);
    if (!items.length) return [];
    const section = el('div', `fit-list tone-${tone}`);
    const ul = el('ul');
    ul.append(...items.map(item => el('li', '', item)));
    section.append(el('b', '', title), ul);
    return [section];
  };
  box.append(el('b', 'fit-detail-title', `Why ${job.fit}`), ...(job.reason ? [el('p', 'muted', job.reason)] : []), scores,
    ...list('For you', strengths, 'good'), ...list('Against', gaps, 'warn'));
  return box;
}
export function renderJobs() {
  closeMenu();
  const filter = $('filter-status').value;
  const text = $('filter-text').value.trim();
  // A pasted link finds that job whatever its status; words filter within the chosen status.
  const anyStatus = looksLikeLink(text);
  const rows = sorted((statFilter === 'stuck' ? shared.allJobs.filter(stuck) : byStat(shared.allJobs, statFilter)).filter(job => (anyStatus || filter === 'all' || (filter === 'open' ? job.status === 'unreviewed' : job.status === filter)) &&
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
    fit.title = job.fit == null ? 'Not scored yet: no description to read, or excluded by your filters' : 'Why this score? Click to see';
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
      if (next === 'applied' && job.stage === 'Applying') job.stage = 'Applied';
      renderJobs();
    };
    // Chrome opens the job's form and the extension fills it at once from the kit.
    const fillInChrome = async button => {
      const result = await window.pilot.applyOne(job.url);
      if (result.ok) { shared.openedInChrome.add(pageKey(job.url)); renderJobs(); } else if (button) button.textContent = 'No link';
      else toastMessage('Could not open the job', 'It has no link.');
    };
    if (job.status !== 'applied' && job.url && job.kit) {
      // Stays "Opened in Chrome" for the session (until marked applied); a click opens it again.
      const opened = shared.openedInChrome.has(pageKey(job.url));
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
    if (job.page_id) menu.push({label: '💬 Add employer feedback', run: () => openFeedback({...job, job: job.title}, 'receive')});
    if (job.employer_feedback && job.page_id) menu.push({label: '💬 Read employer feedback', run: () => openFeedback({...job, job: job.title}, 'review')});
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
    if (job.stage === 'Applying') {  // the session is over or was closed: say what happened, instead of staying Applying
      menu.push({label: '✅ I submitted it', run: setStatus('applied'), title: 'Mark it Applied in Notion'});
      menu.push({label: '↩ Not submitted', title: 'Back to Kit ready', run: async () => {
        const result = await window.pilot.unapplyJob(job.url).catch(error => ({ok: false, error: error.message}));
        if (!result.ok) { toastMessage('Status not changed', result.error || 'Something went wrong.'); return; }
        job.stage = 'Kit ready';
        renderJobs();
      }});
    } else if (job.status !== 'applied') menu.push({label: 'Mark applied', run: setStatus('applied'), title: 'You applied to this job: track it in Applications'});
    if (job.status !== 'dismissed') menu.push({label: 'Dismiss', run: setStatus('dismissed'), title: 'Not interested: hide this job', danger: true});
    box.append(moreButton(menu, 'More: save, dismiss, kit, posting, tailor CV'));

    row.append(fit, role, company, place, status, box);
    // The score circle opens why: the score's parts, strengths and gaps (Notion Job Matches keeps them).
    if (job.fit != null && job.fit_detail) {
      fit.classList.add('is-clickable');
      fit.addEventListener('click', () => {
        const open = row.querySelector('.fit-detail');
        if (open) { open.remove(); return; }
        row.append(fitDetail(job));
      });
    }
    body.append(row);
  }
  const statLabel = {applied: 'applied', waiting: 'waiting for a reply', interviews: 'in process', closed: 'closed', stuck: 'still marked Applying', high: 'high fit', week: 'new this week', companies: 'one per company'}[statFilter];
  renderStuck();
  $('jobs-count').textContent = `${rows.length} job${rows.length === 1 ? '' : 's'}` + (statLabel ? ` · ${statLabel}` : '');
  document.querySelectorAll('[data-stat]').forEach(card => card.setAttribute('aria-pressed', String((card.dataset.stat === 'total' && !statFilter && filter === 'all') || card.dataset.stat === statFilter)));
  if (jobsLoading && !shared.allJobs.length) { show($('jobs-empty'), false); showLoading(); return; }  // still loading, not empty
  show($('jobs-empty'), rows.length === 0);
  const emptyFor = {saved: 'No saved jobs yet. On any job, <b>⋯ → Save</b> keeps it here for later.',
    applied: 'No applications yet. Apply from a job, or add one you sent elsewhere with <b>+ Applied elsewhere…</b>',
    dismissed: 'No dismissed jobs.'};
  $('jobs-empty').innerHTML = !shared.allJobs.length ? 'No jobs here yet. Click <b>Check for new jobs</b>; the first search takes a few minutes.'
    : anyStatus ? 'That job isn\'t in your list: not found by a search yet, or hidden by your language or company filters.'
    : !text && !statFilter && emptyFor[filter] ? emptyFor[filter]
    : text || statFilter || filter !== 'all' ? 'No job matches this filter.' : 'No open jobs right now.';
}
// Pages Job Pilotto never reads (src/notion/ledger.py NO_FETCH): ask for the title, company and text instead.
const NO_FETCH = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;
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
  const tracked = shared.allJobs.filter(job => job.stage && !['Dismissed', 'Closed'].includes(job.stage))
    .sort((a, b) => `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`));
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  const group = document.createElement('optgroup');
  group.label = 'Your applications';
  tracked.forEach(job => group.append(option(job.url, `${job.company || '—'} · ${job.title} (${job.stage})`)));
  $('lead-target').replaceChildren(option('', 'Find the right job automatically'), option('new', 'A new job'), ...(tracked.length ? [group] : []));
}
// List density: Comfortable (columns) or Compact (one block per job); remembered on this computer.
function setDensity(value) {
  const compact = value === 'compact';
  $('jobs-body').classList.toggle('compact', compact);
  $('jobs-head').hidden = compact;
  document.querySelectorAll('[data-density]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.density === value)));
  try { localStorage.setItem('jobsDensity', value); } catch {}
}
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
  if (shared.allJobs.length) { $('jobs-stats').textContent = 'Refreshing from Notion…'; return; }
  const box = el('div', 'list-loading');
  box.append(el('span', 'spinner'), el('div', '', 'Loading your jobs from Notion…'),
    el('div', 'muted small', 'Job Matches and Applications, usually a few seconds'));
  $('jobs-body').replaceChildren(box);
  $('jobs-stats').textContent = 'Loading from Notion…';
}
let freshJobs = false;
export async function loadJobs() {
  loadQuestions();
  freshJobs = false;
  showLoading();
  jobsLoading = true;
  claudeReady = (await window.pilot.claudeReady().catch(() => ({ok: false}))).ok;
  try {
    // The last good list at once (lib/view-cache.js), then the fresh one from Notion replaces it.
    if (!shared.allJobs.length) {
      const saved = await window.pilot.cached('jobs');
      if (saved?.result?.jobs) { showJobsData(saved.result); jobsLoading = false; renderJobs(); $('jobs-stats').textContent += ` · saved ${savedAgo(saved.at)}, updating…`; jobsLoading = true; }
    }
    const fresh = await window.pilot.jobs();
    showJobsData(fresh);
    freshJobs = !fresh.stale;  // from Notion now, not the cache: safe to ask about what's still Applying
  } catch (error) {
    $('jobs-stats').textContent = `Couldn't read your jobs: ${error.message}`;
  }
  jobsLoading = false;
  renderJobs();
  if (freshJobs) askAboutLeftOpen();
}
// Once per launch, on fresh data: sessions left open by the last run whose jobs are still Applying. Keep them, go
// through them one by one (the "Did you submit?" question), or reset them all to Kit ready.
async function askAboutLeftOpen() {
  if (leftOpenAsked || jobsLoading || !shared.allJobs.length) return;
  await refreshSessions();
  const open = sessionList.filter(item => item.askAtStart && sessionJob(item).stage === 'Applying');
  leftOpenAsked = true;
  if (!open.length) return;
  const answer = await window.pilot.sessionsLeftOpen(open.map(item => item.id));
  if (answer?.kept) toastMessage(`${answer.kept} application${answer.kept === 1 ? '' : 's'} restored`,
    `${answer.kept === 1 ? 'Its form is' : 'Their forms are'} still open in Chrome: review and submit, or press Resume Claude on the session.`);
  if (answer?.choice === 'each') for (const item of open.filter(entry => answer.asked?.includes(entry.id))) await removeSession(item);
  if (answer?.choice === 'reset') {
    for (const url of answer.reset || []) { const job = shared.allJobs.find(entry => pageKey(entry.url) === pageKey(url)); if (job) job.stage = 'Kit ready'; }
    if (answer.failed?.length) toastMessage('Not all reset', `${answer.failed.length} could not be reset in Notion (${answer.failed[0].error || 'try again'}). They stay in the list.`);
    await refreshSessions();
    renderJobs();
  }
}
function showJobsData(data) {
  {
    shared.allJobs = data.jobs;
    const scored = shared.allJobs.filter(job => job.fit != null).length;
    const count = stats(shared.allJobs, data.total);
    $('jobs-stats').textContent = `${count.total} opportunities matched to your profile` + (data.filtered ? ` · ${data.filtered} hidden` : '') +
      (data.stale ? ' · ⚠️ Notion unreachable: statuses may be out of date' : '');
    $('jobs-stats').title = `${scored} scored by the AI` + (data.filtered ? `; ${data.filtered} hidden by your language or company filters` : '');
    $('stat-total').textContent = count.total;
    $('stat-high').textContent = count.high;
    $('stat-week').textContent = count.week;
    $('stat-companies').textContent = count.companies;
    const applications = applicationStats(shared.allJobs);
    for (const kind of Object.keys(applications)) $(`stat-${kind}`).textContent = applications[kind];
    const talking = inProcess(shared.allJobs);
    document.querySelector('[data-stat="interviews"]').title = `Now: ${talking.screening} screening · ${talking.interviews} interviewing or offer.`;
    document.querySelector('[data-stat="applied"]').title = 'Applications sent = waiting for a reply + in process + closed. Forms still being filled are sessions, not counted here.';
    document.querySelector('[data-stat="waiting"]').title = 'Sent, no answer yet (Applied, Confirmation received).';
    document.querySelector('[data-stat="closed"]').title = 'Rejected, withdrawn, or no answer after the waiting time.';
    renderStuck();
  }
}

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

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('jobs-stuck-show').addEventListener('click', () => {
    statFilter = 'stuck';
    $('filter-status').value = 'all';
    renderJobs();
  });
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
  document.querySelectorAll('[data-density]').forEach(button => button.addEventListener('click', () => setDensity(button.dataset.density)));
  try { setDensity(localStorage.getItem('jobsDensity') || 'comfortable'); } catch { setDensity('comfortable'); }
  $('filter-status').addEventListener('change', renderJobs);
  $('filter-text').addEventListener('input', renderJobs);

  // ---------- questions to answer once ----------
  // The start-up move to Notion can finish after the first read: read them again then.
  window.pilot.onMoved(steps => { if (steps.includes('open questions')) loadQuestions(); });

  window.pilot.onLog(line => {
    if (shared.idleSeen || /^Searching job boards/.test(line)) { shared.logLines = []; shared.idleSeen = false; shared.selectedRun = null; }
    shared.logLines.push(line);
    refreshActivity();
  });
  $('search-status').addEventListener('click', () => openActivity(true));
  $('refresh').addEventListener('click', async () => {
    $('refresh').disabled = true;  // the header status shows "Checking for new jobs →" meanwhile
    shared.selectedRun = null;
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
}
