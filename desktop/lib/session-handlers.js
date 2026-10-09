// Register the real session IPC flows with injected app services, so scenarios exercise the same handlers as Electron.
import fs from 'node:fs';
import path from 'node:path';
import * as terminals from './terminals.js';
import * as transcript from './transcript.js';
import * as quitDialog from './quit-dialog.js';
import {sessionIpc} from './session-contracts.js';
import {closeFormTab, listTabs, mergeTabs, withOpenForm} from './form-tab.js';

// Close a session's form tab and say whether it is closed. A tab the app already knows is gone needs no wait: asking its page
// to close costs the whole 6 s timeout when nobody answers (a cancel took 5-10 s with no sign of life, 3 Oct 2026).
export async function closeSessionTab({review, closeTab}, old) {
  if (review.tabOpen?.(old.id) === false) return true;
  return (await review.delivered(old.id, 6000)) || await closeTab({url: old.url, company: old.company});
}

import {cleanUse} from './proposal-use.js';
import {boardName} from './control-events.js';
export function registerSessionHandlers({ipcMain, appLog, storage, getWindow, dialog, nativeImage, here,
  DEMO, apply, pipeline, review, server, notion, claudeConsent, getRecipeReporter = () => null, version = '',
  closeTab = closeFormTab, tabs = listTabs}) {
  const checkedSessions = sessionIpc(ipcMain, appLog);
  checkedSessions.handle('sessionCancel', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    const {message, detail, buttons} = quitDialog.cancel(old.company);
    const {response} = await dialog.showMessageBox(getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 1, cancelId: 1, message, detail});
    if (response !== 0) return {ok: false, cancelled: true};
    const started = Date.now();
    terminals.stop(old.id);
    review.queueClose(old.id);
    const closed = await closeSessionTab({review, closeTab}, old);
    const reset = DEMO ? {ok: true} : await pipeline.unapply(storage, old.url).catch(error => ({ok: false, error: error.message}));
    if (!reset.ok) return {ok: false, error: `Notion: ${reset.error || 'not updated'}. The session stays; try again.`, closed};
    appLog('sessions', 'cancelled by the user: job back to Kit ready, session removed', {id: old.id, closed: !!closed, ms: Date.now() - started});
    terminals.setOutcome(old.id, 'cancelled');
    terminals.remove(old.id);
    return {ok: true, closed};
  });
  // Skip this role: give up on the job. Claude stops, the form tab closes, the job is Dismissed in Notion (hidden from the
  // list, as Dismiss in its menu), the session goes. No question: the button says it.
  checkedSessions.handle('sessionSkip', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    const started = Date.now();
    terminals.stop(old.id);
    review.queueClose(old.id);
    const closed = await closeSessionTab({review, closeTab}, old);
    // Applying is undone first (back to what it was: Kit ready), then the job is dismissed.
    const reset = DEMO ? {ok: true} : await pipeline.unapply(storage, old.url).catch(error => ({ok: false, error: error.message}));
    if (!reset.ok) return {ok: false, error: `Notion: ${reset.error || 'not updated'}. The session stays; try again.`, closed};
    const dismissed = DEMO ? {ok: true} : await pipeline.setStatus(storage, old.url, 'dismissed').catch(error => ({ok: false, error: error.message}));
    if (dismissed.ok === false) return {ok: false, error: `Notion: ${dismissed.error || 'could not dismiss the job'}. It is back to Kit ready; dismiss it from its menu.`, closed};
    appLog('sessions', `skipped by the user: job dismissed, session removed`, {id: old.id, closed: !!closed, ms: Date.now() - started});
    terminals.setOutcome(old.id, 'cancelled');
    terminals.remove(old.id);
    return {ok: true, closed};
  });
  // A new session on the same job, this one closed (its statistics are kept in Notion): in Chrome (a form session, the
  // extension fills it) or with Claude, as the person chose. Start again never starts Claude by itself.
  const details = old => ({title: old.title, company: old.company, location: old.location, workMode: old.workMode});
  const restartAs = async (old, how) => {
    if (how === 'claude' && !(await claudeConsent())) return {ok: false, error: 'Apply with Claude is off. Allow it in Settings.'};
    terminals.setOutcome(old.id, 'restarted');
    // The new session first, then the old one goes: removed first, the page fell to another session for a moment (owner, 8 Oct 2026).
    const started = how === 'claude' ? await apply.claudeOne(storage, old.url, undefined, undefined, undefined, details(old))
      : DEMO ? apply.openOne(old.url) : await apply.applyOne(storage, old.url, details(old));
    appLog('sessions', `started again by the user: ${how}`, {id: old.id, kind: old.kind, ok: !!started?.ok, next: started?.session?.id || ''});
    if (started?.session?.id) terminals.show(started.session.id);
    if (started?.ok) terminals.remove(old.id); else terminals.setOutcome(old.id, '');
    return started;
  };
  checkedSessions.handle('sessionRestart', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    // Always in Chrome, no question (owner, 9 Oct 2026: "start with Chrome always; Claude should be only a safety net"): the extension fills the
    // form; where it can't finish, the card and the panel offer Claude as they already do.
    return restartAs(old, 'chrome');
  });
  // The session's form tab was closed (a button looked for it and Chrome has none): the form opens again in a new tab with
  // the fill mark, so the extension's panel follows it. What the page held from the closed tab (`stale`: answers, form
  // progress, the stuck flag) is cleared.
  // "Use" on a Needs your attention row: the form's panel fills that one field through the extension (lib/review.js queueFill).
  // Logged: which session and field, never the value. The row checks the next report to see that it took.
  checkedSessions.handle('sessionFillField', (_, id, label, value) => {
    if (!terminals.get(String(id))) return {ok: false, error: 'This session is no longer in the list.'};
    if (!String(value).trim()) return {ok: false, error: 'Write an answer first.'};
    review.queueFill(String(id), label, value.trim());
    appLog('review', `fill one field asked from the session page`, {id, field: String(label).slice(0, 60)});
    return {ok: true};
  });
  // What the person did with a proposed answer (lib/proposal-use.js): fixed words, counted by the form's board and this app's version.
  checkedSessions.handle('sessionProposalUse', (_, id, source, act) => {
    const state = review.allStates().find(item => item.id === String(id));
    let host = '';
    try { host = new URL(String(state?.url || terminals.get(String(id))?.url || '')).hostname; } catch { /* no address */ }
    const use = cleanUse({board: boardName(host), source, act, v: version});
    if (!use) return {ok: false};
    if (act !== 'shown') appLog('review', `proposed answer ${act}`, {id, source, board: use.board});   // the decision, never the value
    getRecipeReporter()?.proposalUse(use);
    return {ok: true};
  });
  checkedSessions.handle('sessionReopen', async (_, id, stale) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    // No question (owner, 8 Oct 2026): the card already says Reopen fills the form again from your kit, so what the page held
    // from the closed tab is cleared and the form opens in a new tab. Claude is never started here; Start again is for that.
    const reset = !!stale;
    if (reset) { review.forget(old.id); terminals.clearStuck(old.id); }
    appLog('review', `tab gone ${old.id}: ${reset ? 'cleared the closed tab\'s state, reopening' : 'nothing to clear, reopening'}`, {kind: old.kind});
    const opened = apply.openOne(old.url);
    appLog('review', `tab gone ${old.id}: ${opened.ok ? 'reopened the form with the fill mark' : 'could not reopen'}`, {reset, error: opened.error || ''});
    return opened.ok ? {ok: true, reset} : {ok: false, error: opened.error};
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
