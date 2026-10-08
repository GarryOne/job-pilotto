// The application flow's IPC (moved out of main.js, 8 Oct 2026): Apply and Apply with Claude, the form page's review state, watch and focus, showing a
// job's form tab, un-applying, outcomes, the sign-in password and credentials, Google connection, open tabs and which forms are open, the
// extension's state and the learned answers. It hands back showForm for the browser handlers. A FLOW FILE (docs/flows/applying.md): changing
// it runs the whole scenario matrix (npm run flows). Guards: the apply, review and credentials tests in desktop/test and the e2e rows.
import * as applicationOutcomes from './outcomes.js';
import * as apply from './apply.js';
import * as credentials from './credentials.js';
import * as extensionInstall from './extension-install.js';
import * as github from './github.js';
import * as pipeline from './pipeline.js';
import * as questions from './questions.js';
import * as review from './review.js';
import * as server from './server.js';
import * as sitePassword from './site-password.js';
import * as terminals from './terminals.js';
import fs from 'node:fs';
import path from 'node:path';
import {GOOGLE_KEYCHAIN} from './google-keys.js';
import {log as appLog} from './log.js';
import {mergeTabs, openFormTab, withOpenForm} from './form-tab.js';
import {sharedCheck} from './shared-check.js';

export function registerApplyHandlers(ctx) {
  const {DEMO, allowanceBlock, claudeConsent, cloud, here, ipcMain, log, needsNotion, prepareKitFor, getRecipeReporter, shell, startClaude, storage, toWindow, track} = ctx;
  ipcMain.handle('apply', async (_, options) => needsNotion('apply') || allowanceBlock() || (options?.mode === 'agents' && !(await claudeConsent())
    ? {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'} : apply.start(storage, options, undefined, undefined, undefined, undefined, (code, name) => prepareKitFor(code, name, {quiet: true}), text => toWindow('applyProgress', text))));
  ipcMain.handle('applyOne', async (_, url, details) => {
    const gate = needsNotion('apply');
    if (gate) return gate;
    const blocked = allowanceBlock();
    if (blocked) return blocked;
    const result = await (DEMO ? apply.openOne(url) : apply.applyOne(storage, url, details || {}));
    if (result?.ok) track('apply_started', {how: 'extension'});
    return result;
  });
  // Checked session workflows share the production registration with the offline app scenario tests.
  ipcMain.handle('applyWithClaude', (_, url, details = null) => startClaude(url, details));
  server.setTakeOverHandler(async event => {   // the panel's button: the person's own request, the same start as the session card's Apply with Claude
    const job = event.job;
    appLog('extension', 'take over with Claude asked from the page', {host: event.host, known: !!job});
    const result = await startClaude(String(event.url || ''), job ? {title: job.title, company: job.company, location: job.location, workMode: job.work_mode} : null);
    if (result?.ok) { if (result.session?.id) toWindow('session', 'open', {id: result.session.id}); } else toWindow('toast', {title: 'Claude could not start', body: result?.error || 'Try again from the Applying page.'});
  });
  // The form page and this page in step (lib/review.js): what to track in the form, and "show me this field".
  // Demo: each form's tab opened 12 minutes ago, so the card's "open for" reads the same in every screenshot.
  ipcMain.handle('reviewStates', () => (DEMO ? JSON.parse(fs.readFileSync(path.join(here, 'demo', 'review.json'), 'utf8'))
    .map(state => ({tabAt: Date.now() - 12 * 60 * 1000, ...state})) : review.allStates()));
  ipcMain.handle('reviewWatch', (_, id, items) => {
    appLog('review', `watch ${id}: ${(items || []).length} field(s)`, {labels: (items || []).map(item => String(item.label).slice(0, 60))});
    return review.setWatch(String(id), items);
  });
  // The extension first: the form page takes the request, brings its own tab forward and scrolls to the field (no
  // macOS permission needed, never the wrong tab). Only when no page answers does the app look for the tab itself.
  const showForm = async (id, label, url, company) => {
    const key = String(id), name = String(label || '');
    // On a Mac the form tab is found and brought forward first, through Chrome's own tab list: at once, whatever the page is
    // doing (a background tab's timers are slow). One attempt: it worked, or it says no tab is this job's form.
    if (process.platform === 'darwin') {
      // The page this session's own reports came from, and the pages other sessions' came from (never taken for this one).
      const states = review.allStates();
      const hints = {own: states.find(state => state.id === key)?.url || '', claimed: states.filter(state => state.id !== key).map(state => state.url).filter(Boolean)};
      const direct = await openFormTab({url, company}, shell.openExternal, {confident: true, ...hints}).catch(() => 'none');
      if (direct !== 'tab') {
        appLog('review', `show ${key}: no tab is this job's form; nothing queued`, {went: direct});
        review.forget(key);
        return {taken: false, went: 'none', found: null};
      }
      if (!name) { appLog('review', `show ${key}: went straight to the form tab`, {went: direct}); return {taken: true, went: direct, found: null}; }
      // A field: the tab is in front now, so its page checks in quickly and scrolls to it.
      review.queueFocus(key, name);
      const answered = await review.delivered(key, 6000);
      if (!answered) review.cancelFocus(key);  // nobody took it: it must not fire later
      const seen = answered ? await review.focusFound(key, 3000) : null;
      appLog('review', `show ${key}: tab in front, ${answered ? 'the page took the field' : 'the page did not answer'}`, {label: name.slice(0, 60), found: seen});
      return {taken: answered, went: 'tab', found: seen};
    }
    review.queueFocus(key, name);
    let taken = await review.delivered(key, 4000);  // the page checks in every 2 s
    if (!taken) {
      // The tab Claude opened has no panel. Wake the extension and inject into that tab; do not reload it.
      let host = '';
      try { host = new URL(String(url || '')).hostname; } catch { /* no url */ }
      appLog('review', 'extension not on the form tab: joining it', {host});
      await extensionInstall.openInChrome(`chrome-extension://${server.EXTENSION_ID}/wake.html`, {browser: apply.extensionBrowser()}).catch(() => {});
      taken = await review.delivered(key, 6000);
    }
    if (!taken) review.cancelFocus(key);  // nobody took it: it must not fire later and pull Chrome forward
    const went = taken ? 'tab' : await openFormTab({url, company}, shell.openExternal);
    appLog('review', `show ${key}: ${taken ? 'form page answered' : `no page answered, app went to: ${went}`}`, {label: name.slice(0, 60), taken: !!taken, went});
    const found = taken && name ? await review.focusFound(key, 3000) : null;
    return {taken, went, found};
  };
  ipcMain.handle('reviewFocus', async (_, id, label, url, company) => {
    const result = await showForm(id, label, url, company);
    const seen = server.extensionSeen(), latest = server.latestExtension();
    return {...result, extension: seen?.version || '', latest, outdated: !!(seen?.version && latest && seen.version !== latest)};
  });
  ipcMain.handle('unapplyJob', (_, url) => pipeline.unapply(storage, String(url)));
  // "This wasn't submitted": only ever asked for by the user, and only from a bare Applied.
  ipcMain.handle('notSubmitted', (_, url) => {
    const job = String(url);
    appLog('applied', `not submitted: undo asked for ${job}`);
    return pipeline.notSubmitted(storage, job).then(result => {
      appLog('applied', `not submitted: ${job} -> ${result.notion || result.error} (${result.events || 0} event(s) removed)`);
      return result;
    });
  });
  // "How did it go?" on a job: written to Notion like a stage the Gmail check found, then counted anonymously (lib/outcomes.js) if reports are on.
  ipcMain.handle('markOutcome', async (_, input) => {
    const outcome = String(input?.outcome || ''), url = String(input?.url || '');
    const stage = applicationOutcomes.STAGES[outcome];
    if (!stage || !url) return {ok: false, error: 'Unknown outcome.'};
    if (DEMO) return {ok: true, stage};
    appLog('outcome', `marked ${outcome} (${stage})`, {board: applicationOutcomes.anonymous({url, outcome})?.board || ''});
    const result = await pipeline.markOutcome(storage, url, stage);
    if (result.ok && outcome !== 'withdrawn') getRecipeReporter()?.application(applicationOutcomes.anonymous({url, outcome, appliedOn: input?.appliedOn}));
    if (result.ok && outcome !== 'withdrawn') getRecipeReporter()?.reply(String(input?.bucket || ''), outcome);   // the job's score band, to see whether the score predicts replies
    return result;
  });
  ipcMain.handle('claudeReady', () => apply.claudeReady(storage));
  // Settings → Application assistant: the job-site password. Copy makes it the first time (the engine, on the clipboard, never printed).
  ipcMain.handle('sitePassword', async (_, action) => {
    if (DEMO) return {ok: true, password: 'Maple-Rocket-42'};
    if (action === 'show' && sitePassword.read()) return {ok: true, password: sitePassword.read()};
    const {code} = await pipeline.run(storage, ['src.ai.passwords', 'shared']);
    appLog('apply', `job-site password ${action === 'show' ? 'shown' : 'copied'}`, {ok: code === 0});
    if (code !== 0) return {ok: false, error: 'The password could not be made or read.'};
    return {ok: true, copied: true, password: action === 'show' ? sitePassword.read() : null};
  });
  // Settings → Credentials: the sites' accounts from the Keychain (attributes only), and one password when you press Show or Copy.
  ipcMain.handle('credentials', () => (DEMO ? {ok: true, rows: [{host: 'career2.successfactors.eu', email: 'you@example.com', job: 'https://jobs.migros.ch/x', created: '2026-10-08T11:54:02Z'}]} : credentials.list()));
  ipcMain.handle('credentialReveal', (_, host, why) => {
    const password = DEMO ? 'Maple-Rocket-42' : credentials.reveal(host);
    appLog('apply', `credential ${why === 'copy' ? 'copied' : 'shown'}`, {host: String(host || '').slice(0, 120), found: !!password});   // which site, never the password
    return password ? {ok: true, password} : {ok: false, error: 'Not in the Keychain any more.'};
  });
  ipcMain.handle('claudePrereqs', async () => ({...apply.claudePrereqs(), inApp: await terminals.available()}));
  // Gmail and Calendar (read-only): replies and interviews, and sign-up confirmation emails for Apply with Claude.
  // The token lives in the Keychain, where the Python side (src/sources/google.py) reads it.
  // One Gmail check shared by every view (lib/shared-check.js): Settings' overview and the Gmail card ask at once.
  const googleStatus = sharedCheck(async () => {
    const {stdout} = await pipeline.run(storage, ['src.sources.google', 'status']);
    return JSON.parse(stdout.trim().split('\n').pop());  // unreadable: throws, so it isn't kept and is retried
  });
  ipcMain.handle('googleStatus', async () => {
    // Demo mode: the fictional user's account. The real check reads this Mac's Google sign-in (the Keychain, not the
    // demo folder), which put the owner's own address into the reference screenshots.
    // JOB_PILOTTO_DEMO_GOOGLE=off shows the disconnected states (the state viewer, e2e/mail-states.mjs).
    if (DEMO) return process.env.JOB_PILOTTO_DEMO_GOOGLE === 'off' ? {connected: false} : {connected: true, email: 'alex.morgan@example.com'};
    try { return await googleStatus(); } catch { return {connected: false}; }
  });
  ipcMain.handle('googleConnect', async () => {
    const gate = needsNotion('gmail');
    if (gate) return gate;
    const lines = [];
    const {code} = await pipeline.run(storage, ['src.sources.google', 'auth'], line => lines.push(line));
    googleStatus.forget();   // the next status asks again, so the new account shows at once
    // Always on: the new sign-in goes to the GitHub repo too, so the Gmail check there can use it.
    if (code === 0 && cloud()) github.updateRepo(storage).catch(error => log(`Google sign-in not sent to GitHub: ${error.message}`));
    return code === 0 ? {ok: true} : {ok: false, error: lines.filter(line => !/^Opening|^https?:/.test(line)).slice(-1)[0] || 'Sign-in did not complete'};
  });
  // Settings → Gmail and Calendar → ⋯ → Disconnect Gmail (owner, 7 Oct 2026): revoked at Google, forgotten in the Keychain and, with
  // Always on, in the GitHub repo. Logged: what was asked and what each step did, never the token.
  ipcMain.handle('googleDisconnect', async () => {
    if (DEMO) return {ok: false, error: 'Demo mode: the sign-in is not changed.'};
    const {code, stdout} = await pipeline.run(storage, ['src.sources.google', 'disconnect']);
    let result = {};
    try { result = JSON.parse(String(stdout).trim().split('\n').pop()); } catch {}
    googleStatus.forget();
    let inRepo = false;
    if (code === 0 && cloud()) inRepo = await github.removeRepoSecrets(storage, Object.keys(GOOGLE_KEYCHAIN)).catch(error => { appLog('connections', 'Gmail secrets not removed from GitHub', {error: error.message}); return 'failed'; });
    appLog('connections', 'Gmail disconnected', {from: 'settings', code, revoked: !!result.revoked, wasConnected: !!result.was_connected, github: inRepo});
    return code === 0 && result.ok ? {ok: true, revoked: !!result.revoked, github: inRepo} : {ok: false, error: 'Gmail could not be disconnected: try again'};
  });
  ipcMain.handle('openTabs', () => server.openTabs());
  // Which sessions' forms are still open in Chrome, by the extension's own tab report. `known` is false while the
  // extension has not checked in lately: then nothing can be said about a closed tab, so the page says nothing.
  let lastFormsOpen = '';
  ipcMain.handle('formsOpen', () => {
    const seen = server.extensionSeen(), known = !!seen && Date.now() - seen.at < 90 * 1000;
    if (!known) return {known, ids: []};
    // A session whose own tab we know is open while that tab exists; for the others, a tab that looks like its form says open, nothing says closed.
    const sessions = terminals.list(), byLook = withOpenForm(sessions, mergeTabs(server.openTabs(), []));
    const {ids, unsure} = review.formStates(sessions.map(session => session.id), byLook);
    const line = `${ids.join(',') || 'none'}${unsure.length ? ` (not known: ${unsure.join(',')})` : ''}`;
    if (line !== lastFormsOpen) { lastFormsOpen = line; appLog('review', `forms open in Chrome: ${line}`, {sessions: sessions.length}); }   // who is open, when it changed
    return {known, ids, unsure};
  });
  // latest + note: the pages show one wording for a stale copy (server.staleExtension), the same sentence the app
  // records with a failed fill.
  ipcMain.handle('extensionSeen', () => {
    const seen = server.extensionSeen();
    if (!seen) return null;
    const latest = server.latestExtension();
    return {...seen, latest, note: server.staleExtension(seen.version, latest)};
  });
  // A failed Notion read is reported (not an empty list), so the section says why instead of disappearing.
  ipcMain.handle('openQuestions', () => (DEMO ? Promise.resolve(storage.settings().openQuestions || []) : questions.list(storage)).then(list => ({ok: true, list}), error => ({ok: false, error: error.message, list: []})));
  ipcMain.handle('answerQuestion', (_, questionKey, answer) => needsNotion('profile') || questions.answer(storage, questionKey, answer)
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // A session's ❓ fact, answered with one tick on the session page: saved to the standard answers page.
  ipcMain.handle('rememberAnswer', (_, question, answer) => (DEMO ? Promise.resolve({ok: true}) : needsNotion('profile') || questions.remember(storage, question, answer))
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // Saved keys as dots plus their last 4 characters, so Settings can show which key is stored (never the key).
  ipcMain.handle('secretHints', () => Object.fromEntries(['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY']
    .map(name => [name, storage.secret(name)]).filter(([, value]) => value).map(([name, value]) => [name, `${'•'.repeat(12)}${value.slice(-4)}`])));
  return {showForm};   // the browser handlers (lib/browser-handlers.js) show a job's form tab through it
}
