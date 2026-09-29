// Focus page.
import {el, moreButton, pill} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, savedAgo, show} from './core.js';
import {openLogFor, showJobsIn} from './jobs.js';
import {openView} from './nav.js';
import {openSetting} from './settings.js';
import {toastMessage} from './startup.js';
import {openFeedback, saveFeedbackAction} from './feedback.js';
import {moveEmail, whichJob} from './reassign.js';
import {openPrep} from './prep.js';

// Focus page state, declared before the start-up code opens Focus (a later `let` isn't usable yet then).
let focusLoading = null, focusShown = false;
const FOCUS_WHEN = {1: ['Now', 'bad'], 2: ['Soon', 'warn'], 3: ['Today', 'info'], 4: ['When you can', 'neutral']};

// ---------- Focus: what to do next (src/focus.py, from Notion, no AI) ----------
function focusButton(label, className, run) {
  const button = Object.assign(document.createElement('button'), {className, textContent: label});
  button.addEventListener('click', run);
  return button;
}
function openLink(url, event) {
  if (/notion\.(so|com)\//.test(url)) window.pilot.openNotion(url, event?.metaKey); else window.pilot.openExternal(url);
}
export const bone = (className = '') => el('span', `skeleton ${className}`);  // a grey placeholder bar while loading
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
export function loadFocus() {
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
  if (item.kind === 'feedback') actions.append(focusButton('Ask for feedback', 'primary', () => openFeedback(item, 'request')));
  if (item.kind === 'feedback_wait') actions.append(focusButton('Add feedback', 'primary', () => openFeedback(item, 'receive')));
  if (item.kind === 'feedback_review') actions.append(focusButton('Read feedback', 'primary', () => openFeedback(item, 'review')));
  if (item.link && !item.kind.startsWith('feedback')) actions.append(focusButton(item.link_label || 'Open', 'primary', event => openLink(item.link, event)));
  if (item.kind === 'details') actions.append(focusButton('Add details', 'primary',
    () => openLogFor(item.job_url, `${item.company || item.via || '—'} · ${item.job}`)));
  if (item.kind === 'which_job') {  // an email the Gmail check wasn't sure about: your answer places it
    if (item.suggested_url) actions.append(focusButton('Yes, that job', 'primary', async event => {
      event.currentTarget.disabled = true;
      await moveEmail(item.event_id, item.suggested_url);
    }));
    actions.append(focusButton(item.suggested_url ? 'Other job…' : 'Pick the job', item.suggested_url ? 'secondary' : 'primary', () => whichJob(item)));
  }
  if (item.kind === 'apply') actions.append(focusButton('Browse jobs', 'primary', () => openView('jobs')));
  if (item.kind === 'review') actions.append(focusButton('Interviews', 'primary', () => openView('interviews')));
  if (item.kind === 'prepare' && item.page_id) {  // the prep kit: built on the job's page, then opened there
    if (item.prep_at) actions.append(focusButton('Open prep kit', 'primary', event => openLink(item.notion_url, event)));
    else actions.append(focusButton('Build prep kit', 'primary', () => openPrep(item)));
  }
  if (!item.link && ['reply', 'book', 'offer', 'nudge'].includes(item.kind) && item.notion_url) {
    actions.append(focusButton('Open', 'primary', event => openLink(item.notion_url, event)));
  }
  if (item.done && item.page_id) actions.append(focusButton('Done', 'secondary', async event => {
    event.currentTarget.disabled = true;
    const done = await window.pilot.focusDone(item.page_id);
    if (!done.ok) toastMessage('Not saved', done.error || 'Notion refused it. Try again.');
    loadFocus();
  }));
  const more = [];
  if (item.kind.startsWith('feedback') && item.kind !== 'feedback_wait') more.push({label: 'Add employer feedback', run: () => openFeedback(item, 'receive')});
  if (item.kind === 'feedback') more.push({label: 'Skip this request', run: async () => {
    const result = await saveFeedbackAction(item, 'skip');
    if (!result.ok) toastMessage('Not saved', result.error);
  }});
  if (item.notion_url) more.push({label: '🗂 Open in Notion', run: event => openLink(item.notion_url, event)});
  if (item.job_url && item.job_url !== item.link && !/jobpilotto|mail\.google/.test(item.job_url)) more.push({label: '↗ Open posting', run: () => window.pilot.openExternal(item.job_url)});
  if (item.kind === 'which_job') more.push({label: 'Not about a job', run: () => moveEmail(item.event_id, 'none')});
  if (item.kind === 'prepare' && item.prep_at) more.push({label: '↻ Build the prep kit again', run: () => openPrep(item)});
  if (item.kind === 'apply') more.push({label: '🎯 Change the daily target', run: () => editTarget()});
  if (item.detail) more.push({label: 'ℹ️ Details', run: () => toastMessage(item.headline || item.title, item.detail)});
  if (more.length) actions.append(moreButton(more, 'More'));
  li.append(round, body, actions);
  return li;
}
// History: what you resolved from Focus (replied, asked for feedback, skipped, rated insights), from Notion.
let historyShown = false;
function showHistory(on) {
  historyShown = on;
  $('focus-up-title').textContent = on ? 'History' : 'Up next';
  $('focus-history-toggle').textContent = on ? '← Up next' : 'History';
  show($('focus-count-note'), !on);
  show($('focus-list'), !on);
  show($('focus-empty'), !on && !$('focus-list').children.length);
  show($('focus-history'), on);
  if (on) loadHistory();
}
const dayOf = iso => {
  const day = new Date(iso), today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(day.toDateString())) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : day.toLocaleDateString([], {weekday: 'short', day: 'numeric', month: 'short'});
};
async function loadHistory() {
  const list = $('focus-history');
  list.replaceChildren(el('li', 'muted small', 'Loading from Notion…'));
  const {ok, items = [], error} = await window.pilot.focusHistory().catch(failure => ({ok: false, error: failure.message}));
  if (!historyShown) return;
  if (!ok) { list.replaceChildren(el('li', 'message error', `Couldn't read your history from Notion: ${error || 'try again'}`)); return; }
  if (!items.length) { list.replaceChildren(el('li', 'muted', 'Nothing resolved yet. What you mark done here shows up in this list.')); return; }
  const rows = [];
  let day = '';
  for (const item of items) {
    const label = dayOf(item.at);
    if (label !== day) { day = label; rows.push(el('li', 'focus-history-day', label)); }
    const row = el('li', 'focus-history-row');
    const words = el('div', 'focus-history-words');
    words.append(el('b', '', item.title));
    if (item.note) words.append(el('span', 'muted small', item.note));
    const side = el('div', 'focus-history-side');
    if (/T\d/.test(item.at)) side.append(el('span', 'muted small', new Date(item.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})));
    if (item.url) {
      const open = el('button', 'link small', 'Notion ↗');
      open.addEventListener('click', event => window.pilot.openNotion(item.url, event.metaKey));
      side.append(open);
    }
    // Done: a green tick (what kind of to-do it was is in its title).
    const done = el('span', 'focus-history-done');
    done.append(icon('tick'));
    row.append(done, words, side);
    rows.push(row);
  }
  list.replaceChildren(...rows);
}
function renderFocus({items, today, funnel, insight, summary}) {
  focusShown = true;
  $('focus-count-note').replaceChildren(pill(`${items.length} action${items.length === 1 ? '' : 's'}`, 'neutral'));
  $('focus-list').replaceChildren(...items.map(focusCard));
  show($('focus-empty'), !items.length && !historyShown);
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
  if (insight.notion_url) box.append(focusButton(insight.issue ? 'Review evidence' : insight.report ? 'Open insight' : 'Review rejection', 'secondary', event => openLink(insight.notion_url, event)));
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
    // How many ever reached this step (it only grows: a later rejection doesn't take one back) and their share.
    li.title = `${step.reached} ever reached this step (${share}% of all prepared), whatever happened after`;
    const name = step.step.replace(/^\S+\s/, '');
    li.append(el('span', 'funnel-name', name), el('b', 'funnel-count', String(step.reached)), bar, el('span', 'muted small', `${share}% reached`));
    // A click shows the applications that reached this step in the Jobs list.
    if (step.urls?.length) {
      li.classList.add('is-link');
      Object.assign(li, {tabIndex: 0, role: 'button'});
      li.title += '. Click to see them';
      const open = () => { openView('jobs'); showJobsIn(`Ever reached ${name}`, step.urls, 'focus'); };
      li.addEventListener('click', open);
      li.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    }
    nodes.push(li);
  });
  $('funnel-steps').replaceChildren(...nodes);
  $('funnel-improve').textContent = funnel.improve ? `To improve: ${funnel.improve.step.replace(/^\S+\s/, '')}. ${funnel.improve.advice}` : '';
  show($('funnel-improve'), !!funnel.improve);
  $('focus-funnel-notion').dataset.url = funnel.notion_url || '';
  show($('focus-funnel-notion'), !!funnel.notion_url);
}
function editTarget() {
  show($('focus-target-row'));
  $('focus-target').focus();
  $('focus-target').select();
}
// The target is a line of ⚙️ Search settings in Notion; changing it here (or in Settings) writes it there.
export async function saveDailyTarget(input) {
  input.disabled = true;
  const result = await window.pilot.setDailyTarget(input.value);
  input.disabled = false;
  if (!result.ok) { toastMessage('Target not changed', result.error); return false; }
  for (const id of ['focus-target', 'set-target']) $(id).value = result.target;
  return true;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('focus-history-toggle').addEventListener('click', () => showHistory(!historyShown));
  setInterval(() => {  // "Updated 3 min ago" stays true while the page is open
    if (focusUpdatedAt && !focusLoading) focusStatus(`Updated ${savedAgo(new Date(focusUpdatedAt).toISOString())}`);
  }, 60000);
  $('focus-funnel-notion').addEventListener('click', event => {
    event.preventDefault();
    if (event.currentTarget.dataset.url) window.pilot.openNotion(event.currentTarget.dataset.url, event.metaKey);
  });
  $('focus-edit-target').addEventListener('click', event => { event.preventDefault(); editTarget(); });
  $('focus-edit-reminders').addEventListener('click', event => {
    event.preventDefault();
    openView('settings');
    openSetting('schedule');
  });
  $('focus-refresh').addEventListener('click', loadFocus);
  $('focus-target').addEventListener('change', async () => {
    if (await saveDailyTarget($('focus-target'))) { show($('focus-target-row'), false); loadFocus(); }
  });
  $('focus-remind').addEventListener('change', async () => {  // the Focus page and Settings both save at once
    const on = $('focus-remind').checked;
    await window.pilot.saveSettings({focusReminders: on});
    $('set-remind').checked = on;
    shared.state = await window.pilot.state();
  });

  // The running app is older than this window (updated while open): offer a restart, once.
  window.addEventListener('pilot-outdated', () => {
    if (shared.outdatedShown) return;
    shared.outdatedShown = true;
    const toast = toastMessage('Job Pilotto was updated', 'Restart it to finish the update: some buttons won\'t work until then. Click here to restart.');
    if (toast) toast.onclick = () => window.pilot.interviews.relaunch();
  });
}
