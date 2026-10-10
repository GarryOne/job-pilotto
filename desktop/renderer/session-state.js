// A session's state as the window shows it, from what the app reports (lib/terminals.js publicView) and Claude's
// last message. No window needed: tested in desktop/test/session-state.test.js.
import {READY_LINE, readSessionMessage} from './session-message.js';

export const SESSION_STATE = {running: ['Applying', 'info'], input: ['Question for you', 'warn'], done: ['Ready for review', 'warn'],
  ended: ['Ended', 'neutral'], failed: ['Stopped', 'bad'], submit: ['Ready to submit', 'good'], submitted: ['Submitted', 'good']};
// Claude is running in it (demo sessions say nothing: they run while not ended).
export const isLive = item => item.live ?? !item.endedAt;
// The application was submitted and Claude is no longer in it. The badge, the step and the log all read this.
export const isSubmitted = item => item?.outcome === 'submitted' && !isLive(item);
// Waiting for you after filling the form (its message says so) counts as "ready for review", like a finished one.
const ENGLISH_REVIEW_WORDS = /form (?:is )?(?:now )?(?:filled|ready|complete)|filled (?:the|every|all|\d+)|ready for (?:your )?review|before you submit|submit it yourself|ready for you to review|nothing was submitted/i;
// The skill's fixed last line says it in any language (8 Oct 2026: a session answering in French never turned "Ready for review");
// the English words stay for older sessions and a Claude that left the line out.
export const REVIEW_WORDS = {test: text => String(text || '').split(/\n/).some(line => READY_LINE.test(line.trim())) || ENGLISH_REVIEW_WORDS.test(text || '')};
// Claude asks you something when one of its own sentences (outside its report's lists) ends with "?"; a listed form
// question ("Any relatives working at Acme?") is not Claude asking.
export const asksYou = item => (item.question ? readSessionMessage(item.question).intro.some(line => /\?\**\s*$/.test(line)) : /\?\s*$/.test(item.brief || ''));
// A message that ends on a question still waits for your answer first.
// `formReady`: the form page says every required field is filled. Then what Claude asked earlier is moot: the form is
// ready for review and submit, whatever its last message says (1 Oct 2026: a card still asked for a street already typed).
export const sessionReview = (item, formReady = false) => item.status === 'done'
  || (item.status === 'input' && (formReady || (REVIEW_WORDS.test(item.question || '') && !asksYou(item))));
// formReady: the form page says every required field is filled (the extension's ring is green): ready to submit.
// A session whose application was submitted is finished, whatever its process did: "Submitted", never "Applying".
export const sessionState = (item, formReady = false) => (item?.outcome === 'submitted' && !isLive(item) ? SESSION_STATE.submitted
  : item.kind === 'form' && item.accountState === 'confirm' ? ['Confirm your email', 'info']   // the account is made and awaits its confirmation mail
  : item.kind === 'form' && item.accountState === 'refused' && !item.stuck ? ['Sign-in refused', 'warn']   // the site refused our sign-in: tried once, never retried
  : item.kind === 'form' && item.stuck ? [item.stuck === 'account' ? (item.accountNeeds ? 'Needs you' : item.accountStep === 'sign_in' ? 'Needs sign-in' : 'Needs an account') : item.stuck === 'incomplete' ? 'Needs you' : item.stuck === 'email' ? 'Needs your email' : item.stuck === 'told' ? 'The page says what to do' : item.stuck === 'other' ? 'Open the page' : 'Can\'t reach form', 'warn']
  // Claude at work on a sign-in or sign-up page: it is creating the account, not filling the application (owner, 8 Oct 2026: "Applying").
  : item.kind !== 'form' && item.status === 'running' && item.stage === 'account' ? ['Creating account', 'info']
  : (item.kind === 'form' || item.inChrome) && !formReady && sessionReview(item, formReady) ? ['Form open', 'info']   // the Apply button's session: no Claude, the form is open in Chrome
  : sessionReview(item, formReady) ? (formReady ? SESSION_STATE.submit : SESSION_STATE.done)
    : SESSION_STATE[item.status] || SESSION_STATE.ended);
// The dock's two pills and its card order, from the same state the sessions list shows: a form whose Chrome tab was closed
// (`gone`) is neither active nor waiting, and sorts last, so an open form is never hidden behind closed ones (2 Oct 2026:
// the dock said "Form open" for two closed forms and left out the one that was open).
const WORKING = ['Applying', 'Form open', 'Ready to submit'];
export const dockCounts = (items, gone = () => false) => ({
  active: items.filter(item => !gone(item) && WORKING.includes(sessionState(item)[0])).length,
  waiting: items.filter(item => !gone(item) && item.status === 'input').length,
});
// Applying in the menu: the number is every card the Applying list shows, whatever its state (owner, 8 Oct 2026: it said 2
// with 4 cards, counting only the ones that needed you). The colour is the most urgent: amber needs you, blue working,
// green all ready to submit, else grey. `urgency`: 0-1 needs you, 2 working, 3 ready to submit.
export function applyingBadge(items, urgency) {
  const levels = items.map(urgency);
  const tone = levels.some(level => level <= 1) ? 'warn' : levels.includes(2) ? 'info'
    : items.length && levels.every(level => level === 3) ? 'good' : 'neutral';
  return {count: items.length || '', tone};
}
const DOCK_ORDER = {input: 0, running: 1, done: 2, failed: 3, ended: 4};
export const dockOrder = (item, gone = () => false) => gone(item) ? 9 : (DOCK_ORDER[item.status] ?? 5);
// Did the form page's panel answer the app (what "Open filled form" returns)? Only when it didn't is the "Reload the
// tab" repair offered: reloading a form page loses what was typed in it since the last save, so it must not be a
// button to press by habit next to Open filled form (1 Oct 2026).
export const panelAnswered = result => !!result?.taken;
// How long it worked (until it ended or waited for you), "42s", "3m 05s", "1h 02m".
export function sessionDuration(item, now = Date.now()) {
  const end = item.endedAt || item.needsYouSince;
  const seconds = Math.max(0, Math.round(((end ? new Date(end) : new Date(now)) - new Date(item.startedAt)) / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m`;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}
// The part of a text shown on its row: all of it when short, else whole sentences up to the limit (at least one).
export function firstLine(text, limit = 110) {
  if (text.length <= limit) return text;
  let shown = '';
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (shown && shown.length + sentence.length + 1 > limit) break;
    shown = shown ? `${shown} ${sentence}` : sentence;
  }
  return shown;
}

// Which step of the application the session is at, said plainly (owner, 8 Oct 2026: show whether we are creating the employer
// account or filling the job's own form). Step numbers only when there was an account step; nothing once it is submitted.
export function sessionStage(item) {
  if (!item || item.outcome === 'submitted') return null;
  const site = item.accountHost ? ` on ${item.accountHost.replace(/^www\./, '')}` : '';
  if (item.accountState === 'refused') return {step: 1, text: `Step 1 of 2 · Sign-in refused${site}: tried once, not retried`, tone: 'warn'};   // before the account step's own line: that one says "Sign in" as if all were well
  if (item.stage === 'account' || item.stuck === 'account') return {step: 1, text: `Step 1 of 2 · ${item.accountStep === 'sign_in' ? 'Sign in' : 'Creating your account'}${site}`, tone: 'info'};
  if (item.accountState === 'confirm') return {step: 1, text: `Step 1 of 2 · Confirm your email${site}`, tone: 'info'};
  if (item.stage === 'form') return {step: 2, text: item.accountHost || item.accountState ? `Step 2 of 2 · ${item.accountState === 'created' ? 'Account created · ' : ''}Filling the application form` : 'Filling the application form', tone: 'info'};
  return null;
}

// The session's form tab is gone: the extension reports in (`formsOpen.known`) and no open tab is this session's. A form it saw
// before (`seen`: fields were reported) is closed; so is a form session's (Apply opened it; a minute for it to show up) and the
// tab of a Claude session that is no longer running (a running one may not have opened its tab yet). Owner, 8 Oct 2026: after
// closing every tab, a Claude session stuck on a sign-up page still showed its question as if the tab were there.
export function tabClosed(item, formsOpen, seen = false, now = Date.now()) {
  if (!item || !formsOpen?.known || formsOpen.ids.includes(item.id) || isSubmitted(item) || item.outcome) return false;
  if (formsOpen.unsure?.includes(item.id)) return false;   // no tab known for it and none that looks like it: not known, never "closed"
  if (seen) return true;
  if (item.kind === 'form') return now - (Date.parse(item.startedAt || '') || now) > 60 * 1000;
  return (item.kind || 'claude') === 'claude' && !isLive(item);
}

// The first look at Chrome after the app starts (or ⌘R): until the extension reports in, or CHECK_MS pass, nobody knows whether
// a session's tab is still there, so its card shows that it is checking instead of the last state it had (owner, 8 Oct 2026:
// for 2 s the old question and "Can't reach form" showed, then "The form tab was closed" replaced them).
// At least one report of the extension's (extension/report-alarm.js: every 30 s, Chrome's shortest alarm) plus a margin: at 15 s every card said "Chrome isn't
// reporting" for up to 15 s after each app start while Chrome was fine (twin, 9 Oct 2026). Guard: test/session-state.test.js.
export const CHECK_MS = 45 * 1000;
export function checkingTabs(item, formsOpen, sinceStart) {
  if (!item || formsOpen?.known || sinceStart > CHECK_MS || isSubmitted(item) || item.outcome) return false;
  return item.kind === 'form' || ((item.kind || 'claude') === 'claude' && !isLive(item));
}

// The session's Chrome tab as the card shows it: host and path (no query, no www), cut in the middle of the path when long;
// the full address is its tooltip. '' when no tab has reported for the session.
export function tabAddress(url, limit = 70) {
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  const text = (parsed.hostname.replace(/^www\./, '') + decodeURIComponent(parsed.pathname)).replace(/\/$/, '');
  return text.length <= limit ? text : `${text.slice(0, limit - 21)}…${text.slice(-20)}`;
}

// After the first look (CHECK_MS) the extension still hasn't reported which tabs are open (Chrome is closed, or its Job Pilotto
// extension isn't running): a session waiting on its tab can't be seen, so its card says so instead of its last state (owner, 8 Oct 2026).
export function chromeSilent(item, formsOpen, sinceStart) {
  if (!item || formsOpen?.known || sinceStart <= CHECK_MS || isSubmitted(item) || item.outcome) return false;
  return item.kind === 'form' || ((item.kind || 'claude') === 'claude' && !isLive(item));
}

// What the card says on a sign-in or sign-up page (owner, 9 Oct 2026: the account step gets its own count, what is left for you and the next press, apart from the application's
// progress). state: the form page's review state ({account, total, left, needs, pending, missing}); null when this is not an account page with fields.
export function accountCardOf(item, state) {
  if (!state?.account || !(state.total > 0)) return null;
  const need = state.needs === '1' ? 'See what the page asks' : String(state.needs || '').trim();   // the AI's word for the one thing only you can do, e.g. 'Solve the check, then press "Créer un compte"'
  const done = Math.max(0, state.total - state.left);
  const left = [...(need ? [need] : []), ...(state.pending || state.missing || [])];
  return {title: item.accountStep === 'sign_in' ? 'Sign-in page' : 'Account page', done, total: state.total, count: ` of ${state.total} fields filled`, left,
    pill: need ? {text: `Needs you: ${need}`, tone: 'warn'} : state.left ? {text: `${state.left} remaining`, tone: 'warn'} : {text: 'All fields filled', tone: 'good'}};
}
// The short line after the title of an account stop: how far the page is, or nothing was reported yet.
export const accountProgress = state => (state?.account && state.total > 0 ? `· ${Math.max(0, state.total - state.left)} of ${state.total} filled` : '· nothing filled yet');

// The account record on a session's card (owner, 10 Oct 2026): where an account was made, which terms the extension accepted (the page's own wording) and whether a code came from the
// mail. '' for an application with no account made by us (an existing account, a refused sign-in). Guarded by test/account-record.test.js.
export function accountRecordLine(item) {
  if (!item || !item.accountHost || !['created', 'confirm'].includes(item.accountState)) return '';
  const terms = Array.isArray(item.accountTerms) ? item.accountTerms : [];
  return [`Account created on ${item.accountHost.replace(/^www\./, '')}`, ...(terms.length ? [`terms accepted: ${terms.map(term => `\u2018${term}\u2019`).join(', ')}`] : []), ...(item.accountCode ? ['code from your email'] : [])].join(' \u00b7 ');
}
