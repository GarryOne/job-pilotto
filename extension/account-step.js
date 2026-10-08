// What the extension does on a sign-in or sign-up page in a tab the app opened (owner, 8 Oct 2026; the extension first, docs/flows/applying.md). The AI decides the
// judgments, in any language (it must work on thousands of sites): the page-kind AI says which step this page is and names its register and submit controls; the account
// AI (desktop/lib/account-judge.js) says, BEFORE the button, whether everything the person owes is given (a consent may be a link), and AFTER it what became of it.
// The app says whether THIS email has an account on the host (mode). The code only executes the validated answers and keeps its floors: one register press and one submit
// press per tab (a failed sign-in reloads the page, so the extension remembers), nothing pressed when the AI is absent, unsure, or sees a bot check.
// Scenarios owned: "Sign-up page before the form", "Sign-in page where we have no account". Guards: worker/test/account-step.test.js, account-fill.test.js, npm run live.
import {api, settings} from './flow.js';
import {decide} from './log.js';
import {askKind, stuck} from './fill-flow.js';
import {sessionGet} from './tab-memory.js';
import {tabArmed} from './tab-pages.js';
import {accountSketch, fillAccountBoxes, flagAccount, markAccountStep, passwordWork, pressAccountButton, pressRegister} from './account-fill.js';
import {closerLook, unsureTwice} from './escalate.js';

// -> 'register' | 'switch' | 'fill-press' | 'fill' | 'leave'. step: the AI's account step ('' when it gave none); mode: the app's 'sign-in' | 'sign-up' | 'confirm'.
export function accountMove({step, mode, hasEmail, registerControl, signinControl}) {
  if (mode === 'confirm') return 'leave';   // an account was just made for this email: the app waits for its confirmation mail, nothing is pressed again
  if (!step || !hasEmail) return 'fill';   // no AI word or no email to use: the password only, as a password manager would
  if (step === 'choose') return mode === 'sign-in' && signinControl ? 'switch' : 'leave';   // "an account exists": sign in to it when it is ours, else the person decides
  if (step === 'sign_in' && mode === 'sign-up') return registerControl ? 'register' : 'leave';   // no account of ours here: never sign in
  if (step === 'sign_up' && mode === 'sign-in') return signinControl ? 'switch' : 'leave';   // we have an account here: not a sign-up; go to the page's way to sign in
  return 'fill-press';
}

// What to do when the account AI says the person must give something and the setting is 'full': accept a consent the AI named (the link, then the dialog's accept button, or a
// checkbox's label), at most three presses per tab; a choice, a code or a field is always the person's. 'assist' leaves everything to the person.
export const MAX_CONSENT_PRESSES = 3;
export function consentMove({automation, needsKind, needs, presses = 0}) {
  return automation === 'full' && needsKind === 'consent' && !!needs && presses < MAX_CONSENT_PRESSES ? 'accept' : 'person';
}

// What the account AI's answer after the press means for us: 'confirmed' (the account exists and is usable: signed in, or the site moved on), 'pending' (it exists but
// awaits a confirmation mail, or a code the person types), 'exists' (it was there already: the sign-in is tried once), 'flag' (the person must do something: said on the
// page), 'none' (unsure or no AI: nothing is claimed).
export function resultAction(answer) {
  if (answer === 'created') return 'confirmed';
  if (answer === 'created_confirm' || answer === 'needs_code') return 'pending';
  if (answer === 'already_exists') return 'exists';
  if (answer === 'refused') return 'flag';
  return 'none';
}

// One look at a time per tab (the panel asks every few seconds: a second look while the first still waits for the AI only repeats it), and an unchanged page is not judged
// again: the AI's answer is kept for the sketch it was given, so it is asked again only when the page changed (a box filled, a consent accepted, an error shown).
const looking = new Set(), judged = new Map(), lastSaid = new Map(), kinds = new Map(), unsureSeen = new Map();
// The page kind of this tab's page, kept 20 s (the app remembers it too, but asking and logging it at every look is noise): a new address asks again.
async function askKindOnce(tab) {
  const key = tab.url.split('#')[0], kept = kinds.get(tab.id);
  if (kept && kept.key === key && Date.now() - kept.at < 20000) return kept.kind;
  const kind = await askKind(tab);
  kinds.set(tab.id, {key, at: Date.now(), kind});
  return kind;
}
const signature = sketch => JSON.stringify([sketch.controls, sketch.buttons, sketch.texts, sketch.frames]);
const run = (tab, frameId, func, args = []) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args}).then(rows => rows?.[0]?.result).catch(() => undefined);
const memoKey = tab => `accountForm:${tab.id}`;
const triedKey = (tab, action) => `accountPress:${tab.id}:${action}`;
const alreadyTried = async (tab, action) => !!(await sessionGet(triedKey(tab, action)))[triedKey(tab, action)];
// The extension could not finish this account page: said ONCE per tab and reason to the app, which shows what the person must do and OFFERS Claude (never starts it).
// What the person must do at a bot check: it is theirs to solve, and then the account button is theirs to press (a frame in the form stays after the check is solved, so the floor never learns it).
export const botCheckNeed = named => (String(named || '').trim() ? `Solve the check, then press "${String(named).trim().slice(0, 40)}"` : 'Solve the check, then press the account button');
const stepOf = new Map();   // tab id → the AI's step for the page being worked on (sign_in, sign_up, ...): said to the app so its card can word it
async function giveUp(tab, host, reason, needs = '') {
  const key = `stuck-${reason}-${needs}`.slice(0, 120);
  if (await alreadyTried(tab, key)) return;
  await markTried(tab, key);
  decide('fill', `account step: could not finish (${reason}): Claude is offered`, {host});
  await stuck(tab.url.split('#')[0], host, 'account', tab.id, tab.url, needs, stepOf.get(tab.id) || '');
}
const markTried = (tab, action) => chrome.storage.session.set({[triedKey(tab, action)]: Date.now()}).catch(() => {});

// The account AI on what the page shows now. null when there is no AI, no answer, or the page cannot be read: then nothing is pressed or claimed.
async function judge(tab, frameId, phase, config, fromPath = '') {
  const sketch = await run(tab, frameId, accountSketch);
  if (!sketch) return null;
  if (fromPath) sketch.fromPath = fromPath;   // where the sign-up form was: the AI sees whether the page moved on
  const key = `${tab.id} ${phase}`, sig = signature(sketch);
  if (judged.get(key)?.sig === sig) return judged.get(key).answer;   // the page is as it was: the same answer, no new call
  const answer = await api(config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase, sketch})}).catch(() => null);
  const kept = answer?.answer ? answer : null;
  if (kept) judged.set(key, {sig, answer: kept});
  return kept;
}

// After a press by us or by the person (a sign-up form was open in this tab): what became of it. Said to the app, or on the page.
const outcomeBusy = new Set();
export async function accountOutcome(tab, frameId = 0) {
  const memo = (await sessionGet(memoKey(tab)))[memoKey(tab)];
  if (!memo || Date.now() - memo.at > 30 * 60 * 1000 || outcomeBusy.has(tab.id)) return;
  let path = ''; try { path = new URL(tab.url).pathname.slice(0, 120); } catch { /* no address */ }
  if (!memo.pressed && path === memo.path) return;   // nothing was pressed and the page is the same form: nothing has become of anything yet
  outcomeBusy.add(tab.id);
  try { await outcomeOnce(tab, frameId, memo); } finally { outcomeBusy.delete(tab.id); }
}
async function outcomeOnce(tab, frameId, memo) {
  const config = await settings(), host = memo.host;
  const result = await judge(tab, frameId, 'result', config, memo.path || '');
  const action = resultAction(result?.answer);
  decide('fill', `account result: ${result?.answer || 'no AI'}`, {host, action});
  if (action === 'flag') { await run(tab, frameId, flagAccount, [result.needs || '']); await giveUp(tab, host, 'the site did not accept it', result.needs || ''); return; }   // the form stays: the person finishes it, and the memo stays for the next look
  if (action === 'none') return;
  await chrome.storage.session.remove(memoKey(tab)).catch(() => {});
  const session = (await sessionGet(`session:${tab.id}`))[`session:${tab.id}`] || '';
  api(config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'account-pressed', host, url: tab.url.split('#')[0], state: action, session})}).catch(() => {});
}

export async function accountStep(tab, frameId) {
  if (looking.has(tab.id)) return {filled: 0};   // a look at this tab is still running
  looking.add(tab.id);
  try { return await accountStepOnce(tab, frameId); } finally { looking.delete(tab.id); }
}

async function accountStepOnce(tab, frameId) {
  const armedKey = `armed:${tab.id}`;
  if (!tabArmed({url: tab.url, armed: (await sessionGet(armedKey))[armedKey]})) return {filled: 0};
  const host = new URL(tab.url).hostname, config = await settings();
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {filled: 0};   // your own Worker: no Keychain
  // Cheap first, in the page: nothing to fill and no press waiting means nothing to ask the app (an account + application page was looked at every 2 s for nothing, 8 Oct 2026).
  const work = await run(tab, frameId, passwordWork);
  if (work && work.boxes > 0 && !work.empty && !work.pending) return {filled: 0};   // every password box has its value and no press waits (a page with no password box, e.g. an "account exists" notice, is still looked at)
  const kind = await askKindOnce(tab);
  const step = kind?.kind === 'account' ? kind.accountStep || '' : '';
  await run(tab, frameId, markAccountStep, [step]);
  stepOf.set(tab.id, step);
  if (work && !step && !work.empty) return {filled: 0};   // no step the AI knows: the password only, and every box already has one
  const answer = await api(config, '/extension/site-password', {method: 'POST', body: JSON.stringify({host})});
  if (!answer?.ok || !answer.password) return {filled: 0};
  const move = accountMove({step, mode: answer.mode, hasEmail: !!answer.email, registerControl: kind?.registerControl, signinControl: kind?.signinControl});
  const said = `${move} ${step} ${answer.mode}`;
  if (lastSaid.get(tab.id) !== said) { lastSaid.set(tab.id, said); decide('fill', `account page: ${move}`, {host, step, mode: answer.mode || ''}); }   // said when it changes, not at every look
  if (move === 'leave') {
    if (answer.mode !== 'confirm' && step) await giveUp(tab, host, 'no way forward on this page');   // 'confirm' waits for its mail; anything else the extension cannot continue
    return {filled: 0};
  }
  if (move === 'register' || move === 'switch') {   // the page's own way to the other form: to create an account (no account of ours here), or to sign in (we have one)
    if (!(await alreadyTried(tab, move))) {
      const result = await run(tab, frameId, pressRegister, [move === 'register' ? kind.registerControl : kind.signinControl]);
      if (result === 'pressed') await markTried(tab, move);
      decide('fill', `${move} control: ${result}`, {host});
      if (result === 'not-found') await closerLook(tab, frameId, `the ${move} control the AI named was not found`);   // opt-in (lib/escalate.js)
    }
    return {filled: 0};
  }
  const filled = await run(tab, frameId, fillAccountBoxes, [answer.password]) || 0;
  if (step === 'sign_up' && answer.mode === 'sign-up') await chrome.storage.session.set({[memoKey(tab)]: {host, at: Date.now(), path: new URL(tab.url).pathname.slice(0, 120)}}).catch(() => {});   // a sign-up form is open in this tab
  if (filled) decide('fill', 'password filled from the Keychain', {host, boxes: filled});
  const submitKey = `submit-${step}`;   // one press per tab and STEP: a sign-up pressed here must not block the sign-in that follows in the same tab
  if (move === 'fill-press' && !(await alreadyTried(tab, submitKey))) {
    const ready = await judge(tab, frameId, 'ready', config);   // also when nothing new was filled: a page the person finished since is pressed
    if (ready?.answer === 'unsure' && unsureTwice(unsureSeen, tab.id, JSON.stringify([ready.needs, step, answer.mode]))) await closerLook(tab, frameId, 'the AI was unsure twice about this page');   // opt-in (lib/escalate.js)
    if (!ready || ready.answer !== 'ready' || ready.botCheck) {
      const key = `accountConsent:${tab.id}`, presses = Number((await sessionGet(key))[key]) || 0;
      const accept = ready && !ready.botCheck && ready.answer === 'needs_person' && consentMove({automation: answer.automation, needsKind: ready.needsKind, needs: ready.needs, presses}) === 'accept';
      if (accept) {   // the owner's setting: the extension accepts the account's consent itself (link, dialog, checkbox), then looks again
        await chrome.storage.session.set({[key]: presses + 1}).catch(() => {});
        decide('fill', `consent accepted: ${await run(tab, frameId, pressRegister, [ready.needs])}`, {host, press: presses + 1});
      } else {
        decide('fill', `account button: not pressed (${ready ? (ready.botCheck ? 'a bot check' : ready.answer) : 'no AI'})`, {host, automation: answer.automation || ''});
        if (ready && (ready.botCheck || ready.answer === 'needs_person')) await run(tab, frameId, flagAccount, [ready.botCheck ? botCheckNeed(kind?.accountButton) : ready.needs || '']);
        await giveUp(tab, host, !ready ? 'no AI answer' : ready.botCheck ? 'a bot check' : 'something only the person can give', ready?.botCheck ? botCheckNeed(kind?.accountButton) : ready?.needs || '');
      }
    } else {
      await run(tab, frameId, flagAccount, [null]);   // nothing is owed any more: the panel stops saying so
      await new Promise(resolve => setTimeout(resolve, 800));
      const result = await run(tab, frameId, pressAccountButton, [kind?.accountButton || '']);
      decide('fill', `account button: ${result || 'not run'}`, {host});
      if (result === 'bot-check') { const need = botCheckNeed(kind?.accountButton); await run(tab, frameId, flagAccount, [need]); await giveUp(tab, host, 'a bot check', need); }   // the floor's word: the person solves it and presses the button
      if (result === 'pressed') {
        await markTried(tab, submitKey);   // pressed once; what became of it is the account AI's word, a moment later (here, or on the next page)
        await chrome.storage.session.set({[memoKey(tab)]: {host, at: Date.now(), path: new URL(tab.url).pathname.slice(0, 120), pressed: true}}).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 4000));
        await accountOutcome(await chrome.tabs.get(tab.id).catch(() => tab));
      }
    }
  }
  return {filled};
}
