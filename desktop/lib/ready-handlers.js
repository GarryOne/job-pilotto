// Ready to send, the window's calls (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): is this install the owner's (the card shows only then), what tonight would send, send it, start it now, the morning's rows, Done, the two numbers.
// Registered once from kit-handlers.js (main.js is at its size limit). Nothing here presses Submit or leaves data on the site beyond what ready-batch.js builds; the site deletes it on Done, after 24 h, or on Delete everything. Guard: test/ready-handlers.test.js.
import fs from 'node:fs';
import * as pipeline from './pipeline.js';
import {extensionStore} from './store/extension-store.js';
import {me} from './server-contact.js';
import {buildBatch, pickToSend} from './ready-batch.js';
import {settingsOf} from './ready.js';
import * as site from './ready-site.js';

// What the AI may answer a form from: the same texts the normal Apply gives it (Profile, standard answers, search settings, the CV's facts).
async function facts(storage) {
  const [{profile = '', answers = ''} = {}, {configForPrompt}, {cvFactsOf}] = await Promise.all([
    import('./strategy.js').then(strategy => strategy.profileTexts(storage)).catch(() => ({})), import('./config-text.js'), import('./server-env.js')]);
  return {profile, standard: answers, search: await configForPrompt(storage, 'search.json'), cvFacts: cvFactsOf(storage), knowledge: ''};
}

export function registerReadyHandlers({ipcMain, storage, deps = {}}) {
  const settings = () => settingsOf(storage.settings().ready);
  const jobs = async () => (await pipeline.jobs(storage)).jobs;
  const build = async list => buildBatch(list, {store: extensionStore(storage), me: url => me(storage, url), facts: () => facts(storage), ...deps});
  ipcMain.handle('readyState', async () => {
    if (process.env.JOB_PILOTTO_DEMO) { try { return JSON.parse(fs.readFileSync(storage.path('ready.json'), 'utf8')); } catch { return {owner: false}; } }   // the demo's fictional night (desktop/demo/ready.json)
    if (!(await site.owner(storage))) return {owner: false};
    const mine = settings(), tonight = pickToSend(await jobs(), mine);
    return {owner: true, settings: mine, tonight: tonight.map(job => ({code: job.code, title: job.title, company: job.company, fit: job.fit})), site: await site.rows(storage)};
  });
  ipcMain.handle('readySend', async () => {
    const mine = settings(), {batch, skipped} = await build(pickToSend(await jobs(), mine));
    if (!batch.jobs.length) return {ok: false, error: 'No job has its kit, CV and cover letter ready yet.', skipped};
    const sent = await site.send(storage, batch);
    return sent.ok ? {ok: true, queued: sent.queued, night: batch.night, skipped} : sent;
  });
  ipcMain.handle('readyRun', () => site.runNow(storage));
  ipcMain.handle('readyDone', (_, code) => site.done(storage, String(code || '')));
  ipcMain.handle('readyDeleteAll', () => site.deleteAll(storage));
  ipcMain.handle('readySettings', (_, patch) => { storage.saveSettings({ready: {...settings(), ...patch}}); return {ok: true, settings: settings()}; });
}
