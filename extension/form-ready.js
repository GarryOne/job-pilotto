// The AI's veto on an APPLICATION form's "Ready to submit" (owner, 8 Oct 2026: the account page's "ready?" judgment, ported). The panel counts required boxes by HTML; when that count says
// everything is filled, the AI reads the page's real state (a consent that is a link, a custom picklist, an error shown) and may say "needs you: <label>"; the worker then sets the page's
// data-jobpilotto-needs, which the panel shows instead of "Ready". It only ever VETOES a ready claim: it never accepts a consent, never presses Submit, and without AI nothing changes.
// The answer is kept per tab for the sketch it was given (asked again only when the page changed), one look at a time. Guards: worker/test/form-ready.test.js, desktop/test/form-judge.test.js.
import {api, settings} from './flow.js';
import {decide} from './log.js';
import {accountSketch, flagAccount} from './account-fill.js';
import {pressNext} from './next-step.js';
import {onTop} from './on-top.js';
import {retryRefusedFormats} from './format-retry.js';

// What the panel says for each kind of block the AI named (fixed words of the product, not a reading of the page).
const BLOCKED_WORDS = {dialog: 'a dialog is open over the form', error: 'the site shows an error about what was entered', overlay: 'something is covering the form', gone: 'the application is no longer on the page'};
export const blockedWords = kind => BLOCKED_WORDS[kind] || BLOCKED_WORDS.overlay;

// A blocked page is judged once more a little later (11 Oct 2026, Louis Vuitton: a "wait, importing" dialog covered the form for a few seconds and then went): a page that recovers is not a failure, one that does not stays blocked.
export const timing = {recheckMs: 8000};
const looking = new Set(), judged = new Map();
// The structure says the form is ready: every counted required field is filled, on an application page (not an account page).
export const claimsReady = payload => !!payload && !payload.account && Number(payload.total) > 0 && Number(payload.left) === 0;

// world 'MAIN': the page's own world, where the fill kit's field-name reader lives (the judge's sketch and its layer name fields as the panel does).
const run = (tab, frameId, func, args = [], world) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args, ...(world ? {world} : {})}).then(rows => rows?.[0]?.result).catch(() => undefined);

// The fill of this tab still running (fill-flow.js writes <html data-jobpilotto-fill> on the top page): the page is half filled while the AI's answers are on their way, so the panel's count can
// look ready over boxes not written yet (12 Oct 2026, HelloFresh in the app: "needs First Name*" 0.6 s after the first fields, over a sketch with every box empty; the stale flag stayed and the
// phone retry never ran). The panel's claim is not judged then: the fill's own end judges the settled page (formNext). Guard: worker/test/form-ready.test.js, recorded case judge-waits-for-fill-1.
const fillRunning = tab => run(tab, 0, () => { try { return JSON.parse(document.documentElement?.dataset.jobpilottoFill || '{}').state === 'running'; } catch { return false; } }).then(Boolean);

export async function formReady(tab, frameId, payload) {
  if (!claimsReady(payload)) return;
  if (await fillRunning(tab)) return;
  return askForm(tab, frameId);
}

// After a fill, whatever the panel's count says (owner, 9 Oct 2026: the CV was in, the step was done, nothing asked what comes next because the count of HTML-required boxes was not "ready"):
// the AI looks at the page's real state once per page state, and a middle step's own next button is pressed (next-step.js).
export const formNext = (tab, frameId = 0) => askForm(tab, frameId);

async function askForm(tab, frameId, again = false) {
  if (looking.has(tab.id)) return;
  looking.add(tab.id);
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;   // your own Worker: no app to ask
    const sketch = await run(tab, frameId, accountSketch, [], 'MAIN');
    if (!sketch) return;
    sketch.onTop = await run(tab, frameId, onTop, [], 'MAIN') || null;   // what sits on top of the form, by structure (on-top.js)
    const sig = JSON.stringify([sketch.controls, sketch.buttons, sketch.texts, sketch.frames, sketch.onTop]);
    if (judged.get(tab.id) === sig) return;   // the page is as it was when it was judged: the flag stays as it is
    const answer = await api(config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase: 'form', sketch})}).catch(() => null);
    if (!answer?.answer) return;   // no AI or no answer: the panel keeps its own count
    judged.set(tab.id, sig);
    let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ }
    decide('panel', `application form ready?: ${answer.answer}`, {host, step: answer.step || '', ...(answer.answer === 'blocked' ? {blocked: answer.blockedKind || 'overlay'} : {}), ...(answer.needs ? {needs: answer.needs.slice(0, 60), seen: sketch.controls.filter(item => item.required).map(item => `${item.type}:${item.state}`).join(',').slice(0, 120)} : {})});   // seen: what the AI was shown of the required controls (types and states, never labels or values)
    await run(tab, frameId, flagAccount, [answer.answer === 'blocked' ? blockedWords(answer.blockedKind) : answer.answer === 'needs_person' ? answer.needs || '' : null]);
    if (answer.answer === 'blocked') decide('fill', `the page is blocked after the fill: ${answer.blockedKind || 'overlay'}`, {host});   // the fill log and the smoke verdict read this line
    // The site's own error about what was entered, on a phone number: it is typed again in another writing the AI names from the error text (format-retry.js, at most twice), then the page is judged anew.
    if (answer.answer === 'blocked' && answer.blockedKind === 'error' && await retryRefusedFormats(tab, frameId, config)) { setTimeout(() => { judged.delete(tab.id); askForm(tab, frameId, again).catch(() => {}); }, 2500); return; }
    if (answer.answer === 'blocked' && !again) setTimeout(() => { judged.delete(tab.id); askForm(tab, frameId, true).catch(() => {}); }, timing.recheckMs);
    await pressNext(tab, frameId, answer, sig);   // a multi-step form's next step, when the person turned it on (next-step.js)
  } finally { looking.delete(tab.id); }
}
