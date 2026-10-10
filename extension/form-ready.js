// The AI's veto on an APPLICATION form's "Ready to submit" (owner, 8 Oct 2026: the account page's "ready?" judgment, ported). The panel counts required boxes by HTML; when that count says
// everything is filled, the AI reads the page's real state (a consent that is a link, a custom picklist, an error shown) and may say "needs you: <label>"; the worker then sets the page's
// data-jobpilotto-needs, which the panel shows instead of "Ready". It only ever VETOES a ready claim: it never accepts a consent, never presses Submit, and without AI nothing changes.
// The answer is kept per tab for the sketch it was given (asked again only when the page changed), one look at a time. Guards: worker/test/form-ready.test.js, desktop/test/form-judge.test.js.
import {api, settings} from './flow.js';
import {decide} from './log.js';
import {accountSketch, flagAccount} from './account-fill.js';
import {pressNext} from './next-step.js';

const looking = new Set(), judged = new Map();
// The structure says the form is ready: every counted required field is filled, on an application page (not an account page).
export const claimsReady = payload => !!payload && !payload.account && Number(payload.total) > 0 && Number(payload.left) === 0;

const run = (tab, frameId, func, args = []) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args}).then(rows => rows?.[0]?.result).catch(() => undefined);

export async function formReady(tab, frameId, payload) {
  if (!claimsReady(payload)) return;
  return askForm(tab, frameId);
}

// After a fill, whatever the panel's count says (owner, 9 Oct 2026: the CV was in, the step was done, nothing asked what comes next because the count of HTML-required boxes was not "ready"):
// the AI looks at the page's real state once per page state, and a middle step's own next button is pressed (next-step.js).
export const formNext = (tab, frameId = 0) => askForm(tab, frameId);

async function askForm(tab, frameId) {
  if (looking.has(tab.id)) return;
  looking.add(tab.id);
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;   // your own Worker: no app to ask
    const sketch = await run(tab, frameId, accountSketch);
    if (!sketch) return;
    const sig = JSON.stringify([sketch.controls, sketch.buttons, sketch.texts, sketch.frames]);
    if (judged.get(tab.id) === sig) return;   // the page is as it was when it was judged: the flag stays as it is
    const answer = await api(config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase: 'form', sketch})}).catch(() => null);
    if (!answer?.answer) return;   // no AI or no answer: the panel keeps its own count
    judged.set(tab.id, sig);
    let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ }
    decide('panel', `application form ready?: ${answer.answer}`, {host, step: answer.step || '', ...(answer.needs ? {needs: answer.needs.slice(0, 60), seen: sketch.controls.filter(item => item.required).map(item => `${item.type}:${item.state}`).join(',').slice(0, 120)} : {})});   // seen: what the AI was shown of the required controls (types and states, never labels or values)
    await run(tab, frameId, flagAccount, [answer.answer === 'needs_person' ? answer.needs || '' : null]);
    await pressNext(tab, frameId, answer, sig);   // a multi-step form's next step, when the person turned it on (next-step.js)
  } finally { looking.delete(tab.id); }
}
