// The worker's side of "Report this form" (spec docs/superpowers/specs/2026-10-15-report-this-form.md): answers the panel flag's messages (report-state, report-start, report-stop, report-cancel),
// owns the one recorder (report-recorder.js), and on "Stop and review" hands what it kept to the app (POST /extension/report-form), which scrubs it and shows the person what would be sent.
// Whether the flag is drawn is the app's Settings switch, asked at report-state. A message counts only from a tab the app opened (the debugger attach checks it too). A FLOW FILE (docs/flows/applying.md).
// Guard: desktop/test/report-panel.test.js.
import {createRecorder} from './report-recorder.js';
import {api, settings} from './flow.js';
import {isStopped, onStopped} from './stop.js';
import {jobOf, markFor} from './tab-identity.js';
import {pageKey} from './tab-pages.js';
import {moveTab} from './tabs.js';

const ROUTE = '/extension/report-form';
// Any frame of the tab holding a password field: a sign-in page is never reported.
const passwordIn = async tabId => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: () => !!document.querySelector('input[type="password" i]')})).some(frame => frame.result);

export function createReportMessages() {
  const recorder = createRecorder({chrome, hasPassword: passwordIn});
  onStopped(() => { recorder.stop({keep: false}).catch(() => {}); });   // the Stop button ends a recording and keeps nothing
  // The report starts where the application started: the tab's posting (tab-identity.js jobOf, the app's own record), carrying the tab's session mark, so the fill takes its own steps again
  // (Apply press, redirects) and the recording holds the whole chain. -> true when the tab was moved; false when it is already on the posting (the recorder reloads it).
  const toPosting = async tab => {
    const posting = String(await jobOf(tab)).split('#')[0];
    if (!/^https?:/.test(posting) || pageKey(tab.url) === pageKey(posting)) return false;
    await moveTab(tab.id, `${posting}#${await markFor(tab.id)}`);
    return true;
  };
  const tell = async (payload, tabId) => api(await settings(), ROUTE, {method: 'POST', body: JSON.stringify(payload)}, true, tabId);

  return function messages_report(message, sender, reply) {
    const tabId = sender?.tab?.id;
    if (!['report-state', 'report-start', 'report-stop', 'report-cancel'].includes(message?.type) || tabId === undefined) return undefined;
    (async () => {
      if (message.type === 'report-state') {
        const answer = isStopped() ? {enabled: false} : await tell({action: 'state'}, tabId).catch(() => ({enabled: false}));
        return {enabled: !!answer?.enabled, recording: recorder.isRecording(tabId)};
      }
      if (message.type === 'report-start') return recorder.start(tabId, {restart: () => toPosting(sender.tab)});
      if (message.type === 'report-cancel') { await recorder.stop({keep: false}); return {ok: true}; }
      const result = await recorder.stop();   // report-stop
      if (!result.ok) return result;
      const answer = await tell({action: 'submit', entries: result.entries, truncated: result.truncated}, tabId).catch(() => null);
      return answer?.ok ? {ok: true} : {ok: false, refused: answer?.refused || 'app', blocked: answer?.blocked};
    })().then(reply, () => reply({ok: false, refused: 'error'}));
    return true;   // the answer comes later
  };
}
