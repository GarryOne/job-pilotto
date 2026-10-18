// The worker's side of "Report this form" (spec docs/superpowers/specs/2026-10-16-report-from-the-trace.md): owns the one form trace (trace.js) that every application tab keeps while the Settings switch
// is on, starts it when a tab the app opened begins to load, and answers the panel flag's messages: report-state (is it drawn, is there a trace, did the tab move past its first page) and report-send
// (hand the trace in memory to the app at once, POST /extension/report-form: the app scrubs it and shows the person what would be sent). No reload and no new recording. The trace is dropped when the
// tab closes or Stop is pressed. A message counts only from a tab the app opened (the debugger attach checks it too). A FLOW FILE (docs/flows/applying.md). Guard: desktop/test/report-panel.test.js.
import {createTrace} from './trace.js';
import {api, settings} from './flow.js';
import {isStopped, onStopped} from './stop.js';
import {sessionGet} from './tab-memory.js';

const ROUTE = '/extension/report-form';
const FILL_MARK = 'jobpilotto-fill';
const STATE_TTL_MS = 30e3;
// Any frame of the tab holding a password field: a sign-in page is never kept.
const passwordIn = async tabId => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: () => !!document.querySelector('input[type="password" i]')})).some(frame => frame.result);

export function createReportMessages() {
  const tell = async (payload, tabId) => api(await settings(), ROUTE, {method: 'POST', body: JSON.stringify(payload)}, true, tabId);
  let switchState = {at: 0, on: false};   // the app's Settings switch, asked at most every 30 s
  const switchOn = async tabId => {
    if (Date.now() - switchState.at < STATE_TTL_MS) return switchState.on;
    const answer = await tell({action: 'state'}, tabId).catch(() => null);
    switchState = {at: Date.now(), on: !!answer?.enabled};
    return switchState.on;
  };
  const trace = createTrace({chrome, hasPassword: passwordIn, enabled: () => switchOn()});
  onStopped(() => { trace.endAll(); });   // the Stop button ends every trace and keeps nothing

  // An application tab starts its trace as it begins to load (the posting's own answer is the first thing kept), and again at its commit in case the tab was not armed yet.
  const armedOrMarked = async (tabId, url) => String(url || '').includes(`#${FILL_MARK}`) || !!(await sessionGet(`armed:${tabId}`))[`armed:${tabId}`];
  chrome.webNavigation.onBeforeNavigate.addListener(async details => {
    if (details.frameId !== 0 || isStopped()) return;
    if (await armedOrMarked(details.tabId, details.url)) { await trace.navigating(details.tabId); trace.start(details.tabId).catch(() => {}); }
  });
  chrome.webNavigation.onCommitted.addListener(async details => {
    if (details.frameId !== 0 || trace.isTracing(details.tabId) || isStopped()) return;
    if (await armedOrMarked(details.tabId, details.url)) trace.start(details.tabId).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener(tabId => { trace.end(tabId); });
  chrome.debugger.onDetach.addListener(source => { if (source.tabId !== undefined) trace.detached(source.tabId); });

  return function messages_report(message, sender, reply) {
    const tabId = sender?.tab?.id;
    if (!['report-state', 'report-send', 'report-open'].includes(message?.type) || tabId === undefined) return undefined;
    (async () => {
      if (message.type === 'report-open') {   // the panel inside a frame of the page: its Report opens the card the top frame draws
        return chrome.tabs.sendMessage(tabId, {type: 'report-open'}, {frameId: 0}).then(() => ({ok: true}), () => ({ok: false}));
      }
      if (message.type === 'report-state') {
        if (isStopped()) return {enabled: false};
        switchState.at = 0;   // the panel asking is a page load: look at the switch again
        const on = await switchOn(tabId);
        if (!on) trace.end(tabId);
        return {enabled: on, tracing: trace.isTracing(tabId), has: trace.has(tabId), moved: trace.pageCount(tabId) > 1};
      }
      // report-send: the trace as it is now, at once
      const result = trace.snapshot(tabId, message.scope === 'page' ? 'page' : 'journey');
      if (!result.ok) return result;
      const answer = await tell({action: 'submit', entries: result.entries, truncated: result.truncated}, tabId).catch(() => null);
      return answer?.ok ? {ok: true} : {ok: false, refused: answer?.refused || 'app', blocked: answer?.blocked};
    })().then(reply, () => reply({ok: false, refused: 'error'}));
    return true;   // the answer comes later
  };
}
