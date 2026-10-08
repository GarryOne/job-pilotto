// The closer look (spec: docs/superpowers/specs/2026-10-08-ai-escalation.md; owner, 8 Oct 2026: off until he turns it on, account pages first). When the account AI is unsure twice about a page, or a control it
// named cannot be found, the worker takes a screenshot of the tab (typed values hidden for the capture), asks the app (lib/escalate.js: opt-in, capped, validated, remembered per page shape) and carries out
// ONE action: click a control the page lists, wait, or ask the person. A click that moved the page on is reported back so the app remembers it. Only a tab in front can be photographed. Guard: worker/test/escalate.test.js.
import {api, settings} from './flow.js';
import {decide} from './log.js';
import {accountSketch} from './account-fill.js';
import {hideValues, showValues} from './page-picture.js';
import {pressRegister} from './account-fill.js';
import {chooseOption, fillControl} from './account-act.js';

const run = (tab, frameId, func, args = []) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args}).then(rows => rows?.[0]?.result).catch(() => undefined);
export const UNSURE_BEFORE_LOOKING = 2;
// True when this page state has now been "unsure" twice: `seen` is a Map of tab -> {sig, count}.
export function unsureTwice(seen, tabId, sig) {
  const now = seen.get(tabId);
  const next = now?.sig === sig ? {sig, count: now.count + 1} : {sig, count: 1};
  seen.set(tabId, next);
  return next.count === UNSURE_BEFORE_LOOKING;   // exactly the second time, once per page state
}

// The tab as a data: URL. captureVisibleTab needs the page's host permission (an unlisted site has none), so the debugger (already a permission) takes it then.
async function shot(live) {
  try { return await chrome.tabs.captureVisibleTab(live.windowId, {format: 'jpeg', quality: 60}); } catch { /* no host permission: the debugger below */ }
  const target = {tabId: live.id};
  await chrome.debugger.attach(target, '1.3');
  try { const {data} = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {format: 'jpeg', quality: 60}); return `data:image/jpeg;base64,${data}`; }
  finally { await chrome.debugger.detach(target).catch(() => {}); }
}

// The visible page as a JPEG of at most 1280 px, base64, values hidden while it is taken. null when the tab is not in front.
async function picture(tab, frameId) {
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  if (!live?.active) return null;
  await run(tab, frameId, hideValues);
  try {
    await new Promise(resolve => setTimeout(resolve, 120));   // the style paints before the capture
    const url = await shot(live);
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const scale = Math.min(1, 1280 / bitmap.width), canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.6});
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  } catch (error) { decide('fill', 'closer look: no picture', {why: String(error?.message || error).slice(0, 120)}); return null; } finally { await run(tab, frameId, showValues); }
}

// -> 'none' | 'click' | 'fill' | 'choose' | 'wait' | 'ask_person' (what was done or decided). reason: why we ask (for the log and the model).
export async function closerLook(tab, frameId, reason) {
  const config = await settings();
  if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return 'none';
  const sketch = await run(tab, frameId, accountSketch);
  const image = sketch ? await picture(tab, frameId) : null;
  if (!sketch || !image) { decide('fill', 'closer look: no picture (not in front, or no sketch)', {}); return 'none'; }
  const url = tab.url.split('#')[0];
  const answer = await api(config, '/extension/escalate', {method: 'POST', body: JSON.stringify({url, kind: 'account', sketch, image, reason})}).catch(() => null);
  const action = answer?.action || 'none';
  decide('fill', `closer look: ${action}`, {reason, by: answer?.by || '', why: String(answer?.why || '').slice(0, 80)});
  if (action === 'click' && answer.control) {
    const result = await run(tab, frameId, pressRegister, [answer.control]);
    decide('fill', `closer look: pressed (${result})`, {});
    if (result === 'pressed') {   // did the page move on? then the app remembers this click for the page shape
      await new Promise(resolve => setTimeout(resolve, 3000));
      const after = await run(tab, frameId, accountSketch);
      const worked = !!after && JSON.stringify([after.controls.map(item => item.label), after.buttons]) !== JSON.stringify([sketch.controls.map(item => item.label), sketch.buttons]);
      api(config, '/extension/escalate', {method: 'POST', body: JSON.stringify({url, feedback: {action: 'click', control: answer.control, worked}})}).catch(() => {});
    }
  }
  // fill: the app resolved the value from the person's contact details (never logged, never sent to the model); choose: one of the dropdown's own options. Both only when the app allowed them (full).
  if ((action === 'fill' && answer.control && answer.value) || (action === 'choose' && answer.control && answer.option)) {
    const result = action === 'fill' ? await run(tab, frameId, fillControl, [answer.control, answer.value]) : await run(tab, frameId, chooseOption, [answer.control, answer.option]);
    decide('fill', `closer look: ${action} (${result})`, {detail: answer.detail || '', ...(action === 'choose' ? {option: String(answer.option).slice(0, 40)} : {})});
    if (result === 'filled' || result === 'chosen') api(config, '/extension/escalate', {method: 'POST', body: JSON.stringify({url, feedback: {action, control: answer.control, detail: answer.detail, option: answer.option, worked: true}})}).catch(() => {});
  }
  return action;
}

// The live test (desktop/e2e/lib/apply-live.mjs) reaches the worker only through its evaluate(), where import() is not allowed: it calls this. Not reachable from any page.
globalThis.__jobPilottoCloserLook = closerLook;
