// The app's wiring of "Report this form" (spec docs/superpowers/specs/2026-10-15-report-this-form.md §1-§4): the extension's panel flag asks the app whether the button is on and hands over the recording
// (POST /extension/report-form); the app scrubs it and checks it (lib/report-form.js), holds it in memory, and shows the person what would be sent in its window. The window's Send and Cancel come back
// here over IPC. The Settings switch "Show Report this form" (default on) hides the flag and refuses a recording. Sending goes through `uploader` (lib/report-upload.js: send, count, deleteAll): without one nothing can be sent and the
// flag stays hidden. Owner values (name, e-mail, phone, place) come from the app's own files and never leave. Guard: test/report-panel.test.js.
import {setVisitRoute} from './server-hooks.js';
import {log as appLog} from './log.js';
import {appProfileTexts, ownerValuesOf} from './owner-values.js';
import {createHold, finalize, prepare} from './report-form.js';

export const reportFormOn = storage => storage.settings().reportForm !== false;

export function registerReportHandlers({ipcMain, storage, toWindow, getWindow, uploader = null, texts = appProfileTexts, hold = createHold()}) {
  let shown = null;   // the preview the window is showing: {id, preview}
  const values = () => ownerValuesOf(texts());
  const enabled = () => reportFormOn(storage) && !!uploader;

  // The extension's calls: {action: 'state'} -> {enabled}; {action: 'submit', entries, truncated} -> {ok} | {ok: false, refused | blocked}.
  setVisitRoute('/extension/report-form', payload => {
    if (payload?.action === 'state') return {ok: true, enabled: enabled()};
    if (payload?.action !== 'submit') return {ok: false, refused: 'unknown'};
    if (!enabled()) return {ok: false, refused: 'off'};
    const result = prepare({entries: payload.entries, truncated: payload.truncated}, values());
    if (!result.ok) { appLog('report', `a report was stopped by the last check: ${result.blocked.map(hit => hit.kind).join(', ')}`); return {ok: false, blocked: result.blocked.map(hit => hit.kind)}; }
    if (shown) hold.take(shown.id);
    shown = {id: hold.put(result.held), preview: result.preview};
    appLog('report', `a report is ready to review: ${result.preview.responses} responses, ${result.preview.hosts.length} hosts`);
    toWindow('reportFormReady', shown);
    const window = getWindow(); if (window) { if (window.isMinimized?.()) window.restore(); window.show?.(); window.focus?.(); }
    return {ok: true};
  });

  ipcMain.handle('reportFormGet', () => ({on: reportFormOn(storage), ready: !!uploader, shown}));
  ipcMain.handle('reportFormSet', (_, value) => { storage.saveSettings({reportForm: !!value}); appLog('report', `Show Report this form ${value ? 'on' : 'off'}`, {decidedBy: 'user switch'}); return {on: !!value}; });
  ipcMain.handle('reportFormSent', () => ({count: uploader?.count() || 0}));
  ipcMain.handle('reportFormDeleteAll', () => (uploader ? uploader.deleteAll() : {ok: true, deleted: 0}));
  ipcMain.handle('reportFormCancel', () => { if (shown) hold.take(shown.id); shown = null; return {ok: true}; });
  // Send: the hosts the person dropped leave, the gate runs once more, then the uploader (encrypts, sends). Nothing is held afterwards, whatever the answer.
  ipcMain.handle('reportFormSend', async (_, dropHosts = []) => {
    if (!shown || !uploader) return {ok: false, error: 'Nothing to send.'};
    const held = hold.take(shown.id); shown = null;
    if (!held) return {ok: false, error: 'This report expired: record it again.'};
    const final = finalize(held, Array.isArray(dropHosts) ? dropHosts.map(String) : [], values());
    if (!final.ok) return {ok: false, error: `Job Pilotto could not remove everything personal from it safely, so nothing was sent. Still found: ${[...new Set(final.blocked.map(hit => hit.kind))].join(', ')}.`};
    return uploader.send(final.record).catch(error => ({ok: false, error: String(error?.message || error).slice(0, 160)}));
  });
  return {hold};
}
