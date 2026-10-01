// Register the real session IPC flows with injected app services, so scenarios exercise the same handlers as Electron.
import fs from 'node:fs';
import path from 'node:path';
import * as terminals from './terminals.js';
import * as transcript from './transcript.js';
import * as quitDialog from './quit-dialog.js';
import {sessionIpc} from './session-contracts.js';
import {closeFormTab, listTabs, mergeTabs, withOpenForm} from './form-tab.js';

export function registerSessionHandlers({ipcMain, appLog, storage, getWindow, dialog, nativeImage, here,
  DEMO, apply, pipeline, review, server, notion, claudeConsent,
  closeTab = closeFormTab, tabs = listTabs}) {
  const checkedSessions = sessionIpc(ipcMain, appLog);
  checkedSessions.handle('sessionCancel', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    const {message, detail, buttons} = quitDialog.cancel(old.company);
    const {response} = await dialog.showMessageBox(getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 1, cancelId: 1, message, detail});
    if (response !== 0) return {ok: false, cancelled: true};
    terminals.stop(old.id);
    review.queueClose(old.id);
    const closed = (await review.delivered(old.id, 6000)) || await closeTab({url: old.url, company: old.company});
    const reset = DEMO ? {ok: true} : await pipeline.unapply(storage, old.url).catch(error => ({ok: false, error: error.message}));
    if (!reset.ok) return {ok: false, error: `Notion: ${reset.error || 'not updated'}. The session stays; try again.`, closed};
    terminals.setOutcome(old.id, 'cancelled');
    terminals.remove(old.id);
    return {ok: true, closed};
  });
  checkedSessions.handle('sessionRestart', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    const {message, detail, buttons} = quitDialog.restart(old.company);
    const {response} = await dialog.showMessageBox(getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 0, cancelId: 1, message, detail});
    if (response !== 0) return {ok: false, cancelled: true};
    if (!(await claudeConsent())) return {ok: false, error: 'Apply with Claude is off. Allow it in Settings.'};
    terminals.setOutcome(old.id, 'restarted');
    terminals.remove(old.id);
    return apply.claudeOne(storage, old.url, undefined, undefined, undefined, {title: old.title, company: old.company, location: old.location, workMode: old.workMode});
  });
  // Apply with Claude sessions inside the app (lib/terminals.js): the dock, the session page and its terminal.
  // Demo mode: fictional sessions (demo/sessions.json) for screenshots; nothing runs.
  const demoSessions = () => JSON.parse(fs.readFileSync(path.join(here, 'demo', 'sessions.json'), 'utf8'));
  checkedSessions.handle('sessions', () => {
    const started = Date.now();
    const list = DEMO ? demoSessions() : terminals.list();
    const ms = Date.now() - started;
    if (ms >= 50) appLog('sessions', 'list was slow', {count: list.length, ms});
    return list;
  });
  const demoOutput = () => (process.env.JOB_PILOTTO_DEMO_OUTPUT ? fs.readFileSync(process.env.JOB_PILOTTO_DEMO_OUTPUT, 'utf8')  // a recorded session
    : '\x1b[2m19:10:02\x1b[0m \x1b[32m✓\x1b[0m Loaded the kit, Profile and answers from Notion\r\n\x1b[2m19:10:06\x1b[0m \x1b[32m✓\x1b[0m Opened the posting in Chrome\r\n' +
      '\x1b[2m19:10:09\x1b[0m \x1b[33m!\x1b[0m Location: San Francisco, CA · On-site\r\n\x1b[2m19:10:11\x1b[0m \x1b[35m⏸\x1b[0m Paused before opening the form. Waiting for your reply…\r\n\r\n\x1b[1m>\x1b[0m ');
  checkedSessions.handle('sessionOutput', (_, id) => (DEMO ? demoOutput() : terminals.output(String(id))));
  // The log's screen when it opens (see terminals.snapshot); JOB_PILOTTO_DEMO_OUTPUT replays a recorded session in demo mode.
  // A finished session as a conversation (its Claude Code transcript), for the log's page-text view.
  checkedSessions.handle('sessionTranscript', (_, id) => {
    const record = DEMO ? null : terminals.record(String(id));
    const file = DEMO ? path.join(here, 'demo', 'transcript.jsonl') : record?.transcript;
    const talk = file ? transcript.conversation(file) : null;
    if (talk?.length || DEMO || !record?.runPage) return talk;
    // The Mac's transcript is gone (Claude Code deletes old ones): the copy on the session's Agent Runs row.
    return transcript.load((method, route, body) => notion.call(storage.secret('NOTION_TOKEN'), method, route, body), record.runPage).catch(() => null);
  });
  checkedSessions.handle('sessionSnapshot', (_, id) => (DEMO ? terminals.snapshotOf(demoOutput()) : terminals.snapshot(String(id))));
  checkedSessions.handle('sessionWrite', (_, id, data) => terminals.write(String(id), data));
  checkedSessions.handle('sessionResize', (_, id, cols, rows) => terminals.resize(String(id), Number(cols), Number(rows)));
  checkedSessions.handle('sessionStop', (_, id) => terminals.stop(String(id)));
  checkedSessions.handle('sessionResume', async (_, id) => (await claudeConsent()) ? apply.resumeSession(storage, String(id)) : {ok: false, error: 'Cancelled.'});
  checkedSessions.handle('sessionRemove', (_, id) => terminals.remove(String(id)));
  // Its job is already Applied: the form was submitted, so the session ends (recorded as submitted, then gone).
  checkedSessions.handle('sessionSubmitted', (_, url) => (DEMO ? null : server.sessionSubmitted(String(url))));
  // Removing a session whose job is still Applying: was it submitted? Notion first; the session goes only if that worked.
  checkedSessions.handle('sessionFinish', async (_, id) => {
    const found = terminals.get(String(id));
    if (!found) return {ok: true};
    const {message, detail, buttons} = quitDialog.submitted(found.company);
    const {response} = await dialog.showMessageBox(getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 0, cancelId: 2, message, detail});
    if (response === 2) return {ok: false, cancelled: true};
    const result = DEMO ? {ok: true} : response === 0 ? await pipeline.setStatus(storage, found.url, 'applied') : await pipeline.unapply(storage, found.url);
    if (result.ok) terminals.setOutcome(String(id), response === 0 ? 'submitted' : 'not submitted');  // its statistics, before it goes
    if (!result.ok) return {ok: false, error: result.error || 'Notion could not be updated.'};
    terminals.remove(String(id));
    return {ok: true, submitted: response === 0};
  });
  // At start: sessions left open (the app closed, or was killed) whose jobs are still Applying. They are all kept, with no
  // question: a session's state is preserved, so it waits in Application sessions (Resume Claude) and the job's own
  // "I submitted it" / Cancel handle the rest. `kept` counts the ones whose form is still open in Chrome (for the toast).
  checkedSessions.handle('sessionsLeftOpen', async (_, ids) => {
    const all = (Array.isArray(ids) ? ids : []).map(id => terminals.get(String(id))).filter(Boolean);
    // What is open comes from the extension's report first (every browser it runs in), with Chrome's own scripting
    // added when it can see anything: a stray background Chrome made that scripting list empty, and sessions whose
    // forms were open looked closed (1 Oct 2026).
    const open = DEMO ? new Set() : withOpenForm(all, mergeTabs(server.openTabs(), await tabs()));
    terminals.markAsked(all.map(session => session.id));
    return {choice: 'keep', kept: open.size};
  });
}
