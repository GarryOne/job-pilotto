// What the extension does on a sign-in or sign-up page in a tab the app opened (owner, 8 Oct 2026; the extension first, docs/flows/applying.md):
// the page-kind AI says which step this page is (sign_in / sign_up) and names its register and submit controls; the app says whether THIS email has an
// account on this site (mode). The code decides nothing from words: it reads the AI's fixed answers and keeps hard floors (one register press and one
// submit press per tab, remembered here because a failed sign-in reloads the page; never when a bot check or a required choice is left).
// Scenarios owned: "Sign-up page before the form", "Sign-in page where we have no account". Guards: worker/test/account-step.test.js, account-fill.test.js, npm run live.
import {api, settings} from './flow.js';
import {decide} from './log.js';
import {askKind} from './fill-flow.js';
import {sessionGet} from './tab-memory.js';
import {tabArmed} from './tab-pages.js';
import {fillAccountBoxes, pressAccountButton, pressRegister} from './account-fill.js';

// -> 'register' | 'fill-press' | 'fill' | 'leave'. step: the AI's account step ('' when it gave none); mode: the app's 'sign-in' | 'sign-up'.
export function accountMove({step, mode, hasEmail, registerControl}) {
  if (!step || !hasEmail) return 'fill';   // no AI word or no email to use: the password only, as a password manager would
  if (step === 'sign_in' && mode === 'sign-up') return registerControl ? 'register' : 'leave';   // no account of ours here: never sign in
  if (step === 'sign_up' && mode === 'sign-in') return 'leave';   // we have an account here: not a sign-up
  return 'fill-press';
}

const run = (tab, frameId, func, args = []) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args}).then(rows => rows?.[0]?.result).catch(() => undefined);
// Once per tab and action, remembered by the extension (the page cannot: a rejected sign-in reloads it). Marked only after a real press, so a page
// that is not ready yet (a required box still empty) is looked at again.
const triedKey = (tab, action) => `accountPress:${tab.id}:${action}`;
const alreadyTried = async (tab, action) => !!(await sessionGet(triedKey(tab, action)))[triedKey(tab, action)];
const markTried = (tab, action) => chrome.storage.session.set({[triedKey(tab, action)]: Date.now()}).catch(() => {});

export async function accountStep(tab, frameId) {
  const armedKey = `armed:${tab.id}`;
  if (!tabArmed({url: tab.url, armed: (await sessionGet(armedKey))[armedKey]})) return {filled: 0};
  const host = new URL(tab.url).hostname, config = await settings();
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {filled: 0};   // your own Worker: no Keychain
  const kind = await askKind(tab);
  const step = kind?.kind === 'account' ? kind.accountStep || '' : '';
  const answer = await api(config, '/extension/site-password', {method: 'POST', body: JSON.stringify({host})});
  if (!answer?.ok || !answer.password) return {filled: 0};
  const move = accountMove({step, mode: answer.mode, hasEmail: !!answer.email, registerControl: kind?.registerControl});
  decide('fill', `account page: ${move}`, {host, step, mode: answer.mode || ''});
  if (move === 'leave') return {filled: 0};
  if (move === 'register') {
    if (!(await alreadyTried(tab, 'register'))) {
      const result = await run(tab, frameId, pressRegister, [kind.registerControl]);
      if (result === 'pressed') await markTried(tab, 'register');
      decide('fill', `register control: ${result}`, {host});
    }
    return {filled: 0};
  }
  const filled = await run(tab, frameId, fillAccountBoxes, [answer.password]) || 0;
  decide('fill', 'password filled from the Keychain', {host, boxes: filled});
  if (filled && move === 'fill-press') {
    if (await alreadyTried(tab, 'submit')) decide('fill', 'account button: already tried in this tab, left to you', {host});
    else {
      await new Promise(resolve => setTimeout(resolve, 800));
      const result = await run(tab, frameId, pressAccountButton, [kind?.accountButton || '']);
      if (result === 'pressed') await markTried(tab, 'submit');
      decide('fill', `account button: ${result || 'not run'}`, {host});
    }
  }
  return {filled};
}
