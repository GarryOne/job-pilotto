// Session page: what Claude needs from you, and the form page in step.
import {el, pill} from '../components.js';
import {splitLabel} from '../session-message.js';
import {icon} from '../icons.js';
import {sameQuestion} from '../labels.js';
import {shared} from './shared.js';
import {$} from './core.js';
import {openView} from './nav.js';
import {richText} from './rich-text.js';
import {openSession, renderSessionPage, say} from './session-log.js';
import {firstLine, renderDock, sessionCompany, sessionList} from './sessions.js';
import {toastMessage} from './startup.js';

// Something only you can do, with its most likely action one click away: a judgement call (Claude's recommended
// action, else "Looks right"; "Change…" tells Claude what to change) or an agreement (open the form to tick it).
// A handled row stays, marked done, until the page is closed.
// What you did on each row ("Done", "Looks right", ticked in the form), kept across a reload (⌘R) and a restart: in this
// window's local storage (a note of what you clicked, not data: Notion and the form hold the answers).
const KEPT = 'jobpilotto.session-rows';
const keptRows = (() => { try { return JSON.parse(localStorage.getItem(KEPT) || '{}'); } catch { return {}; } })();
const keep = () => { try { localStorage.setItem(KEPT, JSON.stringify({handled: [...handled], synced: [...syncedDone], saved: [...savedAnswers]})); } catch {} };
const remembered = (map, entries) => { for (const [key, value] of entries || []) map.set(key, value); return map; };
const handled = remembered(new Map(), keptRows.handled);  // `${session}|${text}` → what was done
const KEEP = /^(?:keep|leave|ok|fine|no change|looks right|as is|nothing)/i;
const offline = item => (item.live === false ? 'The session has ended: resume it to send this to Claude' : '');
function doneRow(li, key, outcome) {
  handled.set(key, outcome);
  keep();
  li.classList.add('is-done');
  li.querySelector('.ss-need-actions')?.replaceChildren(el('span', 'small ss-need-outcome', `✓ ${outcome}`));
  updateNeedsCount();
}
// The form page says every required field is filled (the extension's ring is green).
export const formReady = item => !!reviewStates.get(item.id)?.ready;
// What's left, said the way you act on it: "2 in the form · 3 to check" (judgement calls apart from form fields).
export function updateNeedsCount() {
  const open = [...document.querySelectorAll('#ss-needs .ss-need:not(.is-done)')];
  const check = open.filter(li => li.classList.contains('is-confirm')).length, form = open.length - check;
  const text = [form && `${form} in the form`, check && `${check} to check`].filter(Boolean).join(' · ');
  $('ss-needs-count').replaceChildren(open.length ? pill(text, 'warn') : pill('All handled', 'good', {dot: true}));
  // All handled: the card folds to its header (a click shows the rows again).
  $('ss-needs-card').classList.toggle('is-all-done', !open.length);
  const head = $('ss-needs-card').querySelector('.ss-fact-head .icon');
  if (head && head.dataset.state !== String(!open.length)) { const glyph = icon(open.length ? 'alert' : 'check'); glyph.dataset.state = String(!open.length); head.replaceWith(glyph); }
}
function smallButton(text, kind, run, title = '') {
  const button = el('button', `${kind} ss-need-button`, text);
  if (title) { button.disabled = true; button.title = title; }
  button.addEventListener('click', run);
  return button;
}
// ---- In step with the form page (the extension's ring, extension/review.js; lib/review.js) ----
export const reviewStates = new Map();  // session id → {left, total, ready, states: {watch id: ticked}}
const syncedDone = new Set(keptRows.synced || []);    // rows ticked off because the form said so (untick there: back here)
const watchId = text => `w${[...String(text)].reduce((hash, c) => (hash * 31 + c.codePointAt(0)) >>> 0, 7).toString(36)}`;
// The question to find in the form: the bold label Claude gave ("AI Policy for Application"), else its first words.
const agreeLabel = need => splitLabel(need.text).label || firstLine(need.text.replace(/\*\*/g, ''), 80).replace(/[:.]\s*$/, '');
const watching = new Map();      // session id → the JSON last sent, so it's sent when it changes only
// The rows the form page reports on: agreements (ticked?) and questions Claude couldn't answer (answered since?).
export function watchAgreements(item, needs) {
  const items = needs.map(need => ({id: watchId(need.text), label: need.kind === 'ask' ? need.question : agreeLabel(need)}));
  const json = JSON.stringify(items);
  if (watching.get(item.id) === json) return;
  watching.set(item.id, json);
  window.pilot.reviewWatch(item.id, items);
}
// The pill beside the step's title: what the form page says is left, or that it's ready to submit.
export function showFormState(item) {
  const state = reviewStates.get(item.id);
  const box = $('ss-form-state');
  if (!state || !state.total) { box.replaceChildren(); return; }
  box.replaceChildren(state.ready ? pill('Form ready to submit', 'good', {dot: true})
    : pill(`Form: ${state.left} required left`, 'warn', {dot: true, title: `${state.total - state.left} of ${state.total} required fields filled (the ring on the form lists them)`}));
}
export function applyFormStates(item) {
  const state = reviewStates.get(item.id);
  if (!state) return;
  for (const li of document.querySelectorAll('#ss-needs .ss-need[data-watch]')) {
    const ticked = state.states?.[li.dataset.watch];
    const key = li.dataset.key;
    const outcome = li.classList.contains('is-ask') ? 'Filled in the form' : 'Ticked in the form';
    if (ticked === true && !li.classList.contains('is-done')) { syncedDone.add(key); doneRow(li, key, outcome); }
    if (ticked === false && syncedDone.has(key)) {  // unticked in the form: open again here
      syncedDone.delete(key);
      handled.delete(key);
      keep();
      renderSessionPage();
      return;
    }
  }
  showFormState(item);
}
// Required fields the form page says are still empty and Claude's message didn't list (reworded counts as listed:
// renderer/labels.js): the app finds them itself.
export function emptyFields(item, needs) {
  const listed = needs.flatMap(need => [agreeLabel(need), need.question, need.text]).filter(Boolean);
  return (reviewStates.get(item.id)?.missing || []).filter(label => {
    return label && !listed.some(text => sameQuestion(text, label));
  });
}
export function emptyRow(label, item) {
  const li = el('li', 'ss-need is-empty'), body = el('div', 'ss-need-body'), actions = el('div', 'ss-need-actions');
  li.dataset.empty = label;
  body.append(el('div', '', `${label.replace(/\s*\*\s*$/, '')} is still empty in the form.`));
  actions.append(smallButton('Show it in the form', 'primary', event => showInForm(item, label, event.currentTarget)));
  body.append(actions);
  li.append(el('span', 'ss-need-glyph', '✏️'), body);
  return li;
}
// A problem with the extension: when Chrome runs an older copy than this app's, that's the likely cause; say how to fix it.
export async function explainExtension(row) {
  const seen = await window.pilot.extensionSeen().catch(() => null);
  if (!seen?.version || !seen.latest || seen.version === seen.latest) return;
  row.append(el('div', 'small ss-check-more', `Likely cause: Chrome runs Job Pilotto extension ${seen.version}, older than this app's ${seen.latest}. ` +
    'Reload it once (chrome://extensions → ↻ on Job Pilotto); from then on it updates itself.'));
}
// While Chrome is being brought to the form: the button says so at once, then what's taking time.
export async function opening(button, work) {
  const words = button?.querySelector('span') || button;
  const before = words?.textContent;
  if (button) button.disabled = true;
  if (words) words.textContent = 'Opening…';
  const slow = setTimeout(() => { if (words) words.textContent = 'Looking for the form tab in Chrome…'; }, 2000);
  try { return await work(); } finally {
    clearTimeout(slow);
    if (words) words.textContent = before;
    if (button) button.disabled = false;
  }
}
// Chrome comes forward on the form tab and the page scrolls to the field. When no page picked the request up, say why.
async function showInForm(item, label, button) {
  const result = await opening(button, () => window.pilot.reviewFocus(item.id, label, item.url, sessionCompany(item)));
  if (result?.taken) return;
  if (result?.outdated) toastMessage('Reload the Chrome extension once', `Chrome still runs Job Pilotto ${result.extension}; this app has ${result.latest}. ` +
    'In Chrome open chrome://extensions and click ↻ on Job Pilotto. Your open forms keep their answers; later updates load by themselves.');
  else if (result?.went !== 'tab') toastMessage('Form tab not found', 'No open Chrome tab matches this job. Find the tab Claude used, then click here again.');
  else toastMessage('Scroll to it yourself this time', `The form tab didn't answer: the Job Pilotto extension isn't running on it. Look for "${label}" in the form. ` +
    'In Chrome, chrome://extensions → ↻ on Job Pilotto makes it join the tabs already open.');
}
export function needRow(need, item) {
  const key = `${item.id}|${need.text}`, li = el('li', `ss-need is-${need.kind}`);
  li.dataset.key = key;
  const body = el('div', 'ss-need-body');
  const words = el('div');
  words.append(...richText(need.text).flatMap(node => [...node.childNodes]));
  const actions = el('div', 'ss-need-actions');
  const name = need.label || 'this';
  if (need.kind === 'agree') {
    // Chrome comes forward on the form and the page scrolls to this field (extension/review.js picks it up).
    actions.append(smallButton('Show it in the form', 'primary', event => showInForm(item, agreeLabel(need), event.currentTarget)),
      smallButton('Done', 'secondary', () => doneRow(li, key, 'Ticked in the form')));
    li.dataset.watch = watchId(need.text);
  } else {
    const change = !!need.recommended && !KEEP.test(need.recommended);
    actions.append(smallButton(need.recommended ? `✓ ${need.recommended}` : '✓ Looks right', 'primary', () => {
      if (change) say(`${name}: ${need.recommended}. Change it in the form, then tell me.`);
      doneRow(li, key, change ? `Asked Claude: ${need.recommended}` : 'Checked');
    }, change ? offline(item) : ''));
    const ask = smallButton('Change…', 'link', () => {
      const input = el('input', 'ss-ask-input');
      input.placeholder = `What should ${name} be?`;
      const send = () => {
        if (!input.value.trim()) return;
        say(`Change ${name} in the form: ${input.value.trim()}`);
        doneRow(li, key, `Asked Claude: ${input.value.trim()}`);
      };
      input.addEventListener('keydown', event => { if (event.key === 'Enter') send(); });
      actions.replaceChildren(input, smallButton('Send to Claude', 'primary', send, offline(item)));
      input.focus();
    }, offline(item));
    actions.append(ask);
  }
  body.append(words, actions);
  li.append(el('span', 'ss-need-glyph', need.kind === 'agree' ? '⚖️' : '👀'), body);
  if (handled.has(key)) doneRow(li, key, handled.get(key));
  return li;
}
// A fact Claude couldn't find: its suggested answer (editable), and a tick that saves it to your standard answers
// in Notion, so every later application has it. Type it in the form too: the form is already filled.
const savedAnswers = remembered(new Map(), keptRows.saved);  // question → the answer saved (the page redraws often)
export function askRow(need, item) {
  const li = el('li', 'ss-need is-ask');
  const body = el('div', 'ss-need-body');
  const head = el('div', 'ss-ask-q');
  head.append(el('b', '', need.question));
  if (need.why) head.append(el('span', 'muted small', ` · ${need.why}`));
  const input = el('input', 'ss-ask-input');
  input.type = 'text';
  input.placeholder = 'Your answer';
  const saved = savedAnswers.get(need.question);
  input.value = saved ?? need.suggested;
  const box = el('label', 'ss-ask-save');
  const tick = el('input');
  tick.type = 'checkbox';
  const note = el('span', 'small', saved ? 'Saved to your answers' : need.suggested ? 'Suggested: save it to your answers' : 'Save to your answers');
  box.append(tick, note);
  tick.checked = input.disabled = tick.disabled = !!saved;
  tick.addEventListener('change', async () => {
    const value = input.value.trim();
    if (!value) { tick.checked = false; note.textContent = 'Write an answer first'; input.focus(); return; }
    tick.disabled = input.disabled = true;
    note.textContent = 'Saving to Notion…';
    const result = await window.pilot.rememberAnswer(need.question, value);
    if (result.ok) { savedAnswers.set(need.question, value); keep(); note.textContent = 'Saved to your answers · type it in the form too'; box.classList.add('is-saved'); return; }
    tick.checked = tick.disabled = input.disabled = false;
    note.textContent = result.error || 'Couldn\'t save';
    box.classList.add('is-error');
  });
  if (saved) box.classList.add('is-saved');
  // The one click that unblocks it: Claude types the answer into the form.
  const key = `${item.id}|${need.text}`;
  li.dataset.key = key;
  li.dataset.watch = watchId(need.text);  // the form page says when it has an answer
  const fill = smallButton('Fill it in', 'primary', () => {
    const value = input.value.trim();
    if (!value) { note.textContent = 'Write an answer first'; input.focus(); return; }
    say(`Fill "${need.question}" in the form with: ${value}`);
    handled.set(key, `Asked Claude to fill: ${value}`);
    li.classList.add('is-done');
    fill.replaceWith(el('span', 'small ss-need-outcome', `✓ Asked Claude to fill: ${value}`));
    updateNeedsCount();
  }, offline(item));
  const line = el('div', 'ss-ask-line');
  const actions = el('span', 'ss-need-actions');
  actions.append(fill);
  line.append(input, actions, box);
  body.append(head, line);
  li.append(el('span', 'ss-need-glyph', '❓'), body);
  if (handled.has(key)) { li.classList.add('is-done'); actions.replaceChildren(el('span', 'small ss-need-outcome', `✓ ${handled.get(key)}`)); }
  return li;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('ss-needs-card').querySelector('.ss-fact-head').addEventListener('click', () => {
    if ($('ss-needs-card').classList.contains('is-all-done')) $('ss-needs-card').classList.toggle('is-open');
  });
  // A window that just loaded (⌘R, a restart) asks for every form's last state: the app passes them on only when they
  // change, so without this the ticks from the form stayed away until something changed there.
  window.pilot.reviewStates().then(states => {
    for (const state of states || []) if (!reviewStates.has(state.id)) reviewStates.set(state.id, state);
    renderDock();
    if (!document.querySelector('.view[data-view="sessions"]').hidden) renderSessionPage();
  }).catch(() => {});
  window.pilot.onReview(state => {
    const before = reviewStates.get(state.id);
    const changed = JSON.stringify(before?.missing || []) !== JSON.stringify(state.missing || []);
    reviewStates.set(state.id, state);
    const item = sessionList.find(entry => entry.id === state.id);
    // Ready to submit (or not any more): every pill that shows it, in the dock and the sessions list.
    if (item && !!before?.ready !== !!state.ready) {
      renderDock();
      if (!document.querySelector('.view[data-view="sessions"]').hidden) { renderSessionPage(); return; }
    }
    if (changed && item && shared.openSessionId === state.id) renderSessionPage();
    if (item && shared.openSessionId === state.id && !document.querySelector('.view[data-view="sessions"]').hidden) applyFormStates(item);
  });
  document.querySelector('.sd-head').addEventListener('click', event => {
    if (event.target.closest('#sd-all')) return;
    if (event.target.closest('.sd-link')) { openSession(shared.openSessionId || sessionList[0]?.id); return; }
    shared.dockOpen = !shared.dockOpen;
    renderDock();
  });
  $('sd-all').addEventListener('click', event => { event.preventDefault(); openSession(shared.openSessionId || sessionList[0]?.id); });
  $('ss-crumb-all').addEventListener('click', event => { event.preventDefault(); openSession(shared.openSessionId || sessionList[0]?.id); });
  document.querySelectorAll('.crumbs [data-go]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); openView(link.dataset.go); }));
  $('ss-new').addEventListener('click', () => openView('jobs'));
}
