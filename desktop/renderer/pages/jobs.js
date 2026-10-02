// Jobs: the list, adding jobs and messages, questions to answer once.
import {closeMenu, el, moreButton, pill, tag, tile} from '../components.js';
import {isInbound} from '../origin.js';
import * as confirmStep from '../lead-confirm.js';
import {looksLikeLink, matches} from '../filter.js';
import {icon} from '../icons.js';
import {ago, applicationStats, avatar, band, byFilter, byStat, inConversation, inboundCount, inProcess, inStatus, isStuck, matchesOnly, matchLabel, placeAndMode, prepareState, preparing, sorted, statClick, statPressed, stats, statusPill, tags, toReview, workMode} from '../jobs-view.js';
import {shared} from './shared.js';
import {openActivity, refreshActivity, showJob, showSearchStatus} from './activity.js';
import {jobActions, jobHeadline} from '../job-link.js';
import {$, message, osPick, savedAgo, show} from './core.js';
import {openSession} from './session-log.js';
import {SESSION_PILL, refreshSessions, removeSession, sessionFor, sessionJob, sessionList, sessionsLoaded} from './sessions.js';
import {toastMessage} from './startup.js';
import {openFeedback} from './feedback.js';

let jobsLoading = false;  // the first load from Notion is under way: the list keeps its spinner
let leftOpenAsked = false;  // the start-up question about sessions left open was asked (once per launch)
let statFilter = null;  // the counter clicked above the list: 'applied', 'waiting', 'interviews', 'closed', 'high', 'companies', 'stuck' or null (Inbound picks the menu's filter)
// Apply with Claude: offered (and recommended) when Claude Code is installed and Notion is connected.
let claudeReady = false;
let extensionHere = true;   // the Chrome extension is part of this app (downloaded for a license or a trial); else Apply with Claude is the main button
const claudeStarted = new Set();
export const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');
// The whole link, #part included: recruiter leads differ only there (linkedin.com/messaging/#jp-…, a Gmail thread).
// Exported: the activity panel counts how many of a run's matches this list really holds (pages/activity.js).
export const fullKey = url => String(url || '').trim().replace(/\/$/, '');
// Applying, with no session open for it: one to settle (banner on Jobs).
const stuck = job => isStuck(job, entry => sessionList.some(item => pageKey(item.url) === pageKey(entry.url)));
function renderStuck() {
  // Not before the sessions are known: with none loaded yet every Applying job would look abandoned for a moment.
  const count = sessionsLoaded ? shared.allJobs.filter(stuck).length : 0;
  show($('jobs-stuck'), count > 0);
  $('jobs-stuck-text').textContent = `${count} job${count === 1 ? ' is' : 's are'} still marked Applying but ${count === 1 ? 'has' : 'have'} no open session. Did you submit ${count === 1 ? 'it' : 'them'}?`;
}

// Pill tones: where a job stands, and how it's worked.
const MODE_TONE = {remote: 'good', hybrid: 'info'};
// Work in progress on a job (redrafting its kit, tailoring its CV), shown on its row while the menu is closed.
const busyNotes = new Map();

// Match analysis (the panel a score ring opens): the score's four parts as bars, risk on its own line (lower is
// better), then what speaks for the job and what against. Notion Job Matches keeps all of it.
const PARTS = [['role_fit', 'Role fit'], ['location', 'Location'], ['compensation', 'Pay fit'], ['growth', 'Growth']];
const FIT_LISTS = [['good', 'Why it fits', 'strengths'], ['warn', 'What to check', 'gaps']];
// One of those two lists: a circled tick (or bang) and a line each, on the tone's soft background.
function fitCard(tone, title, text) {
  const items = String(text || '').split(/;\s+/).filter(Boolean);
  if (!items.length) return null;
  const card = el('div', `fit-card tone-${tone}`);
  const ul = el('ul');
  ul.append(...items.map(item => {
    const li = el('li');
    const mark = el('span', 'fit-mark');
    mark.append(icon(tone === 'good' ? 'check-circle' : 'bang-circle'));
    li.append(mark, el('span', '', item));
    return li;
  }));
  card.append(el('b', 'fit-card-title', title), ul);
  return card;
}
function fitDetail(job, close) {
  const {parts = {}, strengths = '', gaps = ''} = job.fit_detail || {};
  const box = el('div', 'fit-detail');
  const head = el('div', 'fit-head');
  head.append(el('b', 'fit-title', 'Match analysis'));
  // The second way to close it, next to the ring (Collapse: the standard wording for one).
  const collapse = Object.assign(el('button', 'fit-collapse', 'Collapse'), {type: 'button'});
  collapse.append(icon('chevron'));
  collapse.addEventListener('click', close);
  head.append(collapse);
  const lead = el('div', 'fit-lead');
  lead.append(head);
  if (job.reason) lead.append(el('p', 'fit-summary', job.reason));
  box.append(lead);
  const metrics = PARTS.filter(([key]) => parts[key] != null).map(([key, label]) => {
    const cell = el('div', `fit-metric ${band(parts[key])}`);
    cell.style.setProperty('--p', parts[key]);
    const value = el('span', 'fit-metric-value');
    value.append(el('b', '', String(parts[key])), el('span', 'muted', '/ 100'));
    const track = el('span', 'fit-bar');
    track.append(el('span', 'fit-bar-fill'));
    cell.append(el('span', 'fit-metric-label', label), value, track);
    return cell;
  });
  if (metrics.length) {
    const strip = el('div', 'fit-metrics');
    strip.append(...metrics);
    box.append(strip);
  }
  if (parts.risk != null) {
    const risk = el('p', `fit-risk ${band(100 - parts.risk)}`);
    risk.append(icon('alert'), el('b', 'fit-risk-label', 'Risk'), el('b', '', String(parts.risk)),
      el('span', 'muted', '/ 100 · Lower is better'));
    box.append(risk);
  }
  const cards = FIT_LISTS.map(([tone, title, key]) => fitCard(tone, title, key === 'strengths' ? strengths : gaps)).filter(Boolean);
  if (cards.length) {
    const row = el('div', 'fit-cards');
    row.append(...cards);
    box.append(row);
  }
  return box;
}
document.addEventListener('sessions-loaded', () => renderStuck());
const COUNTS_ALL = new Set(['applied', 'waiting', 'interviews', 'closed']);
// In conversation: the opportunities that found you and are still open, one Focus-style row each; a click opens the
// job in Notion (⌘-click: in a Job Pilotto window), or its link when it has no page.
// It gives way to the list whenever the list is narrowed to something (a counter or Focus step clicked, the Inbound or
// Everything menu choice, words typed): the same jobs would show twice.
// Folded or open as you last left it (a click on the bar).
const TALKING_OPEN = 'jobsTalkingOpen';
function renderTalking(narrowed = false) {
  const talking = inConversation(shared.allJobs);
  show($('jobs-talking'), talking.length > 0 && !narrowed);
  const found = talking.filter(isInbound).length;
  const mixed = found > 0 && found < talking.length;  // a tag per row only tells something when both kinds are listed
  $('jobs-talking-count').textContent = `${talking.length} active · ${found} inbound · ${talking.length - found} outbound`;
  $('jobs-talking-list').replaceChildren(...talking.map(job => {
    const li = Object.assign(el('li', 'focus-item tone-info'), {tabIndex: 0, role: 'button',
      title: job.notion_url ? 'Open in Notion' : 'Open the link'});
    const round = el('span', 'focus-round');
    round.append(icon('chat'));
    const top = el('div', 'focus-top');
    top.append(el('span', 'focus-headline', job.title || 'Role'), pill(job.stage || 'Recruiter lead', 'info', {dot: true}));
    const meta = el('div', 'focus-meta muted small');
    const who = [job.company, job.via && job.via !== job.company ? `via ${job.via}` : ''].filter(Boolean).join(' ');
    [who, mixed ? (isInbound(job) ? 'Inbound' : 'Outbound') : '', job.next_step ? `Next: ${job.next_step}` : ''].filter(Boolean).forEach((part, i) => {
      if (i) meta.append(el('span', 'sep', '·'));
      meta.append(el('span', '', part));
    });
    const body = el('div', 'focus-body');
    body.append(top, meta);
    li.append(round, body);
    const open = event => (job.notion_url ? window.pilot.openNotion(job.notion_url, event.metaKey) : window.pilot.openExternal(job.url));
    li.addEventListener('click', open);
    li.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); } });
    return li;
  }));
}
export function renderJobs() {
  closeMenu();
  const filter = $('filter-status').value;
  const text = $('filter-text').value.trim();
  // A pasted link finds that job whatever its status; words filter within the chosen status.
  const anyStatus = looksLikeLink(text);
  // The counters count every application (real workload); without one, the menu decides (byFilter): job matches by
  // status, all of them under All matches, the opportunities that found you under Inbound only, both kinds together
  // under Everything (the open ones are also "In conversation" above); a pasted link finds any job.
  const counted = statFilter === 'stuck' ? shared.allJobs.filter(stuck)
    : statFilter?.urls ? shared.allJobs.filter(job => statFilter.urls.has(fullKey(job.url)))
    : statFilter ? byStat(COUNTS_ALL.has(statFilter) ? shared.allJobs : matchesOnly(shared.allJobs), statFilter) : null;
  const by = $('sort-by').value;
  const rows = sorted((counted || (anyStatus ? shared.allJobs : byFilter(shared.allJobs, filter)))
    .filter(job => (!counted || anyStatus || inStatus(job, filter)) && matches(job, text)),
  filter === 'inbound' && !counted && by === 'best' ? 'activity' : by);
  renderTalking(!!counted || filter === 'inbound' || filter === 'everything' || !!text);
  const body = $('jobs-body');
  body.replaceChildren();
  for (const job of rows.slice(0, 300)) {
    const row = el('article', 'job-row');
    // Fit: a ring filled to the score (the compact list adds "Strong match" under it). A row whose score has a
    // breakdown behind it says so with a caret, and the ring opens it.
    const fit = el('div', `fit-cell ${band(job.fit)}`);
    const ring = el('div', 'fit-ring');
    ring.style.setProperty('--p', job.fit ?? 0);
    ring.append(el('span', '', job.fit ?? '–'));
    const canOpen = job.fit != null && !!job.fit_detail;
    const caret = icon('chevron', `icon fit-caret${canOpen ? '' : ' is-hidden'}`);  // on every row: the rings line up
    const ringRow = el('div', 'fit-ring-row');
    ringRow.append(ring, caret);
    fit.append(ringRow, el('span', 'fit-label', matchLabel(job.fit)));
    fit.title = job.fit == null ? 'Not scored yet: no description to read, or excluded by your filters'
      : canOpen ? 'Why this score? Click to see' : matchLabel(job.fit);
    const live = sessionFor(job.url);
    const {label: statusLabel, tone: statusTone} = live && !live.endedAt ? SESSION_PILL[live.status] || statusPill(job) : statusPill(job);

    const role = el('div', 'role');
    const titleLine = el('div', 'title-line');
    // An opportunity that found you has no posting (its link is the email or chat): the title opens its Notion page.
    const inNotion = isInbound(job) && !!job.notion_url;
    const link = Object.assign(el('a', '', job.title), {href: '#', title: inNotion ? 'Open in Notion' : 'Open the posting'});
    link.addEventListener('click', event => { event.preventDefault(); if (inNotion) window.pilot.openNotion(job.notion_url, event.metaKey); else window.pilot.openExternal(job.url); });
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
      const result = await window.pilot.applyOne(job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode});
      if (result.ok) { shared.openedInChrome.add(pageKey(job.url)); renderJobs(); } else if (button) button.textContent = 'No link';
      else toastMessage('Could not open the job', 'It has no link.');
    };
    if (job.status !== 'applied' && job.url && job.kit) {
      // Stays "Opened" for the session (until marked applied); a click opens it again.
      const opened = shared.openedInChrome.has(pageKey(job.url));
      // The easy way is the main button: Chrome opens the form in a normal tab and the extension fills it from the kit.
      // Apply with Claude (a session that drives Chrome through the employer's site, sign-up and every page) is in the
      // ⋯ menu, for pages the extension can't reach on its own.
      const live = claudeReady ? sessionFor(job.url) : null;
      if (live) {
        // A session inside the app: Continue when it waits for you, else View session.
        const open = el('button', `row-main ${live.status === 'input' ? 'state-apply' : 'state-opened'}`, live.status === 'input' ? 'Continue' : 'View session');
        open.title = live.note || 'Open this Claude session';
        open.addEventListener('click', () => openSession(live.id));
        box.append(open);
        menu.push({icon: 'puzzle', label: 'Fill in Chrome', run: () => fillInChrome()});
      } else if (!extensionHere) {
        // No extension in this app: Apply with Claude is the way to apply (Claude Code), and says what is missing when it is not set up.
        const started = claudeStarted.has(pageKey(job.url));
        const claude = Object.assign(el('button', `row-main ${started ? 'state-opened' : 'state-apply'}`, started ? 'Claude is applying' : 'Apply with Claude'), {
          title: claudeReady ? 'Claude opens the posting in Chrome, follows Apply to the employer\'s site, fills every page from your kit; you submit'
            : 'Needs Claude Code installed and signed in: Settings → Apply with Claude'});
        claude.disabled = started;
        claude.addEventListener('click', async () => {
          if (!claudeReady) { toastMessage('Claude Code is needed', 'Install Claude Code and sign in (Settings → Apply with Claude), then press Apply with Claude.'); return; }
          const result = await window.pilot.applyWithClaude(job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode});
          if (result.ok) { claudeStarted.add(pageKey(job.url)); if (result.session) await refreshSessions(); renderJobs(); return; }
          if (/kit/i.test(result.error || '')) { toastMessage('Kit not found', 'Prepare it again.'); loadJobs(); } else toastMessage('Claude could not start', result.error || 'Try again.');
        });
        box.append(claude);
      } else {
        const fill = Object.assign(el('button', `row-main ${opened ? 'state-opened' : 'state-apply'}`, opened ? 'Opened ↻' : 'Apply'), {
          title: opened ? 'Opened in Chrome: click to open it there again' : 'Open in Chrome: the extension fills the form from your kit; you review and submit'});
        fill.addEventListener('click', () => fillInChrome(fill));
        box.append(fill);
        if (claudeReady) {
          const started = claudeStarted.has(pageKey(job.url));
          menu.push({icon: 'bot', label: started ? 'Claude is applying' : 'Apply with Claude', disabled: started,
            title: started ? 'A Claude session is filling this one in its window: answer it there' :
              'For pages the extension can\'t fill alone: Claude opens the posting in Chrome, follows Apply to the employer\'s site, creates an account there ' +
              'if it asks (password saved in your Keychain) and fills every page from your kit. You solve CAPTCHAs, tick the terms and submit.',
            run: async () => {
              const result = await window.pilot.applyWithClaude(job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode});
              if (result.ok) { claudeStarted.add(pageKey(job.url)); if (result.session) await refreshSessions(); renderJobs(); return; }
              // The list said there was a kit but Notion has none (removed or redrafting): show Prepare again.
              if (/kit/i.test(result.error || '')) { toastMessage('Kit not found', 'Prepare it again.'); loadJobs(); } else toastMessage('Claude could not start', result.error || 'Try again.');
            }});
        }
      }
    } else if (job.status !== 'applied' && job.url && job.code) {
      // No kit yet: draft it first (reads the form's questions, answers each, writes a cover letter).
      const state = prepareState(job);
      const prepare = Object.assign(el('button', 'row-main state-prepare', state === 'failed' ? 'Retry prepare' : state === 'cloud' ? 'Preparing…' : state ? 'Preparing' : 'Prepare'), {
        title: state === 'cloud' ? 'Preparing on GitHub: the list reloads when it is done' : state === 'local' ? 'Drafting the kit: usually 15–30 s'
          : 'Draft the application kit (form answers and cover letter) in your Notion; then Apply'});
      if (state === 'local' || state === 'cloud') { prepare.disabled = true; if (state === 'local') prepare.classList.add('busy', 'state-busy'); }  // spinner only; the fixed width keeps the row still
      prepare.addEventListener('click', async () => {
        preparing.set(job.code, 'local');
        renderJobs();  // the row is rebuilt as Preparing, and stays so through any later re-render
        const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
        // On GitHub (Always on): the row says so; the list reloads when it's done.
        if (result.cloud) preparing.set(job.code, 'cloud');
        else if (result.ok) { preparing.delete(job.code); for (const item of shared.allJobs) if (item.code === job.code) item.kit = true; job.kit = true; }
        else preparing.set(job.code, 'failed');
        renderJobs();
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
    if (job.notion_url) menu.push({icon: job.kit ? 'file-text' : 'layers', label: job.kit ? 'Open kit in Notion' : 'Open in Notion', run: event => window.pilot.openNotion(job.notion_url, event.metaKey),
      title: job.kit ? 'Application kit: form answers, cover letter, eligibility (in Notion)' : 'This job in your Notion'});
    menu.push({icon: 'external', label: isInbound(job) ? 'Open the message' : 'Open posting', run: () => window.pilot.openExternal(job.url), title: isInbound(job) ? 'The email or chat it came from' : 'The job posting'});
    if (job.kit && job.code) {
      // Draft the kit again from the current Profile and standard answers (replaces it in Notion).
      const earlier = String(job.kit_state || '').startsWith('earlier');
      menu.push({icon: 'refresh', label: earlier ? 'Redraft kit (earlier inputs)' : 'Redraft kit',
        title: 'Draft the kit again from your current CV, Profile and standard answers (~20 s, about 4¢); replaces it in Notion', run: () =>
        background('↻ Redrafting kit…', async () => {
          const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
          if (result.cloud) openActivity(true); else if (result.ok) loadJobs(); else toastMessage('Redraft failed', result.error || 'Try again.');
        })});
    }
    if (job.page_id) menu.push({icon: 'chat', label: 'Add employer feedback', run: () => openFeedback({...job, job: job.title}, 'receive')});
    if (job.employer_feedback && job.page_id) menu.push({icon: 'chat', label: 'Read employer feedback', run: () => openFeedback({...job, job: job.title}, 'review')});
    if (job.stage === 'Rejected') {
      // Claude reads the posting, what was sent, the timeline and any interview reviews: presentation, hard skills,
      // soft skills, or a different profile (nothing to improve). Written on the job's Notion page.
      menu.push({icon: 'search', label: job.rejection ? 'Review the rejection again' : 'Why was I rejected?',
        title: 'Claude reviews this application: presentation, hard skills, soft skills, or not on you (~20 s, a few cents)',
        run: () => background('🔎 Reviewing the rejection…', async () => {
          const result = await window.pilot.reviewRejection(job.url);
          toastMessage(result.ok ? 'Rejection reviewed' : 'Review failed', result.text);
          if (result.ok) loadJobs();
        })});
    }
    if (job.code) {
      // A CV tailored to this posting (reworded, reordered bullets from your own CV; the extension uploads it here).
      menu.push({icon: 'scissors', label: job.tailored ? 'Re-tailor CV' : 'Tailor CV',
        title: 'Make a version of your CV for this job: bullets reordered and reworded toward the posting, only from facts in your CV (about 1–2 min, ~10–15¢)',
        run: () => background('✂️ Tailoring CV…', async () => {
          const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`);
          if (result.ok) job.tailored = true; else toastMessage('Tailoring failed', result.error || 'Try again.');
        })});
    }
    // Actions read as verbs (the Status column shows where a job stands).
    menu.push('-');
    if (job.status !== 'saved') menu.push({icon: 'bookmark', label: 'Save', run: setStatus('saved'), title: 'Keep this job on your list'});
    if (job.stage === 'Applying') {  // the session is over or was closed: say what happened, instead of staying Applying
      menu.push({icon: 'tick', label: 'I submitted it', run: setStatus('applied'), title: 'Mark it Applied in Notion'});
      menu.push({icon: 'undo', label: 'Not submitted', title: 'Back to Kit ready', run: async () => {
        const result = await window.pilot.unapplyJob(job.url).catch(error => ({ok: false, error: error.message}));
        if (!result.ok) { toastMessage('Status not changed', result.error || 'Something went wrong.'); return; }
        job.stage = 'Kit ready';
        renderJobs();
      }});
    } else if (job.status !== 'applied') menu.push({icon: 'tick', label: 'Mark applied', run: setStatus('applied'), title: 'You applied to this job: track it in Applications'});
    if (job.stage === 'Applied') menu.push({icon: 'undo', label: "This wasn't submitted…", title: 'Back to Applying, and the Applied record removed',
      run: async () => {
        // Only a bare Applied: a stage past it (a confirmation, an interview) is the employer's own evidence.
        if (!confirm('Mark this as not submitted? It goes back to Applying and the Applied date and event are removed from Notion.\n\n'
          + 'Use this when Job Pilotto marked it Applied by itself and no application was sent.')) return;
        const result = await window.pilot.notSubmitted(job.url).catch(error => ({ok: false, error: error.message}));
        if (!result.ok) { toastMessage('Not changed', result.error || 'Something went wrong.'); return; }
        job.stage = 'Applying';
        job.status = 'applied';
        toastMessage('Back to Applying', `The Applied record was removed${result.events ? ` (${result.events} Notion event${result.events === 1 ? '' : 's'})` : ''}.`);
        renderJobs();
      }});
    if (job.status !== 'dismissed') menu.push({icon: 'close', label: 'Dismiss', run: setStatus('dismissed'), title: 'Not interested: hide this job', danger: true});
    box.append(moreButton(menu, 'More: save, dismiss, kit, posting, tailor CV'));

    row.append(fit, role, company, place, status, box);
    // The score ring opens why: Match analysis (the score's parts, strengths and gaps; Notion Job Matches keeps
    // them). The caret turns with it, and the row's own one-line summary steps aside for the panel's lead.
    if (canOpen) {
      const close = () => {
        row.querySelector('.fit-detail')?.remove();
        fit.classList.remove('is-open');
        fit.title = 'Why this score? Click to see';
      };
      fit.classList.add('is-clickable');
      fit.addEventListener('click', () => {
        if (row.querySelector('.fit-detail')) { close(); return; }
        fit.classList.add('is-open');
        fit.title = 'Hide the match analysis';
        row.append(fitDetail(job, close));
      });
    }
    body.append(row);
  }
  // What the list is filtered to, said once: a chip (✕ shows every job) and "4 of 195 jobs".
  const statLabel = statFilter?.label || {applied: 'Applied', waiting: 'Waiting for a reply', interviews: 'In process', closed: 'Closed',
    stuck: 'Still marked Applying', high: 'High fit (70+)', companies: 'One per company'}[statFilter];
  renderStuck();
  const plural = count => `${count} job${count === 1 ? '' : 's'}`;
  $('jobs-count').textContent = statLabel ? `${rows.length} of ${plural(shared.allJobs.length)}` : plural(rows.length);
  show($('jobs-filter'), !!statLabel);
  $('jobs-filter-text').textContent = statLabel ? `Showing: ${statLabel}` : '';
  show($('jobs-filter-back'), statFilter?.from === 'focus');
  // A filter from another page (a Focus funnel step) is none of the boxes: they're greyed out until it's cleared.
  document.querySelectorAll('.stat-cards').forEach(cards => cards.classList.toggle('is-dimmed', !!statFilter?.urls));
  document.querySelectorAll('[data-stat]').forEach(card => card.setAttribute('aria-pressed', String(statPressed(card.dataset.stat, statFilter, filter))));
  if (jobsLoading && !shared.allJobs.length) { show($('jobs-empty'), false); showLoading(); return; }  // still loading, not empty
  show($('jobs-empty'), rows.length === 0);
  const emptyFor = {saved: 'No saved jobs yet. On any job, <b>⋯ → Save</b> keeps it here for later.',
    applied: 'No applications yet. Apply from a job, or add one you sent elsewhere with <b>+ Applied elsewhere…</b>',
    dismissed: 'No dismissed jobs.', inbound: 'Nothing found you yet. A recruiter\'s message you log (<b>+ Log job activity…</b>) shows here.'};
  $('jobs-empty').innerHTML = !shared.allJobs.length ? 'No jobs here yet. Click <b>Check for new jobs</b>; the first search takes a few minutes.'
    : anyStatus ? 'That job isn\'t in your list: not found by a search yet, or hidden by your language or company filters.'
    : !text && !statFilter && emptyFor[filter] ? emptyFor[filter]
    : text || statFilter || filter !== 'all' ? 'No job matches this filter.' : 'No open jobs right now.';
}
// Pages Job Pilotto never reads (src/notion/ledger.py NO_FETCH): ask for the title, company and text instead.
const NO_FETCH = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;
// A recruiter's message: Claude reads it into a recruiter lead in Notion (like /add <message> in Telegram).
let leadStep = '';  // the Log box's current step, from the engine
let leadRunning = false;  // a log is being read now (the dialog may have been closed and reopened)
// Up to 5 screenshots per log (a long LinkedIn chat): read together, in this order, and kept on the job's page.
const MAX_SHOTS = 5;
let leadShots = [];  // [{name, type, data (base64)}]
function renderShots() {
  $('lead-shots').replaceChildren(...leadShots.map((shot, i) => {
    const box = el('div', 'attachment');
    const remove = el('button', 'soft-button', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => { leadShots.splice(i, 1); renderShots(); });
    box.append(Object.assign(document.createElement('img'), {src: `data:${shot.type};base64,${shot.data}`, alt: `Screenshot ${i + 1}`}),
      el('span', 'attachment-name', `${leadShots.length > 1 ? `${i + 1}. ` : ''}${shot.name}`), remove);
    return box;
  }));
  $('lead-shots').hidden = !leadShots.length;
  $('lead-shot-add').disabled = $('lead-shot-paste').disabled = leadShots.length >= MAX_SHOTS;
}
function setLeadShot(shot) {
  if (leadShots.length >= MAX_SHOTS) { leadResult('info', `Up to ${MAX_SHOTS} screenshots`, 'Remove one to add another.'); return; }
  leadShots.push(shot);
  renderShots();
}
function readShot(file) {  // a File from paste, drop or the picker
  if (!file || !/^image\//.test(file.type)) return false;
  const reader = new FileReader();
  reader.onload = () => { const url = String(reader.result); setLeadShot({name: file.name || 'screenshot.png', type: file.type, data: url.slice(url.indexOf(',') + 1)}); };
  reader.readAsDataURL(file);
  return true;
}
// Step 2, the confirmation: what Claude read, with what it couldn't see asked (renderer/lead-confirm.js).
let leadProposal = null, leadState = null;
const localDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function leadStep2(on) {
  $('lead-compose').hidden = on;
  $('lead-confirm').hidden = !on;
  $('lead-back').hidden = !on;
  $('lead-cancel').hidden = on;
  if (!on) { leadProposal = leadState = null; $('lead-go').textContent = 'Log activity'; }
}
function showConfirm(proposal, state = null) {
  leadProposal = proposal;
  leadState = state || confirmStep.initial(proposal);
  fillJobChoices();
  const fields = proposal.fields || {};
  const {title, meta} = confirmStep.found(proposal);
  $('lead-found-tile').replaceChildren(tile(proposal.new ? 'inbox' : 'briefcase', 'info'));
  $('lead-found-title').textContent = title;
  $('lead-found-meta').textContent = meta;
  const option = (value, text) => Object.assign(document.createElement('option'), {value, textContent: text});
  $('lead-kind').replaceChildren(...(fields.kind?.options || Object.keys(confirmStep.KIND_LABEL)).map(k => option(k, confirmStep.KIND_LABEL[k] || k)));
  $('lead-kind').value = leadState.values.kind || '';
  $('lead-channel-other').value = '';
  const started = fields.started || {};
  $('lead-started-label').textContent = started.question || 'When did it start?';
  $('lead-started').value = leadState.values.started || '';
  $('lead-started').max = localDay();
  $('lead-years').hidden = !started.years?.length;
  $('lead-years').replaceChildren(...(started.years || []).map(year => Object.assign(document.createElement('button'),
    {type: 'button', textContent: String(year), onclick: () => leadSet('started', confirmStep.withYear(started, year))})));
  $('lead-interview-label').textContent = fields.interview?.question || 'When is the call?';
  $('lead-interview').value = leadState.values.interview || '';
  $('lead-last-label').textContent = fields.last?.question || 'When was the last message?';
  $('lead-last').value = leadState.values.last || '';
  $('lead-last').max = localDay();
  $('lead-company').value = leadState.values.company || '';
  $('lead-agency').value = leadState.values.agency || '';
  $('lead-started-hint').textContent = confirmStep.startedHint(proposal.new);
  leadStep2(true);
  renderConfirm();
}
function leadSet(name, value) { leadState = confirmStep.set(leadState, name, value); renderConfirm(); }
// "Which job is this?": the likely ones (from the engine), a new job, your other jobs.
let leadJobChoices = [];
let leadJobActive = -1;
function closeJobChoices() {
  $('lead-job-options').hidden = true;
  $('lead-job').setAttribute('aria-expanded', 'false');
  $('lead-job').removeAttribute('aria-activedescendant');
  leadJobActive = -1;
}
function showJobChoices() {
  const list = $('lead-job-options');
  const groups = confirmStep.searchJobChoices(leadJobChoices, $('lead-job').value);
  const buttons = [];
  list.replaceChildren(...(groups.length ? groups.flatMap(({group, options}) => [
    ...(group ? [Object.assign(document.createElement('div'), {className: 'lead-job-group', textContent: group})] : []),
    ...options.map(option => {
      const button = Object.assign(document.createElement('button'), {type: 'button', className: 'lead-job-option',
        id: `lead-job-option-${buttons.length}`, textContent: option.text});
      button.setAttribute('role', 'option');
      button.addEventListener('click', () => { closeJobChoices(); pickJob(option.value); });
      buttons.push(button);
      return button;
    })]) : [Object.assign(document.createElement('div'), {className: 'lead-job-empty', textContent: 'No matching jobs'})]));
  leadJobActive = -1;
  list.hidden = false;
  $('lead-job').setAttribute('aria-expanded', 'true');
  $('lead-job').removeAttribute('aria-activedescendant');
}
function fillJobChoices() {
  leadJobChoices = confirmStep.jobChoices(leadProposal.fields?.job?.candidates || [], shared.allJobs);
  $('lead-job').value = '';
  closeJobChoices();
}
// The engine's steps with a timer while it reads (step 1), proposes again for a job you picked, or writes (step 2).
async function working(first, task) {
  leadRunning = true;
  $('lead-go').disabled = true;
  const started = Date.now();
  leadStep = first;
  const tick = () => message('lead-message', `${leadStep}… ${Math.round((Date.now() - started) / 1000)} s`, 'waiting');
  tick();
  const timer = setInterval(tick, 1000);
  try { return await task(); } finally { clearInterval(timer); leadRunning = false; $('lead-go').disabled = false; message('lead-message', ''); }
}
// The job you picked: the same reading proposed again for it (no second AI reading); what you confirmed is kept.
async function pickJob(target) {
  if (!target || !leadProposal) return;
  const text = $('lead-text').value.trim();
  const next = await working('Reading your jobs in Notion', () => window.pilot.proposeLead(text, [], target, leadProposal));
  if (!next.ok) { leadResult('warn', "Couldn't use that job", String(next.text || '').replace(/^\S+\s/, '')); return; }
  showConfirm(next, confirmStep.carry(leadState, next));
}
// Every field's mark (please check / needs an answer / ✓), the choices shown, and the Save button's words.
function renderConfirm() {
  if (!leadProposal) return;
  const fields = leadProposal.fields || {}, v = leadState.values;
  const left = confirmStep.pending(leadProposal, leadState, localDay());
  const choosing = confirmStep.choosingJob(leadProposal, leadState);
  const asked = fields.job?.state === 'ask';
  $('lead-found').hidden = asked;
  const change = Object.assign(document.createElement('button'), {type: 'button', className: 'link',
    textContent: leadState.picking ? 'Keep this job' : 'Change'});
  change.addEventListener('click', () => { leadState = {...leadState, picking: !leadState.picking}; $('lead-job').value = ''; closeJobChoices(); renderConfirm(); });
  $('lead-found-flag').replaceChildren(...(asked ? [] : [pill('Confirmed', 'good', {dot: true}), change]));
  $('lead-job-hint').textContent = asked ? 'Several of your jobs are from this recruiter or company: pick one, or a new job. The details follow your pick.'
    : 'Pick the job it is about, or a new job. The details follow your pick.';
  document.querySelectorAll('#lead-confirm .lead-field[data-field]').forEach(box => {
    const name = box.dataset.field, field = fields[name];
    if (name === 'job') {
      box.hidden = !choosing;
      box.classList.toggle('is-ask', choosing);
      box.querySelector('.lead-flag').replaceChildren(pill('Needs an answer', 'warn'));
      return;
    }
    if (choosing) { box.hidden = true; return; }
    if (name === 'first') { box.hidden = !leadProposal.new; return; }
    box.hidden = !field || (name === 'origin' && !confirmStep.originShown(leadProposal, leadState));
    if (box.hidden) return;
    const waiting = left.find(item => item.name === name);
    box.classList.toggle('is-check', waiting?.why === 'check');
    box.classList.toggle('is-ask', !!waiting && waiting.why !== 'check');
    const flag = box.querySelector('.lead-flag');
    if (!waiting) flag.replaceChildren(...(field.state === 'ok' || !leadState.confirmed.includes(name) ? [] : [pill('Confirmed', 'good', {dot: true})]));
    else if (waiting.why === 'check') {
      const ok = Object.assign(document.createElement('button'), {type: 'button', className: 'link', textContent: 'Looks right'});
      ok.addEventListener('click', () => leadSet(name));
      flag.replaceChildren(pill('Please check', 'warn'), ok);
    } else flag.replaceChildren(pill(waiting.why === 'future' ? 'In the future' : 'Needs an answer', 'warn'));
  });
  $('lead-pair-box').hidden = choosing || (!fields.company && !fields.agency);
  $('lead-channel').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.channel === v.channel));
  $('lead-channel-other').hidden = v.channel !== 'Other';
  $('lead-channel-hint').textContent = confirmStep.channelHint(fields.channel, v.channel);
  if ($('lead-started').value !== (v.started || '')) $('lead-started').value = v.started || '';  // a year picked fills the date
  $('lead-years').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', (v.started || '').startsWith(b.textContent)));
  const said = fields.interview?.as_written ? `The message says "${fields.interview.as_written}". ` : '';
  $('lead-interview-hint').textContent = said + (v.kind === 'Interview scheduled' ? 'A booked call needs its date and time.'
    : 'Leave empty if no time is fixed yet.');
  if (fields.last) $('lead-last-hint').textContent = confirmStep.lastHint(fields.last, v.last);
  if (fields.origin) {
    $('lead-origin').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.origin === v.origin));
    $('lead-origin-hint').textContent = confirmStep.originHint(fields.origin, leadState);
  }
  const changing = confirmStep.changes(leadProposal, leadState);
  $('lead-changes').hidden = !changing.length;
  $('lead-changes-list').replaceChildren(...changing.map(change => {
    const item = document.createElement('li');
    const what = Object.assign(document.createElement('b'), {textContent: change.name});
    item.append(what, ` ${change.from} → ${change.to}`);
    if (change.note) item.append(Object.assign(document.createElement('span'), {className: 'muted small', textContent: change.note}));
    return item;
  }));
  $('lead-agree').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.agree === v.agree));
  if (fields.agree) $('lead-agree-hint').textContent = confirmStep.agreeHint(fields.agree, v.agree, leadProposal.new);
  $('lead-first').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.first === leadState.first));
  $('lead-first-hint').textContent = confirmStep.firstHint(v.channel, leadState.first, leadState.other);
  $('lead-go').textContent = confirmStep.saveLabel(left);
}
function clearLeadShot() { leadShots = []; renderShots(); $('lead-shot-file').value = ''; }
function leadResult(tone, title, text, pick = false) {
  $('lead-result').hidden = !title;
  $('lead-result').className = `alert tone-${tone}`;
  $('lead-result-title').textContent = title || '';
  $('lead-result-text').textContent = text || '';
  $('lead-result-pick').hidden = !pick;
  $('lead-result').querySelector('.alert-actions')?.remove();
}
// Link to job: found automatically (default), a new job, or one of the applications in Notion.
function leadTargets() {
  const tracked = shared.allJobs.filter(job => job.stage && !['Dismissed', 'Closed'].includes(job.stage))
    .sort((a, b) => `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`));
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  const group = document.createElement('optgroup');
  group.label = 'Your applications';
  tracked.forEach(job => group.append(option(job.url, `${job.company || job.via || '—'} · ${job.title} (${job.stage})`)));
  $('lead-target').replaceChildren(option('', 'Choose the job…'),
    option('new', 'Not in my list yet: add it from these details'), ...(tracked.length ? [group] : []));
}
// "Find the job automatically" (ticked by default): untick it to choose the job yourself.
function setAuto(on, locked = false) {
  $('lead-auto').checked = on;
  $('lead-target-box').hidden = on;
  // Opened on a job Focus already knows: guessing which job it is would only undo that.
  $('lead-auto-row').hidden = locked;
}
const leadTarget = () => confirmStep.targetOf($('lead-auto').checked, $('lead-target').value);
// The Log box, opened on one job (Focus → Add details): its "Which job?" already set to it.
export function openLogFor(url, label = '') {
  $('lead-open').click();
  if (!url) return;
  setAuto(false, true);
  let chosen = [...$('lead-target').options].find(o => o.value === url);
  if (!chosen) $('lead-target').append(chosen = Object.assign(document.createElement('option'), {value: url}));
  chosen.textContent = label || chosen.textContent.replace(/\s*\(.*\)$/, '');
  $('lead-target').value = url;
}
// List density: Comfortable (columns) or Compact (one block per job); remembered on this computer.
function setDensity(value) {
  const compact = value === 'compact';
  $('jobs-body').classList.toggle('compact', compact);
  $('jobs-head').hidden = compact;
  document.querySelectorAll('[data-density]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.density === value)));
  try { localStorage.setItem('jobsDensity', value); } catch {}
}
// Answer once: the questions saved last time show at once (cached on this computer), then Notion's answer replaces
// them (only if they changed, so nothing you're typing is lost). No cache yet: a shimmer where the count goes.
const QUESTIONS_CACHE = 'questionsCache';
let questionsShown = '';
async function loadQuestions() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(QUESTIONS_CACHE) || 'null'); } catch {}
  if (!questionsShown) {
    if (Array.isArray(cached)) renderQuestions(cached);
    else {
      $('questions').classList.add('is-loading');
      $('questions-count').replaceChildren(el('span', 'skeleton questions-skeleton'));
      show($('questions'));
    }
  }
  const {list, error} = await window.pilot.openQuestions();
  $('questions').classList.remove('is-loading');
  if (error && Array.isArray(cached)) return;  // Notion unreachable: keep the saved questions
  if (!error) try { localStorage.setItem(QUESTIONS_CACHE, JSON.stringify(list)); } catch {}
  renderQuestions(list, error);
}
function renderQuestions(list, error = '') {
  const shown = JSON.stringify([list, error]);
  if (shown === questionsShown) return;
  questionsShown = shown;
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
  extensionHere = (await window.pilot.extensionPack().catch(() => ({present: true}))).present !== false;
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
// through them one by one (the "Did you submit?" question), or reset them all to Kit ready. A session whose job is
// already Applied never reaches here: main.js ends it as the job list is read (server.reconcileAppliedSessions).
async function askAboutLeftOpen() {
  if (leftOpenAsked || jobsLoading || !shared.allJobs.length) return;
  await refreshSessions();
  const open = sessionList.filter(item => item.askAtStart && sessionJob(item).stage === 'Applying');
  leftOpenAsked = true;
  if (!open.length) return;
  const answer = await window.pilot.sessionsLeftOpen(open.map(item => item.id));
  if (answer?.kept) toastMessage(`${answer.kept} application${answer.kept === 1 ? '' : 's'} restored`,
    `${answer.kept === 1 ? 'Its form is' : 'Their forms are'} still open in Chrome: review and submit, or press Resume Claude on the session.`);
}
function showJobsData(data) {
  {
    shared.allJobs = data.jobs;
    const scored = shared.allJobs.filter(job => job.fit != null).length;
    // Total / high fit / new / companies count job matches; opportunities that found you are "In conversation".
    const matched = matchesOnly(shared.allJobs);
    const count = stats(matched, data.total == null ? undefined : data.total - (shared.allJobs.length - matched.length));
    $('jobs-stats').textContent = `${count.total} opportunities matched to your profile` +
      (count.week ? ` · ${count.week} new this week` : '') + (data.filtered ? ` · ${data.filtered} hidden` : '') +
      (data.stale ? ' · ⚠️ Notion unreachable: statuses may be out of date' : '');
    $('jobs-stats').title = `${scored} scored by the AI` + (data.filtered ? `; ${data.filtered} hidden by your language or company filters` : '');
    $('stat-total').textContent = count.total;
    $('stat-high').textContent = count.high;
    $('stat-inbound').textContent = inboundCount(shared.allJobs);
    // The menu item counts the list as it opens ("New matches"), the number the list bar shows too. "New this week" is
    // a delta, not how many jobs there are: it goes in the tooltip and the line above the cards instead of the badge.
    const toReviewCount = toReview(shared.allJobs);
    Object.assign($('nav-jobs-badge'), {hidden: !toReviewCount, textContent: toReviewCount,
      title: `${toReviewCount} job${toReviewCount === 1 ? '' : 's'} to review · ${count.week} new this week`});
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

// A list of applications from elsewhere (a Focus funnel step): only those, whatever their status.
export function showJobsIn(label, urls, from = '') {
  statFilter = {label, from, urls: new Set((urls || []).map(fullKey))};
  $('filter-status').value = 'all';
  $('filter-text').value = '';
  renderJobs();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  try { $('jobs-talking').open = localStorage.getItem(TALKING_OPEN) !== '0'; } catch {}
  $('jobs-talking').addEventListener('toggle', event => { try { localStorage.setItem(TALKING_OPEN, event.target.open ? '1' : '0'); } catch {} });
  $('jobs-stuck-show').addEventListener('click', () => {
    statFilter = 'stuck';
    $('filter-status').value = 'all';
    renderJobs();
  });
  $('sort-by').addEventListener('change', renderJobs);
  $('jobs-filter-clear').addEventListener('click', () => { statFilter = null; renderJobs(); });
  $('jobs-filter-back').addEventListener('click', () => document.querySelector('.nav[data-view="focus"]').click());
  // The counters filter the list to the jobs they count, whatever their status (so the list matches the number);
  // clicking the active one again, or Total matches, shows every match.
  document.querySelectorAll('[data-stat]').forEach(card => card.addEventListener('click', () => {
    const kind = card.dataset.stat;
    const next = statClick(kind, typeof statFilter === 'string' ? statFilter : null, $('filter-status').value);
    statFilter = next.stat;
    $('filter-status').value = next.filter;
    if (kind === 'companies' && statFilter) $('sort-by').value = 'company';
    renderJobs();
  }));
  // Add a job: one link, then the find path (read, score, Job Matches). It shows under New matches.
  $('import-open').addEventListener('click', () => {
    message('import-message', '');
    $('import-go').disabled = false;
    $('import-dialog').showModal();
    $('import-url').focus();
  });
  $('import-go').addEventListener('click', async event => {
    event.preventDefault();
    const url = $('import-url').value.trim();
    if (!/^https?:\/\//.test(url)) { message('import-message', 'Paste the job link (it starts with https://).', 'error'); return; }
    $('import-go').disabled = true;
    message('import-message', 'Reading the posting and scoring it…', 'waiting');
    const result = await window.pilot.importJob(url);
    $('import-go').disabled = false;
    message('import-message', result.text, result.ok ? 'ok' : 'error');
    if (!result.ok) return;
    $('import-url').value = '';
    $('filter-status').value = 'open';
    loadJobs();
  });
  // Applied elsewhere: tracked in Notion like /add, then shown in the list as Applied.
  const setAppliedOrigin = value => $('applied-origin').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.origin === value));
  const appliedOrigin = () => $('applied-origin').querySelector('.is-active')?.dataset.origin || 'outbound';
  $('applied-origin').addEventListener('click', event => { const b = event.target.closest('[data-origin]'); if (b) setAppliedOrigin(b.dataset.origin); });
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
    const details = {...(manual ? {title: $('applied-title').value.trim(), company: $('applied-company').value.trim(), text: $('applied-text').value.trim()} : {}),
      ...(appliedOrigin() === 'inbound' ? {origin: 'inbound'} : {})};
    const result = await window.pilot.addApplied(url, $('applied-approx').checked ? `on or before ${day}` : day, details);
    $('applied-go').disabled = false;
    message('applied-message', result.text, result.ok ? 'ok' : 'error');
    if (!result.ok) return;
    $('applied-url').value = ''; $('applied-approx').checked = false; setAppliedOrigin('outbound');
    ['applied-title', 'applied-company', 'applied-text'].forEach(id => { $(id).value = ''; });
    $('applied-manual').hidden = true;
    $('filter-status').value = 'applied';  // show it where it now is
    loadJobs();
  });
  $('lead-open').addEventListener('click', () => {
    if (!leadRunning) message('lead-message', '');  // a log still running keeps its step and timer
    leadResult('', '');
    if (!leadRunning && !leadProposal) leadStep2(false);  // an unconfirmed reading stays until Back or a save
    $('lead-go').disabled = leadRunning;
    leadTargets();
    if (!leadRunning && !leadProposal) setAuto(true);
    $('lead-dialog').showModal();
    $('lead-text').focus();
  });
  window.pilot.onLeadStep(text => { leadStep = text; });
  $('lead-shot-add').addEventListener('click', () => $('lead-shot-file').click());
  $('lead-shot-file').addEventListener('change', () => { [...$('lead-shot-file').files].forEach(readShot); $('lead-shot-file').value = ''; });
  $('lead-shot-paste').addEventListener('click', async () => {
    const shot = await window.pilot.clipboardImage();
    if (shot) setLeadShot(shot); else leadResult('info', 'No image on the clipboard',
      osPick('Copy a screenshot first (⇧⌘4, then Ctrl-click to copy it), or use Add screenshot.',
        'Copy a screenshot first (Win+Shift+S saves one to the clipboard), or use Add screenshot.'));
  });
  $('lead-dialog').addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) { files.forEach(readShot); event.preventDefault(); }
  });
  $('lead-composer').addEventListener('dragover', event => { event.preventDefault(); $('lead-composer').classList.add('is-drop'); });
  $('lead-composer').addEventListener('dragleave', () => $('lead-composer').classList.remove('is-drop'));
  $('lead-composer').addEventListener('drop', event => {
    $('lead-composer').classList.remove('is-drop');
    const files = [...(event.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) { event.preventDefault(); files.forEach(readShot); }
  });
  $('lead-result-pick').addEventListener('click', () => { setAuto(false); $('lead-target').focus(); $('lead-target').showPicker?.(); });
  $('lead-auto').addEventListener('change', () => setAuto($('lead-auto').checked));
  $('lead-job').addEventListener('focus', showJobChoices);
  $('lead-job').addEventListener('click', () => { if ($('lead-job-options').hidden) showJobChoices(); });
  $('lead-job').addEventListener('input', showJobChoices);
  $('lead-job').addEventListener('keydown', event => {
    const options = [...$('lead-job-options').querySelectorAll('[role="option"]')];
    if (event.key === 'Escape') { closeJobChoices(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if ($('lead-job-options').hidden) showJobChoices();
      const visible = [...$('lead-job-options').querySelectorAll('[role="option"]')];
      if (!visible.length) return;
      leadJobActive = (leadJobActive + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      visible.forEach((button, index) => {
        button.classList.toggle('is-active', index === leadJobActive);
        button.setAttribute('aria-selected', String(index === leadJobActive));
      });
      $('lead-job').setAttribute('aria-activedescendant', visible[leadJobActive].id);
      visible[leadJobActive].scrollIntoView({block: 'nearest'});
    } else if (event.key === 'Enter' && !$('lead-job-options').hidden) {
      event.preventDefault();
      (options[leadJobActive] || (options.length === 1 ? options[0] : null))?.click();
    }
  });
  $('lead-job').addEventListener('blur', () => setTimeout(() => {
    if (!$('lead-job-options').contains(document.activeElement)) closeJobChoices();
  }, 150));
  // Step 2's controls: each change confirms that field.
  $('lead-kind').addEventListener('change', () => leadSet('kind', $('lead-kind').value));
  $('lead-channel').addEventListener('click', event => { const b = event.target.closest('[data-channel]'); if (b) leadSet('channel', b.dataset.channel); });
  $('lead-channel-other').addEventListener('input', () => { leadState.other = $('lead-channel-other').value; renderConfirm(); });
  $('lead-started').addEventListener('input', () => leadSet('started', $('lead-started').value));
  $('lead-interview').addEventListener('input', () => leadSet('interview', $('lead-interview').value));
  $('lead-last').addEventListener('input', () => leadSet('last', $('lead-last').value));
  $('lead-company').addEventListener('input', () => leadSet('company', $('lead-company').value));
  $('lead-agency').addEventListener('input', () => leadSet('agency', $('lead-agency').value));
  $('lead-origin').addEventListener('click', event => { const b = event.target.closest('[data-origin]'); if (b) leadSet('origin', b.dataset.origin); });
  $('lead-agree').addEventListener('click', event => { const b = event.target.closest('[data-agree]'); if (b) leadSet('agree', b.dataset.agree); });
  $('lead-first').addEventListener('click', event => { const b = event.target.closest('[data-first]'); if (b) { leadState.first = b.dataset.first; renderConfirm(); } });
  $('lead-back').addEventListener('click', () => { leadStep2(false); leadResult('', ''); message('lead-message', ''); });
  $('lead-go').addEventListener('click', async event => {
    event.preventDefault();
    if (leadRunning) return;  // one log at a time: reopening the dialog never starts a second one
    const text = $('lead-text').value.trim();
    leadResult('', '');
    if (!leadProposal) {  // step 1: Claude reads it; nothing is written yet
      if (!leadShots.length && text.length < 40) { leadResult('warn', 'Nothing to log yet', 'Paste the whole message, or add a screenshot of it.'); return; }
      if (!$('lead-auto').checked && !leadTarget()) { leadResult('warn', 'Which job is it?', 'Choose the job, or tick "Find the job automatically".'); return; }
      const proposal = await working(leadShots.length > 1 ? `Sending ${leadShots.length} screenshots` : 'Starting',
        () => window.pilot.proposeLead(text, leadShots, leadTarget()));
      if (!proposal.ok) {
        const said = String(proposal.text || '').replace(/^\S+\s/, '');  // without the leading emoji
        const notJob = /doesn't look like a message about a job/.test(said);
        const unsure = /can't tell which company and role/.test(said);
        leadResult('warn', notJob ? 'No job activity found' : unsure ? 'Which job is it?' : "Couldn't log it",
          notJob ? 'This looks like something other than a job (e.g. a services pitch), so nothing was added.' : said, notJob || unsure);
        return;
      }
      showConfirm(proposal);
      return;
    }
    // Step 2: only once every marked detail is confirmed, then it's written with your answers.
    const left = confirmStep.pending(leadProposal, leadState, localDay());
    if (left.length) {
      leadResult('warn', confirmStep.saveLabel(left), 'The marked details were guessed or missing: confirm or fill them in first.');
      document.querySelector(`#lead-confirm .lead-field[data-field="${left[0].name}"]`)?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      return;
    }
    const answers = confirmStep.confirmed(leadProposal, leadState);
    const result = await working('Saving to Notion', () => window.pilot.addLead(text, leadShots,
      leadProposal.target ?? leadTarget(), leadProposal, answers));
    const said = result.text.replace(/^\S+\s/, '');
    if (!result.ok) { leadResult('warn', "Couldn't log it", said); return; }
    leadStep2(false);
    leadResult(/^ℹ️/.test(result.text) ? 'info' : 'good', /^ℹ️/.test(result.text) ? 'Nothing new' : result.job ? jobHeadline(result.job) : 'Logged', said);
    if (/^ℹ️/.test(result.text)) return;
    // The job it created or updated, one click away (its Notion page, or the Jobs list filtered to it).
    if (result.job) $('lead-result-text').after(jobActions(result.job, {openNotion: window.pilot.openNotion,
      show: job => { $('lead-dialog').close(); showJob(job); }}));
    $('lead-text').value = ''; clearLeadShot();
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
    document.querySelector(`input[name="apply-mode"][value="${claudeReady || !extensionHere ? 'agents' : 'chrome'}"]`).checked = true;
    const plain = document.querySelector('input[name="apply-mode"][value="chrome"]');
    plain.disabled = !extensionHere;   // the plain mode is the extension filling tabs
    plain.closest('label').title = extensionHere ? '' : 'The Chrome extension is not part of this app yet';
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
