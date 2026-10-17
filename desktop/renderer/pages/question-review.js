// Application questions, one at a time (owner's mockup, 17 Oct 2026: "THIS IS TOO CROWDED/OVERWHELMING... Move the questionnaire out of the Jobs
// page"): a right drawer over the main column, in the job drawer's frame (job-drawer.css) and its overlay slot (renderer/overlay-slot.js), so it
// never stacks over Recent activity or a job. A fixed header (title, "Question 2 of 9", a bar, a selector to jump around), one question with the
// control of its kind (renderer/question-control.js), a suggested answer told apart from a missing one, its source on demand, and a fixed footer:
// Back · Skip for now · Confirm & next. Drafts are kept when it closes. The queue is Jobs' open questions (pages/jobs-questions.js), so the count is
// the queue's; set-aside questions are listed apart in the selector. Opened from Jobs' card, Profile → Application answers and ⌘K (nav.js).
// Guarded by test/question-review.test.js and test/question-kinds-screens.test.js.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {answerControl} from '../question-control.js';
import {markFor} from '../question-kind.js';
import {claimOverlay, registerOverlay, releaseOverlay} from '../overlay-slot.js';
import {button, skeleton, stateCard} from '../job-drawer/parts.js';
import {loadQuestions, questionsNow} from './jobs-questions.js';
import {$} from './core.js';
import {fromDetailsLine} from '../answered-from-details.js';
import {alsoKeys} from '../question-wordings.js';

const DRAFTS = 'questionDrafts';
const state = {open: false, queue: [], setAside: [], consent: 0, fromDetails: 0, at: 0, aside: null, saved: '', error: '', busy: false, loading: false, failed: ''};
const drafts = new Map();
const jobOnly = new Set();   // the questions whose "Reuse for matching questions" the person turned off (this job only)
try { for (const [key, value] of Object.entries(JSON.parse(localStorage.getItem(DRAFTS) || '{}'))) drafts.set(key, String(value)); } catch {}
const keepDrafts = () => { try { localStorage.setItem(DRAFTS, JSON.stringify(Object.fromEntries(drafts))); } catch {} };

// The selector's words for a question: its first words, never a cut word.
export function shortTitle(text, most = 56) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= most) return clean;
  const cut = clean.slice(0, most);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), most - 12)).replace(/[\s,.;:–—-]+$/, '')}…`;
}

const current = () => state.aside || state.queue[state.at] || null;

function header() {
  const head = el('header', 'jd-head qr-head');
  const top = el('div', 'jd-top');
  const close = Object.assign(el('button', 'ghost icon-btn jd-control'), {type: 'button', title: 'Close', ariaLabel: 'Close'});
  close.append(icon('close'));
  close.addEventListener('click', closeQuestionReview);
  const title = el('div', 'jd-title');
  title.append(el('h2', '', 'Application questions'), el('p', 'muted', 'Review answers before they are reused for matching questions.'));
  top.append(el('span', 'qr-head-icon', icon('chat')), title, close);
  head.append(top);
  if (state.fromDetails > 0) head.append(el('p', 'muted small qr-details', fromDetailsLine(state.fromDetails)));
  if (!state.queue.length && !state.aside) return head;
  const where = el('div', 'qr-where');
  const at = state.aside ? 'A set-aside question' : `Question ${state.at + 1} of ${state.queue.length}`;
  const bar = el('div', 'bar qr-bar');
  const fill = el('span', '');
  fill.style.width = `${Math.round(((state.aside ? 0 : state.at + 1) / Math.max(state.queue.length, 1)) * 100)}%`;
  bar.append(fill);
  where.append(el('b', '', at), bar, picker());
  head.append(where);
  return head;
}

// Jump to any question; the set-aside ones are listed apart (never counted in the queue).
function picker() {
  const select = Object.assign(el('select', 'qr-pick'), {ariaLabel: 'Jump to a question', id: 'qr-pick'});
  state.queue.forEach((q, index) => select.append(new Option(`${index + 1} · ${shortTitle(q.question)}`, `q:${index}`)));
  if (state.setAside.length) {
    const group = Object.assign(document.createElement('optgroup'), {label: `Set aside (${state.setAside.length}): not counted`});
    state.setAside.forEach((q, index) => group.append(new Option(shortTitle(q.question), `s:${index}`)));
    select.append(group);
  }
  select.value = state.aside ? `s:${state.setAside.indexOf(state.aside)}` : `q:${state.at}`;
  select.addEventListener('change', () => {
    const [kind, index] = select.value.split(':');
    state.aside = kind === 's' ? state.setAside[Number(index)] : null;
    if (kind === 'q') state.at = Number(index);
    state.saved = state.error = '';
    draw();
  });
  return select;
}

function question(q) {
  const body = el('div', 'jd-body qr-body');
  const asked = el('p', 'muted small qr-asked', [q.company, 'Application form'].filter(Boolean).join(' · '));
  if (state.aside) asked.append(' ', pill('Set aside', 'neutral'));
  body.append(asked, el('h3', 'qr-question', q.question));
  const suggested = Boolean(q.proposal);
  const box = el('div', `qr-answer ${suggested ? 'is-suggested' : 'is-missing'}`);
  const kind = el('p', 'qr-answer-kind');
  kind.append(icon(suggested ? 'sparkle' : 'alert'), el('span', '', suggested ? 'Suggested from saved answer' : 'Missing answer'));
  box.append(kind);
  const label = el('label', 'qr-label', 'Your answer');
  const control = answerControl(q.format, drafts.get(q.key) ?? q.proposal ?? '', value => {
    if (String(value) === String(q.proposal || '')) drafts.delete(q.key); else drafts.set(q.key, String(value));
    keepDrafts();
    confirm.disabled = state.busy || !control.complete;
  }, {placeholder: 'Type your answer', ariaLabel: q.question});
  control.id = 'qr-control';
  box.append(label, control);
  body.append(box, reuseCard(q));
  if (q.coveredBy) {
    const source = el('details', 'plain qr-source');
    const view = Object.assign(el('button', 'link small', 'View source →'), {type: 'button', id: 'qr-source-go'});
    view.addEventListener('click', () => manageAnswers(q.coveredBy));
    source.append(el('summary', '', 'Source'), el('p', 'muted small', `From your saved answer “${q.coveredBy}”.`), view);
    body.append(source);
  }
  if (q.hint) body.append(el('p', 'muted small', q.hint));
  const drop = Object.assign(el('button', 'link small qr-drop', 'Don’t keep an answer for this'), {type: 'button', id: 'qr-drop',
    title: q.hint !== undefined ? 'Forms leave this field empty (the line stays, answered "— (leave blank)")' : 'Not a question to keep an answer for'});
  drop.addEventListener('click', () => answer(q, ''));
  body.append(drop);
  if (state.saved) body.append(el('p', 'muted small qr-saved', state.saved));
  if (state.error) body.append(el('p', 'message error', state.error));
  if (state.consent) body.append(el('p', 'muted small qr-consent', 'Terms and consent boxes are ticked for you on each form (Settings → Consent boxes turns that off).'));
  const confirm = Object.assign(el('button', 'primary', 'Confirm & next'), {type: 'button', id: 'qr-confirm'});
  confirm.append(icon('chevron'));
  confirm.disabled = state.busy || !control.complete;
  confirm.addEventListener('click', () => control.complete && answer(q, String(control.value).trim()));
  if (control.tagName === 'INPUT') control.addEventListener('keydown', event => { if (event.key === 'Enter' && control.value.trim()) answer(q, control.value.trim()); });
  return {body, confirm};
}

// "Reuse for matching questions" (owner's mockup): on by default; off keeps the answer with this application only (lib/job-answers.js), never offered on other forms.
function reuseCard(q) {
  const input = Object.assign(document.createElement('input'), {type: 'checkbox', id: 'qr-reuse', checked: !jobOnly.has(q.key)});
  input.setAttribute('aria-label', 'Reuse for matching questions');
  const toggle = el('span', 'switch', input), words = el('span', ''), hint = el('small', 'muted', '');
  toggle.append(document.createElement('span'));
  const say = () => hint.replaceChildren(input.checked ? 'Job-specific details stay with this application.' : 'Used for this application only. Never offered on other forms.');
  say();
  words.append(el('b', '', 'Reuse for matching questions'), hint);
  input.addEventListener('change', () => { if (input.checked) jobOnly.delete(q.key); else jobOnly.add(q.key); say(); });
  const card = el('label', 'switch-row qr-reuse');
  card.append(toggle, words);
  return card;
}

function footer(confirm) {
  const bar = el('footer', 'jd-foot qr-foot');
  const back = button('← Back', () => step(-1), 'ghost');
  back.id = 'qr-back';
  back.disabled = !state.aside && state.at === 0;
  const skip = button('Skip for now', () => step(1), 'secondary');
  skip.id = 'qr-skip';
  skip.disabled = !state.aside && state.queue.length < 2;
  bar.append(back, el('span', 'qr-gap'), skip, confirm);
  return bar;
}

function step(by) {
  if (state.aside) state.aside = null;
  else if (state.queue.length) state.at = (state.at + by + state.queue.length) % state.queue.length;
  state.saved = state.error = '';
  draw();
}

// Confirm (or "Don't keep", value ''): the answer goes to its home (lib/answer-home.js); the question leaves the queue; the next one shows.
async function answer(q, value) {
  const onlyHere = Boolean(value) && jobOnly.has(q.key);
  state.busy = true;
  state.error = '';
  draw();
  const result = await window.pilot.answerQuestion(q.key, value, markFor(q.format), ...(onlyHere || q.also?.length ? [{...(onlyHere ? {jobOnly: true, company: q.company || ''} : {}), ...(q.also?.length ? {also: alsoKeys(q)} : {})}] : [])).catch(error => ({ok: false, error: error.message}));
  state.busy = false;
  if (!result?.ok) { state.error = result?.error || 'It did not save; try again.'; draw(); return; }
  drafts.delete(q.key);
  jobOnly.delete(q.key);
  keepDrafts();
  state.saved = value ? `✓ Saved to ${result.homeName || 'your application answers'}` : '✓ Not kept: forms will not ask you for it again';
  if (state.aside) { state.setAside = state.setAside.filter(each => each !== q); state.aside = null; }
  else { state.queue = state.queue.filter(each => each !== q); state.at = Math.min(state.at, Math.max(state.queue.length - 1, 0)); }
  draw();
  loadQuestions({force: true});   // Jobs' card counts again
}

export function draw() {
  const panel = $('review-panel');
  if (!panel || !state.open) return;
  if (state.loading) { const body = el('div', 'jd-body qr-body'); body.append(...skeleton()); panel.replaceChildren(header(), body); return; }
  if (state.failed) {
    panel.replaceChildren(header(), el('div', 'jd-body qr-body', stateCard({icon: 'alert', tone: 'bad', title: 'Could not read your questions', text: state.failed,
      actions: [button('Retry', () => openQuestionReview({force: true}))]})));
    return;
  }
  const q = current();
  if (!q) {
    const done = stateCard({icon: 'check', tone: 'good', title: 'All questions reviewed',
      text: 'New questions show here when a form asks something your saved answers do not cover.', actions: [button('Manage saved answers', () => manageAnswers())]});
    const body = el('div', 'jd-body qr-body', done);
    if (state.saved) body.append(el('p', 'muted small qr-saved', state.saved));
    const foot = el('footer', 'jd-foot qr-foot', button('Close', closeQuestionReview, 'secondary'));
    panel.replaceChildren(header(), body, foot);
    return;
  }
  const {body, confirm} = question(q);
  panel.replaceChildren(header(), body, footer(confirm));
}

// Opens the drawer on the open questions (read once if Jobs has not read them yet). start: a question's key to show first.
export async function openQuestionReview({force = false, start = ''} = {}) {
  claimOverlay('review');
  state.open = true;
  $('review-drawer-layer').hidden = false;
  let now = questionsNow();
  // The questions saved last time (Jobs' card shows them from this computer) open the drawer at once; the store's answer replaces them when it arrives.
  // Nothing saved: a loading card until the store answers.
  const background = !force && !now.read && now.list.length > 0;
  if (!background && (force || !now.read)) {
    state.loading = true;
    state.failed = '';
    draw();
    await loadQuestions({force});   // not forced: a read Jobs already started is joined
    now = questionsNow();
    state.loading = false;
  }
  state.failed = now.error || '';
  state.queue = [...now.list];
  state.setAside = [...now.hidden];
  state.fromDetails = now.fromDetails || 0;
  state.consent = now.consent || 0;
  state.aside = null;
  state.saved = state.error = '';
  const at = state.queue.findIndex(q => q.key === start);
  state.at = at < 0 ? 0 : at;
  draw();
  $('qr-control')?.focus?.();
  if (background) {
    await loadQuestions();
    if (state.open) syncQueue();
  }
}

// The store answered after the drawer opened on the saved list: take its list, staying on the question being read when it is still open.
function syncQueue() {
  const now = questionsNow(), keep = current()?.key;
  state.failed = '';
  state.queue = [...now.list];
  state.setAside = [...now.hidden];
  state.fromDetails = now.fromDetails || 0;
  state.consent = now.consent || 0;
  if (state.aside) state.aside = state.setAside.find(q => q.key === keep) || null;
  if (!state.aside) { const at = state.queue.findIndex(q => q.key === keep); state.at = at < 0 ? Math.min(state.at, Math.max(state.queue.length - 1, 0)) : at; }
  draw();
}

export function closeQuestionReview() {
  if (!state.open) return;
  state.open = false;
  releaseOverlay('review');
  $('review-drawer-layer').hidden = true;
}

// Profile → Application answers (Manage saved answers, View source), searched for a saved answer's name when one is given.
export async function manageAnswers(query = '') {
  closeQuestionReview();
  const [{openView}, {settingsPage}, {profileTab}, answers] = await Promise.all([import('./nav.js'), import('./settings.js'), import('./profile.js'), import('./application-answers.js')]);
  answers.searchAnswers(query);
  openView('settings');
  settingsPage('profile');
  profileTab('answers');
}

registerOverlay('review', {close: closeQuestionReview, open: () => openQuestionReview()});
$('review-drawer-backdrop')?.addEventListener('click', closeQuestionReview);
$('questions-review')?.addEventListener('click', () => openQuestionReview());
$('questions-manage')?.addEventListener('click', event => { event.preventDefault(); manageAnswers(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open && !event.defaultPrevented) closeQuestionReview(); });
