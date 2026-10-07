// Connecting Notion from anywhere in the window (Notion later: the app only tries until it is connected): the dialog with the
// advantages, the locked pages, and the listener for any action that answers {needsNotion, reason} (see preload.cjs).
import {$, message, show} from './core.js';
import {el, notionBenefits, notionGate} from '../components.js';
import {GATE_FOOTNOTE, GATE_TITLE, LOCKED_VIEWS, WHY_CHOICES} from '../notion-benefits.js';
import {closeOnProgress, ignoreGateEvent} from '../notion-connect-rules.js';
import {shared} from './shared.js';

export const notionConnected = () => !!shared.state?.notion?.NOTION_PROFILE_PAGE_ID;
export const reasonText = reason => {
  const words = shared.state?.notionReasons?.[reason];
  return words ? `Connect Notion ${words}.` : '';
};

// What happened to the prompt, to the app (lib/notion-gate.js gateEvent keeps only fixed lists; nothing else is sent).
const report = (reason, where, outcome, why) => window.pilot.notionGateEvent({reason, where, outcome, why}).catch?.(() => {});

let current = null;  // the open prompt: {reason, where, from, then, sent, notNow, why, connecting}
let underwaySince = 0;  // news of a connect this prompt did not start (Settings, a token): see notion-connect-rules.js
function finish(outcome) {
  if (!current || current.sent) return;
  current.sent = true;
  report(current.reason, current.where, outcome, outcome === 'not_now' ? current.why : undefined);
}

function progressLine({found, total, building, waitingPage, template, moving}) {
  if (moving) return 'Moving your strategy and matches into Notion…';
  if (building) return 'Connected ✓ Building your Job Pilotto workspace in Notion (databases, columns, pages)… about a minute.';
  if (waitingPage) return 'Waiting for Notion to share your Job Pilotto page with the app…';
  return template ? `Connected ✓ Notion is copying the Job Pilotto template into your workspace: ${found} of ${total} ready. About a minute; the app keeps checking.`
    : `Notion is still sharing your workspace with the connection: ${found} of ${total} found. This can take a minute; the app keeps checking.`;
}

// reason: a key of lib/notion-gate.js REASONS, or 'none' (the Optional extras card, Settings). where: dialog | extras | settings.
// then(): runs after a successful connect (the action the user asked for, or a redraw).
export function openNotionConnect({reason = 'none', where = 'dialog', from = 'dialog', then = null} = {}) {
  const dialog = $('notion-connect-dialog');
  current = {reason, where, from, then, sent: false, notNow: false, why: null};
  $('notion-connect-reason').textContent = reasonText(reason);
  show($('notion-connect-reason'), !!reasonText(reason));
  show($('notion-connect-why'), false);
  $('notion-connect-later').textContent = 'Not now';
  $('notion-connect-go').disabled = false;
  message('notion-connect-message', '');
  show($('notion-connect-token'), false);
  show($('notion-connect-import'), !!shared.state?.settings?.importedNotion);   // after an import (main.js importedNotion): the moment a new workspace would be made
  if (!dialog.open) dialog.showModal();
}

async function connect() {
  if (!current) return;
  const box = current;
  box.connecting = true;
  $('notion-connect-go').disabled = true;
  message('notion-connect-message', 'Waiting for Notion: approve in your browser, then come back here…', 'waiting');
  const result = await window.pilot.notionOAuth({from: box.from}).catch(error => ({ok: false, error: error.message}));
  $('notion-connect-go').disabled = false;
  if (!result.ok) {
    report(box.reason, box.where, 'failed');  // the prompt stays open: try again, or paste a token in Settings
    message('notion-connect-message', result.error || 'Not connected.', 'error');
    show($('notion-connect-token'));
    return;
  }
  shared.state = await window.pilot.state();
  finish('connected');
  message('notion-connect-message', result.kept
    ? `Connected ✓ Your Notion already had a Profile, so it was kept. This Mac's version is saved in ${result.kept}.`
    : 'Connected ✓', 'ok');
  setTimeout(() => { $('notion-connect-dialog').close(); box.then?.(); }, result.kept ? 4000 : 900);
}

// Open one of the user's Notion pages (a key of state.notion), or the connect prompt when Notion isn't connected.
// Opening takes about a second: the button that asked shows it (disabled, "Opening…"), for every caller at once (#66 Strategy, #74 Settings).
export async function openInNotion(key, event, reason = 'profile') {
  if (!notionConnected()) { openNotionConnect({reason, where: 'dialog', from: `gate:${reason}`}); return; }
  const button = event?.currentTarget?.tagName === 'BUTTON' ? event.currentTarget : null;
  // The words change only where they are plain text (a <span>, or a button with no icon): an icon inside must survive.
  const label = button && (button.querySelector('span') || (button.children.length ? null : button));
  const was = label?.textContent;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); if (label) label.textContent = 'Opening…'; }
  try { return await window.pilot.openNotion(shared.state.notion[key], !!event?.metaKey); }
  finally { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); if (label) label.textContent = was; } }
}

// Settings → Notion: the advantages and "Connect" until it is connected; "Reconnect" after.
export function showNotionPanel() {
  const on = notionConnected();
  const list = $('set-notion-benefits');
  if (!list.children.length) list.replaceChildren(...notionBenefits().children);
  show(list, !on);
  $('set-notion-oauth').textContent = on ? 'Reconnect with Notion' : 'Connect with Notion';
}

// A page that needs Notion: until it is connected only the gate card shows. true = locked (don't load the page).
const viewed = new Set();
export function applyViewGate(name, {then = null} = {}) {
  const view = document.querySelector(`.view[data-view="${name}"]`);
  const reason = LOCKED_VIEWS[name];
  if (!view || !reason) return false;
  const locked = !notionConnected();
  view.classList.toggle('notion-locked', locked);
  let host = view.querySelector(':scope > .notion-gate-host');
  if (!locked) { host?.remove(); return false; }
  if (!host) { host = el('div', 'notion-gate-host'); view.prepend(host); }
  host.replaceChildren(notionGate({reasonText: reasonText(reason),
    onConnect: () => openNotionConnect({reason, where: 'view', from: `gate:${reason}`, then})}));
  if (!viewed.has(name)) { viewed.add(name); report(reason, 'view', 'viewed'); }  // once per page per start
  return true;
}

// Run at start-up (app.js calls each page's init).
export function init() {
  const benefits = $('notion-connect-benefits');
  benefits.replaceChildren(...notionBenefits().children);
  $('notion-connect-title').textContent = GATE_TITLE;
  $('notion-connect-note').textContent = GATE_FOOTNOTE;
  $('notion-connect-go').addEventListener('click', connect);
  // Setup → Optional extras → Notion: the first three advantages; "Connect" opens the prompt on this step (the other extras'
  // buttons finish setup and open Settings, strategy-review.js); connected, the button is "Manage" and does that like the rest.
  $('extras-notion-benefits').replaceChildren(...notionBenefits(3, {compact: true}).children);
  $('extras-notion').addEventListener('click', event => {
    if (notionConnected()) return;
    event.stopImmediatePropagation();  // this listener is registered first: the finish-setup handler never runs
    openNotionConnect({reason: 'none', where: 'extras', from: 'wizard', then: () => import('./settings.js').then(settings => settings.showExtrasStatus())});
  });
  $('notion-connect-later').addEventListener('click', () => {
    if (!current) return;
    if (current.notNow) { $('notion-connect-dialog').close(); return; }
    current.notNow = true;
    show($('notion-connect-why'));
    $('notion-connect-later').textContent = 'Close';
  });
  $('notion-connect-why').replaceChildren(el('span', 'muted small', 'Why not? (optional)'), ...WHY_CHOICES.map(([key, label]) => {
    const chip = el('button', 'ui-tag is-action', label);
    chip.type = 'button';
    chip.addEventListener('click', () => { if (current) current.why = key; $('notion-connect-dialog').close(); });
    return chip;
  }));
  // Closed by Esc, the backdrop, Close or a chip: Not now when it was asked, else just closed (a connect already reported itself).
  $('notion-connect-dialog').addEventListener('close', () => { finish(current?.notNow ? 'not_now' : 'closed'); });
  // Any action that needs Notion (preload.cjs): the prompt, then the same action again, then the Jobs list read afresh.
  window.addEventListener('pilot-needs-notion', () => {
    const need = window.pilot.takeNotionNeed();
    if (!need || $('notion-connect-dialog').open) return;
    if (ignoreGateEvent({since: underwaySince})) return;   // a connect is already running: asking again would stack a prompt on it
    openNotionConnect({reason: need.reason, where: 'dialog', from: `gate:${need.reason}`, then: async () => {
      await window.pilot.retryNotionNeed().catch(() => null);
      import('./jobs.js').then(jobs => jobs.loadJobs());
    }});
  });
  window.pilot.onNotionProgress(progress => {
    const dialog = $('notion-connect-dialog'), own = !!current?.connecting;
    if (!own) underwaySince = Date.now();
    if (closeOnProgress({dialogOpen: dialog.open, ownConnect: own})) { dialog.close(); return; }
    if (dialog.open && current) message('notion-connect-message', progressLine(progress), 'waiting');
  });
}
