// The outcome contract's classifier (owner, 12 Oct 2026; spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1a): ONE ending per pool row (extension/ladder/endings.js ENDINGS),
// from the row's EXISTING report: where it got to (reached), the notes the run parser wrote (lib/smoke.mjs parseLive), each required field's outcome and reason (our own trace words,
// extension/page/fill.js, mapped by the fill card's causeOf), and, when given, the extension's own stop line in the row's app log. Never page text. Pure. Guard: e2e/test/ending.test.mjs.
// A row that is not an application outcome is not counted: {ending: null, why}: the harness did not finish, the privacy tripwire, a refused AI, and the TEST's own holds (cc/owner,
// 12 Oct 2026): the pool never presses an account button with fake data (ACCOUNT_HELD), and a CI runner's data-center address meets bot walls a person's would not. Those are shown apart
// ("held by the test, not measured"), never counted resolved. 'handed' is only a real wall the run names: a bot check on a person's address, a sign-in to an existing account (LOGIN_WALL).
import {causeOf} from '../../../extension/fill-card.js';
import {ENDINGS, resolved} from '../../../extension/ladder/endings.js';
import {ACCOUNT_HELD, APPLY_BY_EMAIL, LOGIN_WALL, PAGE_TELLS, SITE_REFUSED} from './smoke.mjs';

// The worst required field decides a form: a field we missed > a control we did not see > an answer only the person has > the person's own choice.
const WORST = ['unresolved', 'blind', 'data_missing', 'ready'];
const PERSONS = /^(legal|written|demographic)/;   // our own trace reasons for the person's own choice (extension/page/fill.js)
const BY_CAUSE = {proposed: 'ready', no_data: 'data_missing', ai_declined: 'data_missing', ai_unsure: 'data_missing', ai_off: 'data_missing', unread: 'blind'};   // any other cause: we missed it
export function fieldEnding(row) {
  const reason = String(row?.reason || '');
  if (row?.type === 'password' || PERSONS.test(reason)) return 'ready';   // a password is the person's to type (never read by us)
  if (row?.type === 'file' && /^no place to attach/.test(reason)) return 'blind';   // the upload slot was not seen
  return BY_CAUSE[causeOf(row)] || 'unresolved';
}
// A form left covered or not counted by the run (the parser's own error lines) is a miss, whatever its fields say. A cookie bar left open at the end is a miss of its own, not
// the application's ending (hand-check 12 Oct 2026: jobs.ch's form was reached and filled under it).
const COVERED = /^(a dialog was left open over the form|held: a dialog covers the form|form judge: the page is blocked|form fill did not report)/;
// The account step the pool never passes (it never creates an account with fake data): the last page is an account page (or account + form) and every required field on it is the
// person's contact details we filled, a password, a consent, or the kit's CV that has no slot there (hand-check 12 Oct 2026: a Workday "Create Account" page the AI called account-form).
const ACCOUNT_KINDS = new Set(['account', 'account-form']);
const accountStep = result => {
  if (!ACCOUNT_KINDS.has((result.path || []).at(-1)?.kind)) return false;
  const required = (result.fieldList || []).filter(row => row?.required);
  return required.some(row => row.type === 'password') && required.every(row => row.type === 'password' || /^legal/.test(String(row.reason || ''))
    || (row.outcome === 'filled' && /^your details/.test(String(row.reason || ''))) || (row.type === 'file' && /^no place to attach/.test(String(row.reason || ''))));
};

// The extension's own stop lines (extension/fill-flow.js `decide('fill', ...)`): the last one in the row's app log refines a stop the parser left without a note. Guarded: a rename fails the test.
export const STOP_LINES = {email: 'the posting asks for the application by email', told: 'the page tells what to do', botCheck: 'a bot check in front of the page', unreadable: 'the page could not be read',
  other: 'the ladder ended at the person: reported as other', noForm: 'no form on this page', account: 'account page left for Claude'};
const STOP_ENDING = {email: 'told', told: 'told', botCheck: 'handed', unreadable: 'site_broken', other: 'unresolved', noForm: 'unresolved', account: 'unresolved'};
const lastStop = appLog => {
  let found = '';
  for (const line of String(appLog || '').split('\n')) {
    if (!/^\S+ \[extension\] fill: /.test(line)) continue;
    const text = line.replace(/^\S+ \[extension\] fill: /, '');
    for (const [name, words] of Object.entries(STOP_LINES)) if (text.startsWith(words)) found = name;
  }
  return found;
};

export const HELD_BY_TEST = 'held by the test';
// result: a pool row's result (smoke.mjs day report). appLog: the row's app log, optional. ci: the row ran on a CI runner. -> {ending, why}
export function endingOf(result, appLog = '', {ci = false} = {}) {
  if (!result || typeof result !== 'object') return {ending: null, why: 'no result'};
  if (result.tripped) return {ending: null, why: 'the privacy tripwire'};
  if (result.aiRefused) return {ending: null, why: 'the AI was refused'};
  const note = String(result.note || ''), reached = String(result.reached || 'none');
  if (note === APPLY_BY_EMAIL || note === PAGE_TELLS) return {ending: 'told', why: note};
  if (/^eligibility stop/.test(note)) return {ending: 'told', why: 'eligibility stop'};
  if (note === ACCOUNT_HELD) return {ending: null, why: HELD_BY_TEST, held: 'account-first'};
  if (note === LOGIN_WALL) return {ending: 'handed', why: note};
  if (/gone \(HTTP \d+\)/.test(note) || note === SITE_REFUSED) return {ending: 'site_broken', why: note};
  if (reached === 'code/bot') return ci ? {ending: null, why: HELD_BY_TEST, held: 'bot wall on the CI address'} : {ending: 'handed', why: 'a bot check'};
  if (reached === 'ready') return {ending: 'ready', why: 'the form is ready'};
  if (reached === 'form' && accountStep(result)) return {ending: null, why: HELD_BY_TEST, held: 'account step'};
  if (reached === 'form') {
    const covered = (result.errors || []).find(error => COVERED.test(String(error)));
    if (covered) return {ending: 'unresolved', why: String(covered).slice(0, 80)};
    const left = (result.fieldList || []).filter(row => row?.required && row.outcome !== 'filled'), endings = left.map(fieldEnding);
    const ending = WORST.find(one => endings.includes(one)) || 'ready', worst = left[endings.indexOf(ending)];
    return {ending, why: `${left.length} required left${worst ? `; the first ${ending}: ${String(worst.type || 'field').slice(0, 20)}, ${String(worst.reason || 'no reason').slice(0, 80)}` : ''}`};   // our own trace words, never the page's
  }
  if (Number(result.exit) !== 0 && reached === 'none' && (result.errors || []).length) return {ending: null, why: 'the run did not finish'};
  const stop = lastStop(appLog);
  if (stop) return {ending: STOP_ENDING[stop], why: STOP_LINES[stop]};
  return {ending: 'unresolved', why: `stopped at ${reached} with no reason`};
}

// The endings of many rows: counts per ending (every ending listed, in the fixed order), the rows held by the test and the other rows not counted (both out of the denominator),
// and the resolution share (resolved / counted).
export function tally(found) {
  const endings = Object.fromEntries(ENDINGS.map(one => [one, 0]));
  let uncounted = 0, held = 0;
  for (const one of found) { if (ENDINGS.includes(one?.ending)) endings[one.ending] += 1; else if (one?.why === HELD_BY_TEST) held += 1; else uncounted += 1; }
  const counted = Object.values(endings).reduce((sum, n) => sum + n, 0);
  return {counted, held, uncounted, endings, resolution: counted ? ENDINGS.filter(resolved).reduce((sum, one) => sum + endings[one], 0) / counted : 0};
}
