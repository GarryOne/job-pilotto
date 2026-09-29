// Focus page.
import {el, moreButton, pill} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {automationChanged} from './connections.js';
import {$, savedAgo, show} from './core.js';
import {openView} from './nav.js';
import {openSetting} from './settings.js';
import {toastMessage} from './startup.js';
import {openFeedback, saveFeedbackAction} from './feedback.js';

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
  if (item.kind.startsWith('feedback') && item.kind !== 'feedback_wait') more.push({label: 'Add employer feedback', run: () => openFeedback(item, 'receive')});
  if (item.kind === 'feedback') more.push({label: 'Skip this request', run: async () => {
    const result = await saveFeedbackAction(item, 'skip');
    if (!result.ok) toastMessage('Not saved', result.error);
  }});
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
  $('set-target').addEventListener('input', automationChanged);
  $('set-remind').addEventListener('change', automationChanged);
  $('focus-remind').addEventListener('change', async () => {  // the Focus page saves at once; Settings with Save changes
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
