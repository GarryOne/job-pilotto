// Session page: what Claude needs from you, and the form page in step.
import {el, pill} from '../components.js';
import {replyOf, splitLabel, unbold} from '../session-message.js';
import {isSubmitted, tabClosed} from '../session-state.js';
import {icon} from '../icons.js';
import {sameQuestion} from '../labels.js';
import {KNOCKOUT} from '../knockout.js';
import {answerOptions} from '../answer-options.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {openView} from './nav.js';
import {openSession, renderSessionPage, say} from './session-log.js';
import {firstLine, refreshSessions, renderDock, sessionCompany, sessionList} from './sessions.js';
import {toastMessage} from './startup.js';
import {openMatchCheck} from './match-check.js';

// Something only you can do, with its most likely action one click away: a judgement call (Claude's proposed
// answer, or another you saved for the same question) or an agreement (open the form to tick it).
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
// The answers you already saved (Notion → Application Answers, the same page the Profile shows), for the rows that
// offer a choice: read once, on the side, the first time a row wants them. Offline or without Notion the row still
// offers Claude's own answer and "Change with Claude…".
let knownAnswers = [], answersAsked = false;
function loadAnswers() {
  if (answersAsked) return;
  answersAsked = true;
  window.pilot.standardAnswers().then(result => {
    if (!result?.ok) return;
    knownAnswers = (result.groups || []).flatMap(group => group.items || [])
      .filter(item => item?.question && item?.answer && !item.open && !item.guidance);
    if (knownAnswers.length && !$('ss-needs-card').hidden) renderSessionPage();
  }).catch(() => {});
}
// The answer you have for one question (this page's own memory first, then the ones saved in Notion).
const savedFor = question => (knownAnswers.find(item => sameQuestion(item.question, question)) || {}).answer || '';
// The row's badge: its place in the list (updateNeedsCount numbers the open ones), a tick once it's handled.
const badge = () => el('span', 'ss-need-num', '');
// The row's two lines: a bold title, and under it Claude's own words about it (a judgement call's "**Pay:** below
// your minimum." reads as the title "Pay" and the line "below your minimum.").
function rowWords(need) {
  if (need.kind === 'ask') return {title: need.question || firstLine(need.text || '', 80), desc: need.why || ''};
  const {label, text} = splitLabel(need.text || '');
  const title = need.label || label || firstLine(text, 80);
  const desc = (need.label || label) ? text : text.slice(title.length).trim();
  return {title: unbold(title), desc: unbold(desc)};   // Claude's **bold** marks are not words to show (8 Oct 2026)
}
// A title keeps to one line (the row is a summary): the whole question on hover.
function titleLine(text) {
  const node = el('b', 'ss-need-title', text);
  node.title = text;
  return node;
}
function doneRow(li, key, outcome) {
  handled.set(key, outcome);
  keep();
  li.classList.add('is-done');
  const number = li.querySelector('.ss-need-num');
  if (number) number.textContent = '✓';
  li.querySelector('.ss-need-actions')?.replaceChildren(el('span', 'small ss-need-outcome', `✓ ${outcome}`));
  updateNeedsCount();
}
// The form page says every required field is filled (the extension's ring is green).
export const formReady = item => !formGone(item) && !!reviewStates.get(item.id)?.ready;
// The form's Chrome tab was closed: the extension is reporting in and no open tab is this session's form (it was
// seen before, so a form never opened is not "closed"). Its cached count and "Ready to submit" are then stale.
export const formGone = item => tabClosed(item, shared.formsOpen, !!reviewStates.get(item.id)?.total);
// What's left, said the way you act on it: "2 actions remaining". The split it counts (in the form, to check) is the
// pill's tooltip — the rows themselves say which is which.
export function updateNeedsCount() {
  const open = [...document.querySelectorAll('#ss-needs .ss-need:not(.is-done)')];
  const check = open.filter(li => li.classList.contains('is-confirm')).length, form = open.length - check;
  const detail = [form && `${form} in the form`, check && `${check} to check`].filter(Boolean).join(' · ');
  $('ss-needs-count').replaceChildren(open.length
    ? pill(`${open.length} action${open.length === 1 ? '' : 's'} remaining`, 'warn', {title: detail})
    : pill('All handled', 'good', {dot: true}));
  // The open rows are the numbered list you work through, in order.
  open.forEach((li, i) => { const number = li.querySelector('.ss-need-num'); if (number) number.textContent = String(i + 1); });
  // Now: only what's still open. What was handled (by you or in the form) is the history, one click away.
  const done = document.querySelectorAll('#ss-needs .ss-need.is-done').length;
  // Expanded: the handled rows read as the history the footer counts, under the open ones.
  const list = $('ss-needs');
  if ($('ss-needs-card').classList.contains('show-history')) for (const li of list.querySelectorAll('.ss-need.is-done')) list.append(li);
  $('ss-needs-card').classList.toggle('is-all-done', !open.length);
  const history = $('ss-needs-history');
  history.hidden = !done;
  history.replaceChildren(icon('check'), el('span', '', `${done} completed action${done === 1 ? '' : 's'}`));
  history.title = $('ss-needs-card').classList.contains('show-history') ? 'Hide what you handled' : 'Show what you handled';
  const head = $('ss-needs-card').querySelector('.ss-fact-head .icon');
  if (head && head.dataset.state !== String(!open.length)) { const glyph = icon(open.length ? 'alert' : 'check'); glyph.dataset.state = String(!open.length); head.replaceWith(glyph); }
}
const capital = text => text.replace(/^./, c => c.toUpperCase());
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
  showFormCard(item, state);
  $('ss-form-state').replaceChildren();  // the "Form completion" card says it (count, bar, pill): once
}
// "Form completion", as on the website: where, "16 / 17 required fields" and the bar always; the fields folded under
// them: what's left first, then each filled one with its time since the fill started (the first field filled).
// "Before you submit": what decides an application more than the CV, from what the form says is still open. The knockout questions (a hiring system can be set to
// reject on them: docs/research/ats-reddit-2026-10.md) and which CV goes in: the general one, or one tailored to this job, with a way to tailor it.
const fullKey = url => String(url || '').trim().replace(/\/$/, '');
const cvSeen = new Map();   // job url → {at, info}
async function cvInfo(url) {
  const known = cvSeen.get(url);
  if (known && Date.now() - known.at < 4000) return known.info;
  const info = await window.pilot.cvOf(url).catch(() => null);
  cvSeen.set(url, {at: Date.now(), info});
  return info;
}
function showBefore(item, left, account = false) {
  const knockouts = left.filter(label => KNOCKOUT.test(label));
  const submitted = isSubmitted(item);
  show($('ss-before-knock'), !submitted && knockouts.length > 0);
  if (knockouts.length) {
    $('ss-before-knock-title').textContent = `${knockouts.length} question${knockouts.length === 1 ? '' : 's'} can reject you automatically, if the employer set a rule`;
    $('ss-before-knock-list').textContent = `Answer ${knockouts.length === 1 ? 'it' : 'them'} yourself, truthfully: ${knockouts.slice(0, 3).map(label => label.replace(/\s*\*\s*$/, '')).join(' · ')}${knockouts.length > 3 ? ' …' : ''}`;
  }
  const job = shared.allJobs.find(candidate => fullKey(candidate.url) === fullKey(item.url));
  show($('ss-before-cv'), false);
  // A sign-in or sign-up page is not the application: no CV goes there (owner, 8 Oct 2026).
  if (submitted || !item.url || account) return show($('ss-before'), !submitted && knockouts.length > 0);
  cvInfo(item.url).then(info => {
    if (!info) return;
    show($('ss-before-cv'), true);
    $('ss-before-cv-mark').textContent = info.tailored ? '✓' : '○';
    $('ss-before-cv-title').textContent = info.tailored ? 'A CV tailored to this job is ready' : info.working ? 'Tailoring your CV for this job…' : 'This form gets your general CV';
    $('ss-before-cv-sub').textContent = info.tailored ? 'Press Fill again on the form if it still shows your general CV.' : info.working ? 'About 1–2 minutes. Then fill the form again.'
      : 'A CV written for the job gets noticeably more replies than a general one.';
    const compare = $('ss-before-match-btn');
    show(compare, !!job?.code);
    compare.onclick = () => openMatchCheck(job);
    const button = $('ss-before-cv-btn');
    show(button, !info.tailored && !info.working && !!job?.code);
    button.disabled = false;
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = 'Tailoring… (about 1–2 min)';
      const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`);
      button.textContent = result.ok ? 'Tailored ✓' : 'Retry';
      button.disabled = !!result.ok;
      cvSeen.delete(item.url);
      if (result.ok) showBefore(item, left);
    };
    show($('ss-before'), true);
  });
  show($('ss-before'), knockouts.length > 0);
}
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function showFormCard(item, state) {
  const card = $('ss-form-card');
  card.hidden = !state?.total || formGone(item);
  if (card.hidden) return;
  const done = state.total - state.left;
  let host = '';
  try { host = state.url ? new URL(state.url).hostname.replace(/^www\./, '') : ''; } catch {}
  $('ss-form-where').textContent = host ? `Chrome · ${host}` : '';
  $('ss-form-pill').replaceChildren(isSubmitted(item) ? pill('Submitted', 'good', {dot: true})
    : state.ready ? pill('Ready to submit', 'good', {dot: true})
    : pill(`${state.left} remaining`, 'warn', {title: `${state.total - state.left} of ${state.total} required fields filled (the ring on the form lists the rest)`}));
  const count = $('ss-form-count');
  count.replaceChildren(el('b', '', String(done)), el('span', '', ` of ${state.total} required fields`));
  $('ss-form-bar').style.width = `${Math.round(100 * done / state.total)}%`;
  card.classList.toggle('is-ready', !!state.ready);
  showBefore(item, state.pending || state.missing || [], !!state.account);
  // An extension older than 0.8.12 sends no filled fields: then only what's left.
  const filled = [...(state.filled || [])].sort((a, b) => a.at - b.at);
  const left = state.pending || state.missing || [];
  const start = filled.find(field => field.at)?.at || 0;
  $('ss-form-more').hidden = !filled.length && !left.length;
  const leftCount = Math.max(left.length, state.left);
  const leftText = leftCount ? `${leftCount} ${item.status === 'running' ? 'to go' : 'left'}` : '';
  $('ss-form-summary').textContent = filled.length ? `Show the ${filled.length} filled field${filled.length === 1 ? '' : 's'}${leftText ? ` and ${leftText}` : ''}`
    : `Show the ${leftText}`;
  // Who filled it: you (after the fill was over) or the fill (Claude, the extension); the time only when the app saw it.
  const row = (kind, time, mark, label, by = '') => {
    const li = el('li', kind);
    const text = el('span', 'ss-form-label', label);
    text.title = label;
    li.append(el('span', 'ss-form-time', time), el('b', 'ss-form-mark', mark), text);
    if (by) li.append(el('span', 'ss-form-by', by));
    return li;
  };
  $('ss-form-fields').replaceChildren(
    ...left.map(label => row('is-left', '', '○', label)),
    ...filled.map(field => row(field.by === 'you' ? 'is-filled is-yours' : 'is-filled', field.at ? clock(Math.max(0, field.at - start)) : '', '✓', field.label,
      field.by === 'you' ? 'you' : '')));
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
  // What's left as the form's ring counts it (pending: required, or an answer Claude wrote that is empty again; an
  // extension before 0.8.12 sends only the required ones), and never fewer than its count: "16 / 17" beside "All
  // handled" was a contradiction.
  const state = reviewStates.get(item.id);
  const listed = needs.flatMap(need => [agreeLabel(need), need.question, need.text]).filter(Boolean);
  const left = (state?.pending || state?.missing || []).filter(label => label && !listed.some(text => sameQuestion(text, label)));
  const unnamed = (state?.left || 0) - (state?.pending || state?.missing || []).length;
  if (unnamed > 0) left.push(`${unnamed} more field${unnamed === 1 ? '' : 's'}`);
  return left;
}
export function emptyRow(label, item) {
  const li = el('li', 'ss-need is-empty'), body = el('div', 'ss-need-body'), actions = el('div', 'ss-need-actions');
  li.dataset.empty = label;
  const more = /^\d+ more fields?$/.test(label);
  const name = label.replace(/\s*\*\s*$/, '');
  body.append(titleLine(name), el('span', 'ss-need-desc small', more
    ? `Still empty in the form (the ring on the form lists ${label.startsWith('1 ') ? 'it' : 'them'}).`
    : 'This section is still empty in the form.'));
  actions.append(more ? smallButton('Open the form', 'primary', event => openForm(item, event.currentTarget))
    : smallButton('Open in form', 'secondary is-signal', event => showInForm(item, label, event.currentTarget)));
  li.append(badge(), body, actions);
  return li;
}
// A problem with the extension: when Chrome runs an older copy than this app's, that's the likely cause; say how to
// fix it. The sentence comes from the app (server.staleExtension), so it is the same one a failed fill records.
export async function explainExtension(row) {
  const seen = await window.pilot.extensionSeen().catch(() => null);
  if (!seen?.note) return;
  row.append(el('div', 'small ss-check-more', `Likely cause: ${seen.note}`));
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
// Plain "Open in Chrome": one attempt. Chrome comes forward on that job's form tab; when no tab is it, the form opens again.
export async function openForm(item, button) {
  const result = await opening(button, () => window.pilot.showBrowser(item.url, sessionCompany(item), item.id));
  return result?.went === 'none' ? reopenClosedTab(item, button) : result;
}
// What this page holds from the session's form tab: rows you handled, the form's progress, the stuck flag, Claude's question.
const rowsOf = id => [...handled.keys(), ...syncedDone].filter(key => key.startsWith(`${id}|`));
export const staleState = item => !!(rowsOf(item.id).length || reviewStates.get(item.id)?.total || item.stuck || (item.kind !== 'form' && item.question));
// Every button that looks for the form's Chrome tab ends here when the tab is gone (Open in Chrome, Open filled form, Reopen
// form, Review in form, Open in form, Open the form): the form opens again in a new tab with the fill mark, after asking
// whether to start the application again when the page holds the closed tab's state (owner, 8 Oct 2026: the toast told you
// to open it yourself, and the old rows stayed).
export async function reopenClosedTab(item, button) {
  const result = await window.pilot.sessionReopen(item.id, staleState(item));   // not 'Looking for the form tab…' under the question
  if (result?.cancelled) return result;
  if (result?.ok === false) { toastMessage('Could not open the form', result.error || 'Try again.'); return result; }
  if (result?.reset) {
    for (const key of rowsOf(item.id)) { handled.delete(key); syncedDone.delete(key); }
    keep();
    reviewStates.delete(item.id);
    batch.delete(item.id);
  }
  toastMessage(result?.reset ? 'Started again' : 'The form tab was closed', result?.session
    ? 'A new Claude session starts on this job and opens the form in Chrome.'
    : result?.reset ? 'Opened the form in a new Chrome tab; the extension fills it from your kit.' : 'Opened the form again in a new Chrome tab.');
  await refreshSessions();
  if (result?.session?.id) openSession(result.session.id); else renderSessionPage();
  return result;
}
// Chrome comes forward on the form tab and the page scrolls to the field. When no page picked the request up, say why.
async function showInForm(item, label, button) {
  const result = await opening(button, () => window.pilot.reviewFocus(item.id, label, item.url, sessionCompany(item)));
  if (result?.taken) {
    if (result.found === false) toastMessage('Not a field on this form', `"${label}" is not a label on the open form.`);
    return;
  }
  if (result?.outdated) toastMessage('Reload the Chrome extension once', `Chrome still runs Job Pilotto ${result.extension}; this app has ${result.latest}. ` +
    'In Chrome open chrome://extensions and click ↻ on Job Pilotto. Your open forms keep their answers; later updates load by themselves.');
  else if (result?.went === 'none') await reopenClosedTab(item, button);
  else if (result?.went !== 'tab') toastMessage('Opened the job in Chrome', `Find "${label}" in its form.`);
  else toastMessage('Scroll to it yourself this time', `The form tab is open, but the extension could not attach to it. Look for "${label}" in the form.`);
}
// Answers wait here until you send them all at once (owner, 8 Oct 2026: one answer sent at once made Claude reply, and its new
// message redrew the list, so the other questions vanished before you could answer them). Each answer names its question.
const batch = new Map();   // session id → Map(row key → {line, last})
function queue(item, key, line, {last = false} = {}) {
  if (!batch.has(item.id)) batch.set(item.id, new Map());
  batch.get(item.id).set(key, {line, last});
  setTimeout(() => showSendBar(item));   // after the row is marked done, so the count of open ones is right
}
// One message for Claude: the answers, numbered, each with its question; a reply it asked for ("ok") last.
export function batchMessage(entries) {
  const answers = entries.filter(entry => !entry.last).map(entry => entry.line);
  const replies = entries.filter(entry => entry.last).map(entry => entry.line);
  return [answers.length ? `My answers to your list, put them in the form: ${answers.map((line, at) => `${at + 1}) ${line}`).join('; ')}.` : '', ...replies]
    .filter(Boolean).join(' Then: ');
}
export function showSendBar(item) {
  const bar = $('ss-needs-send');
  if (!bar) return;
  const waiting = [...(batch.get(item?.id)?.values() || [])];
  show(bar, waiting.length > 0 && shared.openSessionId === item?.id);
  if (!waiting.length) return;
  const open = document.querySelectorAll('#ss-needs > .ss-need:not(.is-done)').length;
  $('ss-needs-send-text').textContent = `${waiting.length} answer${waiting.length === 1 ? '' : 's'} ready${open ? ` · ${open} still open` : ''}`;
  const button = $('ss-needs-send-btn');
  button.textContent = waiting.length === 1 ? 'Send it to Claude' : `Send all ${waiting.length} to Claude`;
  button.disabled = !!offline(item);
  button.onclick = () => { say(batchMessage(waiting)); batch.delete(item.id); show(bar, false); };
}
export function needRow(need, item) {
  const key = `${item.id}|${need.text}`, li = el('li', `ss-need is-${need.kind}`);
  li.dataset.key = key;
  const body = el('div', 'ss-need-body');
  const {title, desc} = rowWords(need);
  body.append(titleLine(title));
  if (desc) body.append(el('span', 'ss-need-desc small', desc));
  const actions = el('div', 'ss-need-actions');
  // What an answer is about: the field's label, else the item itself. "this" alone told Claude nothing (8 Oct 2026: "Change this in the form: Yes").
  const name = need.label ? unbold(need.label) : `"${title}"`;
  const reply = need.kind !== 'agree' && replyOf(title);
  if (reply) {   // "Reply ok, and I'll click Create an account": one button that sends it, not a field to review
    actions.append(smallButton(`Reply "${reply}"`, 'primary', () => { queue(item, key, reply, {last: true}); doneRow(li, key, `To send: ${reply}`); }, offline(item)));
    li.append(badge(), body, actions);
    if (handled.has(key)) doneRow(li, key, handled.get(key));
    return li;
  }
  if (need.kind === 'agree') {
    // Chrome comes forward on the form and the page scrolls to this field (extension/review.js picks it up).
    actions.append(smallButton('Review in form', 'primary', event => showInForm(item, agreeLabel(need), event.currentTarget)),
      smallButton('Done', 'secondary', () => doneRow(li, key, 'Ticked in the form')));
    li.dataset.watch = watchId(need.text);
  } else {
    // A judgement call: Claude's proposed answer is chosen; the list holds the other answers you saved for the same
    // question, and the last entry asks Claude for a different one instead.
    loadAnswers();
    const choices = answerOptions(need, knownAnswers);
    const chip = el('span', 'ss-answer');
    // Only "Change with Claude…" to pick (Claude proposed nothing, and none is saved): a lone dropdown under the label
    // "Proposed answer" proposes nothing, so the row gets one plain button instead.
    const onlyChange = choices.length === 1;
    chip.append(el('span', 'ss-answer-label', 'Proposed answer'));
    const select = el('select', 'ss-answer-select');
    select.title = 'Claude\'s answer, or one of the answers you saved for this question';
    for (const choice of choices) {
      const node = el('option', '', choice.kind === 'change' ? choice.label : `✓ ${capital(choice.label)}`);
      node.value = choice.value;
      select.append(node);
    }
    // "Change with Claude…": say what it should be instead, in your own words.
    const ask = () => {
      const input = el('input', 'ss-ask-input');
      input.placeholder = `What should ${name} be?`;
      const send = () => {
        if (!input.value.trim()) return;
        queue(item, key, `${name}: ${input.value.trim()}`);
        doneRow(li, key, `To send: ${input.value.trim()}`);
      };
      const before = [...actions.childNodes];
      const back = () => { li.classList.remove('is-asking'); actions.replaceChildren(...before); };
      input.addEventListener('keydown', event => { if (event.key === 'Enter') send(); if (event.key === 'Escape') back(); });
      li.classList.add('is-asking');   // the answer box takes its own line under the text, not a corner of the row
      actions.replaceChildren(input, smallButton('Send to Claude', 'primary', send, offline(item)), smallButton('Cancel', 'secondary', back));
      input.focus();
    };
    select.addEventListener('change', () => {
      const chosen = choices.find(choice => choice.value === select.value);
      if (!chosen || chosen.kind === 'change') { ask(); return; }
      // A recommendation that isn't "keep it as it is" is an instruction for Claude, not just an acknowledgement.
      const change = chosen.kind === 'proposed' && !!need.recommended && !KEEP.test(need.recommended);
      if (chosen.kind === 'saved' || change) queue(item, key, `${name}: ${chosen.value}`);
      doneRow(li, key, chosen.kind === 'saved' || change ? `To send: ${chosen.value}` : 'Checked');
    });
    if (offline(item)) { select.disabled = true; select.title = offline(item); }
    chip.append(select);
    actions.append(onlyChange ? smallButton('Tell Claude…', 'secondary', ask, offline(item)) : chip, smallButton('Review in form', 'primary', event => showInForm(item, agreeLabel(need), event.currentTarget)));
  }
  li.append(badge(), body, actions);
  if (handled.has(key)) doneRow(li, key, handled.get(key));
  return li;
}
// A fact Claude couldn't find: its suggested answer (editable), and a tick that saves it to your standard answers
// in Notion, so every later application has it. Type it in the form too: the form is already filled.
const savedAnswers = remembered(new Map(), keptRows.saved);  // question → the answer saved (the page redraws often)
export function askRow(need, item) {
  const li = el('li', 'ss-need is-ask');
  const body = el('div', 'ss-need-body');
  body.append(titleLine(need.question));
  if (need.why) body.append(el('span', 'ss-need-desc small', need.why));
  const input = el('input', 'ss-ask-input');
  input.type = 'text';
  input.placeholder = 'Your answer';
  loadAnswers();
  const saved = savedAnswers.get(need.question) ?? savedFor(need.question);
  input.value = saved || need.suggested;
  const box = el('label', 'ss-ask-save');
  const tick = el('input');
  tick.type = 'checkbox';
  // What saving does, said plainly: the answer goes to your Answers in Notion and every later form fills it by itself.
  // Once the question is handled its input is hidden, so the row says which answer it would keep.
  const shown = () => (input.value.trim() ? `"${input.value.trim().slice(0, 80)}"` : 'this answer');
  const offer = () => `Remember ${shown()} for future forms`;
  const note = el('span', 'small', saved ? `Remembered ${shown()} for future forms` : offer());
  box.title = 'Saves it to your Answers in Notion: later forms with this question fill it without asking you.';
  box.append(tick, note);
  input.addEventListener('input', () => { if (!tick.checked) note.textContent = offer(); });
  tick.checked = input.disabled = tick.disabled = !!saved;
  tick.addEventListener('change', async () => {
    const value = input.value.trim();
    if (!value) { tick.checked = false; note.textContent = 'Write an answer first'; input.focus(); return; }
    tick.disabled = input.disabled = true;
    note.textContent = 'Saving to Notion…';
    const result = await window.pilot.rememberAnswer(need.question, value);
    if (result.ok) { savedAnswers.set(need.question, value); keep(); note.textContent = `Remembered ${shown()} for future forms`; box.classList.add('is-saved'); return; }
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
    queue(item, key, `"${need.question}": ${value}`);
    handled.set(key, `To send: ${value}`);
    keep();
    li.classList.add('is-done');
    const number = li.querySelector('.ss-need-num');
    if (number) number.textContent = '✓';
    fill.replaceWith(el('span', 'small ss-need-outcome', `✓ To send: ${value}`));
    updateNeedsCount();
  }, offline(item));
  const line = el('div', 'ss-ask-line');
  const actions = el('span', 'ss-need-actions');
  actions.append(fill);
  line.append(input, actions, box);
  body.append(line);
  li.append(badge(), body);
  if (handled.has(key)) { li.classList.add('is-done'); actions.replaceChildren(el('span', 'small ss-need-outcome', `✓ ${handled.get(key)}`)); }
  return li;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // The cards' header bars fold and unfold them: Form completion's field list, the needs' history.
  const toggleHistory = () => {
    if ($('ss-needs-history').hidden) return;
    $('ss-needs-card').classList.toggle('show-history');
    updateNeedsCount();
  };
  $('ss-needs-history').addEventListener('click', toggleHistory);
  $('ss-needs-card').querySelector('.ss-fact-head').addEventListener('click', event => { if (!event.target.closest('a, button, input, select')) toggleHistory(); });
  for (const bar of ['.ss-form-head', '.ss-form-progress'])
    $('ss-form-card').querySelector(bar).addEventListener('click', () => { const more = $('ss-form-more'); if (!more.hidden) more.open = !more.open; });
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
    if (item && shared.openSessionId === state.id && !document.querySelector('.view[data-view="sessions"]').hidden) {
      applyFormStates(item);
      showFormState(item);  // filled fields arrive while the session is still running
    }
  });
  document.querySelector('.sd-head').addEventListener('click', event => {
    if (event.target.closest('#sd-all')) return;
    if (event.target.closest('.sd-link')) { openSession(shared.openSessionId || sessionList[0]?.id); return; }
    shared.dockOpen = !shared.dockOpen;
    renderDock();
  });
  $('sd-all').addEventListener('click', event => { event.preventDefault(); openSession(shared.openSessionId || sessionList[0]?.id); });
  $('ss-new').addEventListener('click', () => openView('jobs'));
  $('ss-empty-jobs').addEventListener('click', () => openView('jobs'));  // the empty state's one action
}
