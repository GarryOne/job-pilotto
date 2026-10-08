// The app's own state over IPC (moved out of main.js, 8 Oct 2026): the license, technical reports (telemetry, tester logs), sharing
// anonymous employer facts, app updates and the beta channel, the leaving question and feedback. main.js passes in the services they share.
// Guards: the license, telemetry, updater and beta tests in desktop/test.
import * as appFeedback from './app-feedback.js';
import * as github from './github.js';
import * as licenseLib from './license.js';
import * as pipeline from './pipeline.js';
import * as poolShare from './pool-share.js';
import * as setupFunnel from './setup-funnel.js';
import * as sharedLog from './shared-log.js';
import * as updater from './updater.js';
import {log as appLog} from './log.js';

export function registerAppMetaHandlers(ctx) {
  const {DEMO, FROM_SOURCE, app, betaOn, checkForUpdate, cloud, dialog, installUpdate, ipcMain, licenseState, log, storage, testerLogsOn, testerOn, track, getLicense, getTelemetry, getUpdateOffer, setUpdateOffer, getUpdateCheckedAt, getWindow} = ctx;
  // App updates (lib/updater.js): the latest stable release, offered in the menu; one click installs it.
  // Technical reports: the window's own errors come here; Settings shows the last ones sent and the switch.
  // Settings → License: where the user stands, pasting a key (checked offline), removing it.
  ipcMain.handle('license', () => ({...licenseState(), text: licenseLib.text(licenseState())}));
  ipcMain.handle('licenseSet', (_, key) => {
    if (DEMO) return {ok: false, error: 'Demo mode: keys are not saved.'};
    const result = getLicense().set(String(key || ''));
    return result.ok ? {ok: true, state: {...result.state, text: licenseLib.text(result.state)}} : result;
  });
  ipcMain.handle('licenseRemove', () => { const state = getLicense().remove(); return {...state, text: licenseLib.text(state)}; });
  ipcMain.handle('telemetryRecord', (_, kind, fields) => {
    // A window error also goes to app.log (type and message; the stack stays in the report): it was invisible there.
    if (kind === 'advice') appLog('advice', `${String(fields?.act || '?').slice(0, 10)} ${String(fields?.advice || '?').slice(0, 20)} on ${String(fields?.where || '?').slice(0, 20)}`, fields?.source ? {source: String(fields.source).slice(0, 30)} : {});   // what the app recommended, and what was taken
    if (kind === 'crash') appLog('window', `error on ${String(fields?.page || '?').slice(0, 30)}: ${String(fields?.type || 'Error').slice(0, 40)}: ${String(fields?.message || '').slice(0, 300)}`);
    getTelemetry()?.record(String(kind), fields || {});
    return true;
  });
  // The switch shows the saved choice (on unless turned off), also in a build that doesn't send (the reporter is null there).
  ipcMain.handle('telemetryShown', () => ({on: storage.settings().telemetry !== false, events: getTelemetry()?.shown() || [], shared: sharedLog.list(storage), tester: testerOn(), testerLogs: testerLogsOn()}));
  ipcMain.handle('testerLogsSet', (_, on) => { storage.saveSettings({testerLogs: !!on}); appLog('telemetry', `tester run logs ${on ? 'on' : 'off'}`); return {on: !!on}; });
  // "Help the pool grow" (opt-out, lib/pool-share.js): the switch, and exactly what would be sent (python -m src contribute --show).
  ipcMain.handle('poolShareGet', () => ({on: poolShare.on(storage)}));
  ipcMain.handle('poolShareSet', async (_, value) => {
    const result = poolShare.set(storage, value);
    appLog('pool', `Help the pool grow ${value ? 'on' : 'off'}`, {decidedBy: 'user switch'});
    if (cloud()) github.updateRepo(storage).catch(error => log(`GitHub repo not updated: ${error.message}`));
    return result;
  });
  ipcMain.handle('poolShareShown', async () => {
    const {code, stdout} = await pipeline.run(storage, ['src.contribute', '--show']);
    return {text: code === 0 ? stdout.trim() : 'Could not work out what would be sent right now.'};
  });
  ipcMain.handle('telemetrySet', (_, on) => { storage.saveSettings({telemetry: !!on}); if (!on) getTelemetry()?.flush(); return {on: !!on}; });
  ipcMain.handle('updateState', () => getUpdateOffer());
  ipcMain.handle('updateCheck', () => checkForUpdate(true));
  ipcMain.handle('updateStatus', () => ({current: app.getVersion(), offer: getUpdateOffer(), checkedAt: getUpdateCheckedAt(), fromSource: FROM_SOURCE}));
  ipcMain.handle('updateInstall', () => installUpdate());
  // Beta (Settings → Diagnostics → Beta). Asked here, in the main process: only a click on this dialog turns it on, never a script in the window.
  // Beta builds are only the ones the release gate approved (tools/beta-approve.sh); "Back to stable" installs the latest stable release even though it is older.
  const parentWindow = () => (getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined);
  ipcMain.handle('betaState', async () => {
    const stable = FROM_SOURCE ? null : await updater.stableRelease(app.getVersion()).catch(() => null);
    return {on: betaOn(), current: app.getVersion(), stable: stable?.version || '', ahead: !!stable?.ahead, fromSource: FROM_SOURCE};
  });
  ipcMain.handle('betaSet', async (_, want) => {
    if (DEMO || FROM_SOURCE) return {ok: false, text: 'Not in demo mode or when running from source.'};
    if (want) {
      const {response} = await dialog.showMessageBox(parentWindow(), {type: 'question', message: 'Get the beta version?', buttons: ['Join the beta', 'Not now'], defaultId: 1, cancelId: 1,
        detail: 'Be the first to test new features. Beta versions pass our automatic checks, but can still have bugs. Job Pilotto will offer you each one; nothing installs without your click.\n\nYou can go back to the stable version any time: Settings → Diagnostics → Beta → Back to stable.'});
      if (response !== 0) return {ok: false, cancelled: true};
    }
    storage.saveSettings({betaChannel: !!want});
    appLog('update', `beta channel ${want ? 'on' : 'off'}`, {version: app.getVersion()});
    checkForUpdate();
    return {ok: true, on: !!want};
  });
  ipcMain.handle('betaRollback', async () => {
    if (DEMO || FROM_SOURCE) return {ok: false, text: 'Not in demo mode or when running from source.'};
    const stable = await updater.stableRelease(app.getVersion()).catch(error => ({error}));
    if (stable?.error) return {ok: false, text: `Couldn't reach GitHub: ${stable.error.message}`};
    if (!stable?.ahead) return {ok: false, text: 'You are not ahead of the stable version.'};
    const {response} = await dialog.showMessageBox(parentWindow(), {type: 'question', message: `Go back to stable ${stable.version}?`, buttons: ['Go back to stable', 'Cancel'], defaultId: 0, cancelId: 1,
      detail: `You have ${app.getVersion()}. The app closes, installs the stable version and opens again. Your jobs and answers are in Notion and stay as they are. The beta is switched off; you can join again any time.`});
    if (response !== 0) return {ok: false, cancelled: true};
    storage.saveSettings({betaChannel: false});
    setUpdateOffer(stable);
    appLog('update', `back to stable: ${app.getVersion()} -> ${stable.version}`);
    return installUpdate();
  });
  // Why setup stopped (the quit question or "Stuck? Tell us"): a setup report; typed words also reach the owner.
  ipcMain.handle('leaveReason', async (_, answer = {}) => {
    const event = answer.reason ? setupFunnel.stopped(answer, storage.settings()) : null;
    if (event && getTelemetry()) { getTelemetry().record('setup', event); await getTelemetry().flush().catch(() => {}); }
    if (event?.said) await appFeedback.send({text: `[Setup · ${event.where} · ${setupFunnel.REASONS[event.reason]}] ${event.said}`, contact: answer.contact || ''},
      {storage, version: app.getVersion()}).catch(() => {});
    if (answer.mode === 'quit') setTimeout(() => app.quit(), 100);
    return {ok: true};
  });
  // Send feedback… (lib/app-feedback.js): to the owner, through the website. Demo mode sends nothing.
  ipcMain.handle('sendFeedback', (_, text, contact) => DEMO ? {ok: true}
    : appFeedback.send({text, contact}, {storage, version: app.getVersion()}).then(result => { if (result?.ok) track('feedback_sent', {}); return result; }));
}
