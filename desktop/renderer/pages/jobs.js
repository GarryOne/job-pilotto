// Jobs: loading and reloading the list, adding jobs, init(); the pieces are jobs-state/-render/-fit/-lead/-questions.js. Guarded by: search-changed, live-status-line, live-count, activity-selection-kept tests.
import {setCount} from '../components.js';
import {claudeHelp} from '../claude-help.js';
import {applicationStats, inboundCount, inProcess, matchesOnly, statClick, stats, takenDown, toReview} from '../jobs-view.js';
import {shared} from './shared.js';
import {refreshBusy, showSearchChanged, wireSearchChanged} from '../search-changed.js';
import {openActivity, refreshActivity, showSearchStatus} from './activity.js';
import {$, message, savedAgo} from './core.js';
import {refreshSessions, sessionJob, sessionList} from './sessions.js';
import {toastMessage} from './startup.js';
import {hostStats, snapshot} from '../intel.js';
import {searchSelect} from '../search-select.js';
import {jobsState, MORE, fullKey} from './jobs-state.js';
import {TALKING_OPEN, renderJobs, renderStuck, showLoading} from './jobs-render.js';
export {renderJobs} from './jobs-render.js';
window.addEventListener('claude-help', () => renderJobs());   // Settings' Claude switch: the job menus follow it (claude-help.js)
export {pageKey, fullKey} from './jobs-state.js';
export {openLogFor} from './jobs-lead.js';
import {wireLead} from './jobs-lead.js';
import {loadQuestions} from './jobs-questions.js';
import {wireViews} from './jobs-views.js';
import {storeName} from '../store-words.js';

// Sites that often show a sign-in page instead of the posting (src/notion/ledger.py WALLED): read like any page, with fields for the text in case.
const WALLED = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;

// List density: Comfortable (columns) or Compact (one block per job); remembered on this computer.
function setDensity(value) {
  const compact = value === 'compact';
  $('jobs-body').classList.toggle('compact', compact);
  $('jobs-head').hidden = compact;
  document.querySelectorAll('[data-density]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.density === value)));
  try { localStorage.setItem('jobsDensity', value); } catch {}
}

let freshJobs = false;
let leftOpenAsked = false;  // the start-up question about sessions left open was asked (once per launch)
export async function loadJobs() {
  loadQuestions();
  freshJobs = false;
  showLoading();
  jobsState.jobsLoading = true;
  jobsState.claudeReady = (await window.pilot.claudeReady().catch(() => ({ok: false}))).ok;
  try {
    // The last good list at once (lib/view-cache.js), then the fresh one from Notion replaces it.
    if (!shared.allJobs.length) {
      const saved = await window.pilot.cached('jobs');
      if (saved?.result?.jobs) { showJobsData(saved.result); jobsState.jobsLoading = false; renderJobs(); $('jobs-stats').textContent += ` · saved ${savedAgo(saved.at)}, updating…`; jobsState.jobsLoading = true; }
    }
    const fresh = await window.pilot.jobs();
    showJobsData(fresh);
    freshJobs = !fresh.stale;  // from Notion now, not the cache: safe to ask about what's still Applying
  } catch (error) {
    $('jobs-stats').textContent = `Couldn't read your jobs: ${error.message}`;
  }
  jobsState.jobsLoading = false;
  renderJobs();
  if (freshJobs) {
    askAboutLeftOpen();
    // How the fit score relates to what became of each job, as counts per band and state (once a day; the app drops it if reports are off).
    if (shared.allJobs.length) window.pilot.intelSnapshot(snapshot(shared.allJobs), hostStats(shared.allJobs)).catch(() => {});
    if (shared.allJobs.length) window.pilot.benchmarkLines(shared.allJobs.map(job => job.url).filter(Boolean)).then(result => { jobsState.benchmarkText = result?.lines || {}; }).catch(() => {});
  }
}
// Once per launch, on fresh data: sessions left open by the last run whose jobs are still Applying. Keep them, go
// through them one by one (the "Did you submit?" question), or reset them all to Kit ready. A session whose job is
// already Applied never reaches here: main.js ends it as the job list is read (server.reconcileAppliedSessions).
async function askAboutLeftOpen() {
  if (leftOpenAsked || jobsState.jobsLoading || !shared.allJobs.length) return;
  await refreshSessions();
  const open = sessionList.filter(item => item.askAtStart && sessionJob(item).stage === 'Applying');
  leftOpenAsked = true;
  if (!open.length) return;
  const answer = await window.pilot.sessionsLeftOpen(open.map(item => item.id));
  if (answer?.kept) toastMessage(`${answer.kept} application${answer.kept === 1 ? '' : 's'} restored`,
    `${answer.kept === 1 ? 'Its form is' : 'Their forms are'} still open in Chrome: review and submit, or press Resume Claude on the session.`);
}
let jobsLimit = 200;
async function showMore() {
  const button = $('jobs-more');
  button.disabled = true;
  button.textContent = 'Loading…';
  try {
    jobsLimit = shared.allJobs.length + MORE;
    showJobsData(await window.pilot.jobs({limit: jobsLimit}));
  } catch (error) {
    toastMessage('Could not load more jobs', error.message);
  }
  button.disabled = false;
  renderJobs();
}
// A refresh's lines that change the list while it runs: jobs closed outside your search, scores written to Notion so far. The list is read again
// then, without the loading state, so the counts move as it works (owner, 7 Oct 2026: "I want to see the 2971 decrease live").
// Each scored job counts too (owner, 7 Oct 2026: the total stayed at 51 while a refresh scored), at most one read every RELOAD_MS, the last one
// always made, so the number climbs as the refresh works.
export const LIST_CHANGED = /^Closed [1-9]\d* job\(s\)|^Job Matches: \d+ created, \d+ updated \(so far\)|^Scored [1-9]\d* of \d+ job\(s\)$/;
export const RELOAD_MS = 10000;
let quietReload = null, lastReload = 0, reloadLater = null;
function reloadQuietly() {
  if (quietReload || reloadLater) return;
  const wait = Math.max(0, lastReload + RELOAD_MS - Date.now());
  reloadLater = setTimeout(() => {
    reloadLater = null;
    lastReload = Date.now();
    quietReload = window.pilot.jobs().then(fresh => { if (fresh?.jobs) { showJobsData(fresh); renderJobs(); } })
      .catch(() => {}).finally(() => { quietReload = null; });
  }, wait);
}
export function showJobsData(data) {
  jobsState.lastJobsData = data;
  // "Your search changed" until a refresh has finished: the settings as they are now (a refresh that just ended set lastSearchAt).
  wireSearchChanged();
  window.pilot.state().then(state => { shared.state = state; showSearchChanged(state.settings); }).catch(() => {});
  {
    for (const job of takenDown(shared.allJobs, data.jobs)) {
      toastMessage('Posting taken down', `${job.company ? `${job.company} · ` : ''}${job.title || job.url}: its job board no longer lists it, so it moved to Closed. Your kit is kept.`);
    }
    shared.allJobs = data.jobs;
    const scored = shared.allJobs.filter(job => job.fit != null).length;
    // Total / high fit / new / companies count job matches; opportunities that found you are "In conversation".
    const matched = matchesOnly(shared.allJobs);
    const count = stats(matched, data.total == null ? undefined : data.total - (shared.allJobs.length - matched.length));
    count.week += data.week_beyond || 0;   // new jobs among the rows not loaded (a cut list)
    $('jobs-stats').textContent = `${count.total} matches` +
      (count.week ? ` · ${count.week} new this week` : '') + (data.filtered ? ` · ${data.filtered} hidden` : '') +
      // Found but not read and scored yet: the next refreshes take them, a batch at a time, best places first (src/daily.py).
      (data.waiting ? ` · ${data.waiting} found, waiting for a score` : '') +
      (data.stale ? ' · ⚠️ Notion unreachable: statuses may be out of date' : '');   // about Notion
    $('jobs-stats').title = `${scored} scored by the AI` + (data.filtered ? `; ${data.filtered} hidden by your language or company filters` : '');
    const totalBefore = $('stat-total').textContent, flash = setCount($('stat-total'), count.total);
    // Whether a person could see it (7 Oct 2026: "the flashing is not consistently working"): logs/app.log, area ui
    if (flash !== 'same') window.pilot.uiLog?.('Total matches changed', {from: totalBefore, to: count.total, flash,
      page: document.querySelector('.view[data-view="jobs"]')?.offsetParent ? 'jobs' : 'another page',
      window: document.visibilityState, focused: document.hasFocus(), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches}).catch?.(() => {});
    setCount($('stat-high'), count.high);
    setCount($('stat-inbound'), inboundCount(shared.allJobs));
    // The menu item counts the list as it opens ("New matches"), the number the list bar shows too. "New this week" is
    // a delta, not how many jobs there are: it goes in the tooltip and the line above the cards instead of the badge.
    const toReviewCount = toReview(shared.allJobs) + (data.review_beyond || 0);   // with the rows not loaded (a cut list)
    setCount($('nav-jobs-badge'), toReviewCount);
    Object.assign($('nav-jobs-badge'), {hidden: !toReviewCount,
      title: `${toReviewCount} job${toReviewCount === 1 ? '' : 's'} to review · ${count.week} new this week`});
    setCount($('stat-companies'), count.companies);
    const applications = applicationStats(shared.allJobs);
    for (const kind of Object.keys(applications)) setCount($(`stat-${kind}`), applications[kind]);
    const talking = inProcess(shared.allJobs);
    document.querySelector('[data-stat="interviews"]').title = `Now: ${talking.screening} screening · ${talking.interviews} interviewing or offer.`;
    document.querySelector('[data-stat="applied"]').title = 'Applications sent = waiting for a reply + in process + closed. Forms still being filled are sessions, not counted here.';
    document.querySelector('[data-stat="waiting"]').title = 'Sent, no answer yet (Applied, Confirmation received).';
    document.querySelector('[data-stat="closed"]').title = 'Rejected, withdrawn, or no answer after the waiting time.';
    renderStuck();
  }
}

// A kit's provenance, for its tag: "Current", "Drafted with earlier inputs" (which ones changed), or "Inputs unknown".

// A list of applications from elsewhere (a Focus funnel step): only those, whatever their status.
export function showJobsIn(label, urls, from = '') {
  jobsState.statFilter = {label, from, urls: new Set((urls || []).map(fullKey))};
  $('filter-status').value = 'all';
  $('filter-text').value = '';
  renderJobs();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
// Refresh jobs, from any button that starts one (Refresh, "score the unscored", Strategy's Re-score them now): the header status
// shows "Refreshing jobs →", the run joins Recent activity, the list reloads after. Resolves when the search ends.
// why: what this refresh is for beyond finding jobs ({reason: 'rescore', count}), said on its row in Recent activity (main.js refresh).
export async function startSearch(why = undefined) {
  refreshBusy(true);   // "Your search changed": this refresh applies it
  $('refresh').disabled = true;
  shared.selectedRun = null;
  setTimeout(() => { showSearchStatus(); refreshActivity(); }, 300);
  try {
    await window.pilot.refresh(why);
  } finally {
    $('refresh').disabled = false;
    loadJobs();
    refreshActivity();
    showSearchStatus();
  }
}

export async function init() {
  searchSelect($('lead-target'));
  try { $('jobs-talking').open = localStorage.getItem(TALKING_OPEN) !== '0'; } catch {}
  $('jobs-talking').addEventListener('toggle', event => { try { localStorage.setItem(TALKING_OPEN, event.target.open ? '1' : '0'); } catch {} });
  $('jobs-stuck-show').addEventListener('click', () => {
    jobsState.statFilter = 'stuck';
    $('filter-status').value = 'all';
    renderJobs();
  });
  $('sort-by').addEventListener('change', renderJobs);
  wireViews();   // saved views + List | Board (pages/jobs-views.js): they ask for a render through this event
  document.addEventListener('jobs-rerender', () => renderJobs());
  $('jobs-filter-clear').addEventListener('click', () => { jobsState.statFilter = null; renderJobs(); });
  $('jobs-filter-back').addEventListener('click', () => document.querySelector('.nav[data-view="focus"]').click());
  // The counters filter the list to the jobs they count, whatever their status (so the list matches the number);
  // clicking the active one again, or Total matches, shows every match.
  document.querySelectorAll('[data-stat]').forEach(card => card.addEventListener('click', () => {
    const kind = card.dataset.stat;
    const next = statClick(kind, typeof jobsState.statFilter === 'string' ? jobsState.statFilter : null, $('filter-status').value);
    jobsState.statFilter = next.stat;
    if (next.stat) jobsState.view = null;   // one narrowing at a time: a counter replaces a saved view
    $('filter-status').value = next.filter;
    if (kind === 'companies' && jobsState.statFilter) $('sort-by').value = 'company';
    renderJobs();
  }));
  // Add a job: one link, then the find path (read, score, Job Matches). It shows under New matches.
  $('jobs-more').addEventListener('click', showMore);
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
    $('applied-manual').hidden = !WALLED.test(host);
  });
  $('applied-go').addEventListener('click', async event => {
    event.preventDefault();
    const url = $('applied-url').value.trim();
    if (!/^https?:\/\//.test(url)) { message('applied-message', 'Paste the job link (it starts with https://).', 'error'); return; }
    $('applied-go').disabled = true;
    message('applied-message', `Reading the posting and adding it to ${storeName()}…`, 'waiting');
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
  wireLead();
  document.querySelectorAll('[data-density]').forEach(button => button.addEventListener('click', () => setDensity(button.dataset.density)));
  try { setDensity(localStorage.getItem('jobsDensity') || 'comfortable'); } catch { setDensity('comfortable'); }
  $('filter-status').addEventListener('change', renderJobs);
  $('filter-text').addEventListener('input', renderJobs);

  // ---------- questions to answer once ----------
  // The start-up move to Notion can finish after the first read: read them again then.
  window.pilot.onMoved(steps => { if (steps.includes('open questions')) loadQuestions({force: true}); });

  window.pilot.onLog(line => {
    // A new run's first line starts a fresh live log. It does NOT clear the run you are looking at in Recent activity (6 Oct 2026: the Gmail check the app
    // starts by itself after launch switched the panel away from the run being read). Starting a run yourself clears it (Refresh, Check Gmail, View activity).
    if (shared.idleSeen || /^Searching job boards/.test(line)) { shared.logLines = []; shared.idleSeen = false; }
    // "Still running · no new output for 1 min" and the wait for another run: only the newest of a row stays (lib/pipeline.js STATUS_LINE).
    const status = /^(?:⏳ Still running|Another Job Pilotto search is running)/;
    if (status.test(line) && status.test(shared.logLines.at(-1) || '')) shared.logLines.pop();
    shared.logLines.push(line);
    refreshActivity();
    if (LIST_CHANGED.test(line)) reloadQuietly();
  });
  $('search-status').addEventListener('click', () => openActivity(true));
  $('refresh').addEventListener('click', () => startSearch());

  $('jobs-unscored-go').addEventListener('click', () => $('refresh').click());
  $('apply-open').addEventListener('click', () => {
    message('apply-message', '');
    // The extension first; Claude is a choice only with Claude help on (claude-help.js), and never the preset one.
    document.querySelector('input[name="apply-mode"][value="agents"]').closest('label').hidden = !(jobsState.claudeReady && claudeHelp());
    document.querySelector('input[name="apply-mode"][value="chrome"]').checked = true;
    $('apply-dialog').showModal();
  });
  window.pilot.onApplyProgress(text => message('apply-message', text, 'waiting'));   // "Drafting kit 2 of 3…" while the batch drafts what is missing
  $('apply-go').addEventListener('click', async event => {
    event.preventDefault();
    const mode = document.querySelector('input[name="apply-mode"]:checked').value;
    const n = Math.max(1, Number($('apply-n').value) || 1);
    // Feedback at once: picking the jobs reads Notion and checks each posting is still open (a few seconds).
    $('apply-go').disabled = true;
    $('apply-go').classList.add('busy');
    $('apply-go').textContent = 'Starting…';
    message('apply-message', `Finding your best ${n} job${n === 1 ? '' : 's'}, drafting any missing kit first (about 20 s each), and checking the postings are still open…`, 'waiting');
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

