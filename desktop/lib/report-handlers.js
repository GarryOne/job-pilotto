// The app's side of "Report this form" (owner, 19 Oct 2026: the recording is always on, so Report sends it: a small popup on the extension's panel, then Send; no trip to the app). The extension's panel
// asks the app whether the button is on, hands over the recording (POST /extension/report-form {action: 'submit'}); the app scrubs it and checks it (lib/report-form.js), holds it in memory and answers
// with counts (pages, what was removed); {action: 'send', note} runs the gate once more and the uploader (lib/report-upload.js); {action: 'cancel'} drops it. The Settings switch "Show Report this form"
// (default on) hides the button and refuses a recording. Sending goes through `uploader`: without one nothing can be sent and the button stays hidden. Owner values (name, e-mail, phone, place) come from
// the app's own files and never leave. Guard: test/report-panel.test.js.
import {setVisitRoute} from './server-hooks.js';
import {log as appLog} from './log.js';
import {appProfileTexts, ownerValuesOf} from './owner-values.js';
import {createHold, finalize, prepare} from './report-form.js';
import {scrubNote} from './report-scrub.js';

export const reportFormOn = storage => storage.settings().reportForm !== false;
export const BLOCKED = 'Job Pilotto could not remove everything personal from it safely, so nothing was sent.';

export function registerReportHandlers({ipcMain, storage, uploader = null, texts = appProfileTexts, hold = createHold()}) {
  let shown = null;   // the record the popup is showing: {id}
  const values = () => ownerValuesOf(texts());
  const enabled = () => reportFormOn(storage) && !!uploader;
  const drop = () => { if (shown) hold.take(shown.id); shown = null; };
  const where = hits => hits.map(hit => `${hit.kind} in ${hit.in} (${hit.type || 'none'})`).join(', ');   // kind, url or body, content kind: never a value
  const refused = kinds => ({ok: false, blocked: [...new Set(kinds)]});

  // The extension's calls: {action: 'state'} -> {enabled}; 'submit' {entries, truncated} -> {ok, preview} | {ok: false, refused | blocked}; 'send' {note} -> {ok} | {ok: false, error | blocked}; 'cancel' -> {ok}.
  const route = async payload => {
    if (payload?.action === 'state') return {ok: true, enabled: enabled()};
    if (payload?.action === 'cancel') { drop(); return {ok: true}; }
    if (!enabled()) return {ok: false, refused: 'off'};
    if (payload?.action === 'submit') {
      const result = prepare({entries: payload.entries, truncated: payload.truncated}, values());
      if (!result.ok) { appLog('report', `a report was stopped by the last check: ${where(result.blocked)}`); return refused(result.blocked.map(hit => hit.kind)); }
      drop();
      shown = {id: hold.put(result.held)};
      appLog('report', `a report is ready to send: ${result.preview.responses} responses, ${result.preview.hosts.length} hosts`);
      return {ok: true, preview: result.preview};
    }
    if (payload?.action === 'send') {
      const held = shown && hold.take(shown.id); shown = null;
      if (!held) return {ok: false, refused: 'expired'};
      const final = finalize(held, [], values());
      if (!final.ok) { appLog('report', `a report was stopped by the last check on sending: ${where(final.blocked)}`); return refused(final.blocked.map(hit => hit.kind)); }
      const note = scrubNote(payload.note, values());
      if (!note.ok) return refused(note.blocked);
      const sent = await uploader.send(final.record, {note: note.text}).catch(error => ({ok: false, error: String(error?.message || error).slice(0, 160)}));
      appLog('report', sent.ok ? 'a report was sent' : `a report was not sent: ${sent.error}`);
      return sent.ok ? {ok: true} : {ok: false, error: sent.error};
    }
    return {ok: false, refused: 'unknown'};
  };
  // A throw while preparing or sending is an answer ("failed", logged by its kind, never its text: it may quote an address), not a 500 the extension cannot tell from a closed app (19 Oct 2026).
  setVisitRoute('/extension/report-form', async payload => {
    try { return await route(payload); } catch (error) { appLog('report', `a report step failed (${payload?.action}): ${error?.name || 'Error'}`); return {ok: false, refused: 'failed'}; }
  });

  ipcMain.handle('reportFormGet', () => ({on: reportFormOn(storage), ready: !!uploader}));
  ipcMain.handle('reportFormSet', (_, value) => { storage.saveSettings({reportForm: !!value}); appLog('report', `Show Report this form ${value ? 'on' : 'off'}`, {decidedBy: 'user switch'}); return {on: !!value}; });
  ipcMain.handle('reportFormSent', () => ({count: uploader?.count() || 0}));
  ipcMain.handle('reportFormDeleteAll', () => (uploader ? uploader.deleteAll() : {ok: true, deleted: 0}));
  return {hold};
}
