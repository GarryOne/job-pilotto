// The setup and settings IPC (moved out of main.js, 8 Oct 2026): connecting Notion (the sign-in and its gate), saving settings, the contact details and
// secrets, the AI engine (Claude Code or a key), the trial credit, choosing and changing the CV. main.js passes in the services they share.
// Guards: the notion-oauth, settings, claude-code and cv tests in desktop/test.
import * as aiTrial from './ai-trial.js';
import * as claudeCode from './claude-code.js';
import * as cvChange from './cv-change.js';
import * as cvlib from './cv.js';
import * as notionGate from './notion-gate.js';
import * as notionOAuth from './notion-oauth.js';
import fs from 'node:fs';
import path from 'node:path';
import {cleanSecret} from './secrets.js';
import {log as appLog} from './log.js';

export function registerSetupHandlers(ctx) {
  const {Anthropic, DEMO, connectNotion, dialog, handleImportant, ipcMain, licenseState, needsNotion, shell, storage, syncCv, getTelemetry, track, trackSetup, getWindow, setNotionFrom} = ctx;
  handleImportant('notionConnect', 'Connecting Notion', async (_, pasted) => {
    const {value: token, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    return connectNotion(token);
  });
  // "Connect with Notion": Notion's consent page in the browser, then the same connect as above.
  handleImportant('notionOAuth', 'Connecting Notion', async (_, options = {}) => {
    setNotionFrom(typeof options?.from === 'string' ? options.from.slice(0, 40) : 'unknown');  // for the log: wizard, gate:<reason>, settings
    const signedIn = await notionOAuth.connect(url => shell.openExternal(url));
    if (!signedIn.ok) return signedIn;
    getWindow()?.show();
    getWindow()?.focus();
    return {...await connectNotion(signedIn.access_token, {templateRoot: notionOAuth.templateRoot(signedIn)}), workspace: signedIn.workspace_name};
  });
  ipcMain.handle('notionOAuthCancel', () => notionOAuth.cancel());
  // The connect prompt's outcome (lib/notion-gate.js gateEvent): fixed lists only; counted per install, reported when reports are on.
  ipcMain.handle('notionGateEvent', (_, payload) => {
    const settings = storage.settings();
    const event = notionGate.gateEvent(payload, {firstRunAt: settings.firstRunAt, shown: settings.notionGateShown || 0});
    if (!event) return false;
    storage.saveSettings({notionGateShown: event.shown});
    appLog('notion', 'gate', {reason: event.reason, where: event.where, outcome: event.outcome, why: event.why});
    if (getTelemetry()) getTelemetry().record('setup', event);
    track('notion_gate', {reason: event.reason, outcome: event.outcome, ...(event.why ? {why: event.why} : {})});
    return true;
  });
  ipcMain.handle('saveSettings', (_, patch) => {
    const before = storage.settings();
    const saved = storage.saveSettings(patch);
    trackSetup(patch, before);
    return saved;
  });
  ipcMain.handle('saveSecret', (_, name, pasted) => {
    const {value, error} = cleanSecret(pasted);
    if (error) throw new Error(error);
    storage.setSecret(name, value);
    if (name === 'ANTHROPIC_API_KEY' && !aiTrial.isTrialKey(value)) aiTrial.stop(storage);  // own key: leave the free credit
    return storage.secretsPresent();
  });
  // The AI engine (Settings → Connections → AI, the wizard's AI step; lib/claude-code.js): the user's own choice.
  const DEMO_CLAUDE = {installed: true, version: '2.1.0', path: '/usr/local/bin/claude', authenticated: true, error: '', checkedAt: '2026-09-30T09:00:00Z'};
  ipcMain.handle('claudeCodeStatus', async () => (DEMO ? DEMO_CLAUDE : {...(storage.settings().claudeCode || {}), ...await claudeCode.detect(),
    checkedAt: storage.settings().claudeCode?.checkedAt || null}));
  ipcMain.handle('verifyClaudeCode', () => (DEMO ? DEMO_CLAUDE : claudeCode.verify(storage)));
  ipcMain.handle('setAiEngine', (_, choice, options = {}) => {
    if (!claudeCode.ENGINES.includes(choice)) throw new Error(`Unknown AI engine: ${choice}`);
    storage.saveSettings({aiEngine: choice, ...(choice === 'cli' ? {claudeCodeNotice: true} : {}),
      ...('fallback' in options ? {aiFallback: !!options.fallback} : {})});
    return storage.settings();
  });
  ipcMain.handle('setAiFallback', (_, on) => { storage.saveSettings({aiFallback: !!on}); return storage.settings(); });
  ipcMain.handle('dismissEngineOffer', () => { storage.saveSettings({aiEngineOffered: true}); return storage.settings(); });
  // The free AI credit for invited testers (lib/ai-trial.js).
  ipcMain.handle('startTrialCredit', () => aiTrial.start(storage, licenseState));
  ipcMain.handle('trialCredit', () => aiTrial.credit(storage));
  ipcMain.handle('checkAnthropic', async (_, pasted) => {
    const {value: key, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    try {
      await new Anthropic({apiKey: key, baseURL: 'https://api.anthropic.com'}).models.list({limit: 1}); // free call: is the key valid?
      return {ok: true};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? 'This key was rejected. Copy it again from console.anthropic.com.' : error.message};
    }
  });
  ipcMain.handle('chooseCv', async () => {
    const picked = await dialog.showOpenDialog(getWindow(), {title: 'Choose your CV', filters: [{name: 'PDF', extensions: ['pdf']}], properties: ['openFile']});
    if (picked.canceled || !picked.filePaths[0]) return null;
    const name = cvChange.replace(storage, picked.filePaths[0], path.basename(picked.filePaths[0])).name;
    syncCv();  // this version to the Profile in Notion too
    return name;
  });
  // After setup, a replaced CV: its effects (Strategy → "What changes with this CV"). See lib/cv-change.js.
  ipcMain.handle('cvChange', () => ({...(storage.settings().cvChange || {}), name: storage.settings().cvName,
    comparable: fs.existsSync(storage.path(cvChange.PREVIOUS)), base: !!cvlib.baseCv(storage)}));
  ipcMain.handle('cvReview', async () => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    try { return {ok: true, ...await cvChange.review(storage, storage.secret('ANTHROPIC_API_KEY'), {client: claudeCode.client(storage)})}; }
    catch (error) { return {ok: false, error: error.message}; }
  });
  handleImportant('cvApply', 'Saving your CV and strategy', async (_, accepted) => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    try { return {ok: true, ...await cvChange.apply(storage, accepted)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('cvChangeDone', () => { storage.saveSettings({cvChange: null}); return true; });
}
