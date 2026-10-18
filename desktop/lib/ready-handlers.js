// Ready to send, the window's calls (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): is this install the owner's (else why not: the card says it), what tonight would send, send it, start it now, the morning's rows, Done, the two numbers.
// Registered once from kit-handlers.js (main.js is at its size limit). Nothing here presses Submit or leaves data on the site beyond what ready-batch.js builds; the site deletes it on Done, after 24 h, or on Delete everything. Guard: test/ready-handlers.test.js.
import fs from 'node:fs';
import * as pipeline from './pipeline.js';
import {extensionStore} from './store/extension-store.js';
import {me} from './server-contact.js';
import * as viewCache from './view-cache.js';
import {buildBatch, pickToSend, withOwnAi} from './ready-batch.js';
import {settingsOf} from './ready.js';
import * as site from './ready-site.js';
import {waitingOf} from '../renderer/pages/ready-rows.js';

// What the AI may answer a form from: the same texts the normal Apply gives it (Profile, standard answers, search settings, the CV's facts).
async function facts(storage) {
  const [{profile = '', answers = ''} = {}, {configForPrompt}, {cvFactsOf}] = await Promise.all([
    import('./strategy.js').then(strategy => strategy.profileTexts(storage)).catch(() => ({})), import('./config-text.js'), import('./server-env.js')]);
  return {profile, standard: answers, search: await configForPrompt(storage, 'search.json'), cvFacts: cvFactsOf(storage), knowledge: ''};
}

export function registerReadyHandlers({ipcMain, notify = () => {}, shell, storage, deps = {}}) {
  const settings = () => settingsOf(storage.settings().ready);
  const jobs = async () => (await pipeline.jobs(storage)).jobs;
  const cached = () => viewCache.recall(storage, 'jobs')?.result?.jobs || [];   // the last good list: the card never waits for a job read to say "owner" and show the night's rows
  const tonightOf = (all, mine) => ({tonight: pickToSend(all, mine).map(job => ({code: job.code, title: job.title, company: job.company, fit: job.fit})), names: Object.fromEntries(all.map(job => [job.code, `${job.title} · ${job.company}`]))});
  const build = async list => buildBatch(list, {store: extensionStore(storage), me: url => me(storage, url), facts: () => facts(storage), ...deps});
  // A form you marked "I submitted it" on the page: your word, so the job becomes Applied here and its data is deleted from the server.
  const settleSubmitted = async (rows, all) => {
    for (const row of (rows.jobs || []).filter(each => each.submitted_at && !each.cleared_at)) {
      const job = all.find(each => each.code === row.job);
      if (job && job.status !== 'applied') await pipeline.setStatus(storage, job.url, 'applied').catch(() => null);
      await site.done(storage, row.job);
      row.cleared_at = row.submitted_at;
    }
  };
  // The morning line, once per night: how many forms are ready (the app's notification, and Telegram when that is how you chose to be told).
  const tellMorning = rows => {
    const waiting = waitingOf(rows.jobs || []), night = rows.batch?.night;
    if (!waiting || !night || storage.settings().ready?.told === night) return;
    storage.saveSettings({ready: {...settings(), told: night}});
    notify('Ready to send ✓', `${waiting.ready} form${waiting.ready === 1 ? '' : 's'} filled overnight${waiting.left ? `, ${waiting.left} need you` : ''}. Open Actions to press Submit.`, {view: 'actions'});
  };
  ipcMain.handle('readyState', async () => {
    if (process.env.JOB_PILOTTO_DEMO) { try { return JSON.parse(fs.readFileSync(storage.path('ready.json'), 'utf8')); } catch { return {owner: false}; } }   // the demo's fictional night (desktop/demo/ready.json)
    const rows = await site.status(storage);
    if (!rows.ok) return {owner: false, why: rows.why};   // the card shows this, its buttons off
    const mine = settings();
    if ((rows.jobs || []).some(each => each.submitted_at && !each.cleared_at)) await settleSubmitted(rows, await jobs());   // only then the list is read
    tellMorning(rows);
    return {owner: true, settings: mine, ...tonightOf(cached(), mine), site: rows};
  });
  // What tonight would send, from a fresh job read (joins one already running): the card asks after it has painted.
  ipcMain.handle('readyTonight', async () => { try { return {ok: true, ...tonightOf(await jobs(), settings())}; } catch { return {ok: false}; } });
  ipcMain.handle('readySend', async () => {
    const mine = settings(), {batch, skipped} = await build(pickToSend(await jobs(), mine));
    if (!batch.jobs.length) return {ok: false, error: 'No job has its kit, CV and cover letter ready yet.', skipped};
    const sent = await site.send(storage, withOwnAi(batch, storage.secret('ANTHROPIC_API_KEY')));
    return sent.ok ? {ok: true, queued: sent.queued, night: batch.night, skipped} : sent;
  });
  // The live view: the site gives a link for this form (10 minutes, only for you); your browser opens it, where you press Submit yourself.
  ipcMain.handle('readyLive', async (_, code) => {
    const made = await site.link(storage, String(code || ''));
    if (!made.ok) return made;
    await shell.openExternal(made.url);
    return {ok: true};
  });
  ipcMain.handle('readyRun', () => site.runNow(storage));
  ipcMain.handle('readyDone', (_, code) => site.done(storage, String(code || '')));
  ipcMain.handle('readyDeleteAll', () => site.deleteAll(storage));
  ipcMain.handle('readySettings', (_, patch) => { storage.saveSettings({ready: {...settings(), ...patch}}); return {ok: true, settings: settings()}; });
}
