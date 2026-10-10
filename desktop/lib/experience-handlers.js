// The experience bank's IPC (Settings → Profile → Experience): what the window shows, adding another CV version, removing one, matching
// again after the main CV changed. The data and the AI match are lib/experience.js; guarded by test/experience.test.js.
import * as claudeCode from './claude-code.js';
import * as experience from './experience.js';
import fs from 'node:fs';
import path from 'node:path';
import {log as appLog} from './log.js';

// Demo mode (look-around, screenshots): a made-up bank, nothing read from disk.
const DEMO_VIEW = {main: {name: 'Ada Example', roles: 2, skills: 'AWS, Terraform'},
  sources: [{id: 'demo1', kind: 'cv', name: 'Data and ML CV', addedAt: '2026-10-08T09:00:00Z', stale: false, roles: 3, added: 2,
    onlyHere: [{company: 'Gamma', title: 'Data Engineer', period: '2018 – 2019'}]}],
  roles: [{company: 'Acme', title: 'Site Reliability Engineer', period: '2024 – Present', place: 'Zurich', bullets: [
    {text: 'Cut monitoring costs by **50%** with Datadog.', from: 'Main CV'}, {text: 'Built Spark pipelines for 2 TB of logs a day.', from: 'Data and ML CV'}]},
    {company: 'Beta', title: 'Developer', period: '2020 – 2023', place: 'Remote', bullets: [{text: 'Built APIs in Node.js.', from: 'Main CV'}]}],
  extraSkills: 'Python, Spark'};

export function registerExperienceHandlers({DEMO, dialog, getWindow, ipcMain, storage}) {
  const ai = () => ({apiKey: storage.secret('ANTHROPIC_API_KEY'), client: claudeCode.client(storage)});
  const noAi = () => { const {apiKey, client} = ai(); return !apiKey && !client; };
  ipcMain.handle('experienceGet', () => (DEMO ? DEMO_VIEW : experience.view(storage)));
  ipcMain.handle('experienceAddCv', async () => {
    if (noAi()) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    if (!experience.view(storage).main) return {ok: false, error: 'Read your main CV first (CV & details → Read my CV PDF): other versions are compared with it.'};
    const picked = await dialog.showOpenDialog(getWindow(), {title: 'Choose another version of your CV', filters: [{name: 'PDF', extensions: ['pdf']}], properties: ['openFile']});
    if (picked.canceled || !picked.filePaths[0]) return {ok: false, cancelled: true};
    try {
      const file = picked.filePaths[0];
      if (!fs.statSync(file).isFile()) return {ok: false, error: 'That is not a file.'};
      const source = await experience.addCv(storage, file, path.basename(file).replace(/\.pdf$/i, ''), ai());
      appLog('experience', 'CV version added', {id: source.id, roles: source.cv.jobs.length, matched: source.match.filter(m => m.mainJob >= 0).length,
        extraBullets: source.match.reduce((n, m) => n + m.newBullets.length, 0), usd: source.usd});
      return {ok: true, ...experience.view(storage)};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('experienceAddLinkedin', async () => {
    if (noAi()) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    if (!experience.view(storage).main) return {ok: false, error: 'Read your main CV first (CV & details → Read my CV PDF): LinkedIn is compared with it.'};
    const picked = await dialog.showOpenDialog(getWindow(), {title: 'Choose the .zip LinkedIn sent you', filters: [{name: 'ZIP', extensions: ['zip']}], properties: ['openFile']});
    if (picked.canceled || !picked.filePaths[0]) return {ok: false, cancelled: true};
    try {
      const source = await experience.addLinkedin(storage, picked.filePaths[0], ai());
      appLog('experience', 'LinkedIn export added', {id: source.id, roles: source.cv.jobs.reduce((n, j) => n + j.roles.length, 0), matched: source.match.filter(m => m.mainJob >= 0).length,
        extraBullets: source.match.reduce((n, m) => n + m.newBullets.length, 0), skills: source.cv.skills ? source.cv.skills.split(',').length : 0, usd: source.usd});
      return {ok: true, ...experience.view(storage)};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('experienceRemove', (_, id) => {
    const ok = experience.remove(storage, id);
    if (ok) appLog('experience', 'source removed', {id: String(id)});
    return {ok, ...experience.view(storage)};
  });
  ipcMain.handle('experienceRematch', async () => {
    if (noAi()) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try { const done = await experience.rematchStale(storage, ai()); appLog('experience', 'matched again', {sources: done}); return {ok: true, ...experience.view(storage)}; }
    catch (error) { return {ok: false, error: error.message}; }
  });
}
