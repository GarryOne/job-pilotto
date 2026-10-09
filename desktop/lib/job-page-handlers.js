// A job's page in the app (Jobs → a row → the side panel, renderer/pages/job-panel.js): the job's record, its sections (kit, prep, review,
// record, messages, description) and its events, from the active store through the engine (lib/store/engine.js), so it reads the same on
// every store. "Open in Notion" only when the store has pages to open (caps LINKS). Demo mode: demo/job-pages.json (fictional).
// Guarded by test/job-page-handlers.test.js.
import fs from 'node:fs';
import path from 'node:path';
import * as engine from './store/engine.js';
import * as store from './store/index.js';
import {KIT_SECTION, kitOf} from './store/extension-store.js';
import {jobFiles} from './store/files.js';

// {app, sections, kit, events, files, links} or {error}; app null when the job has no application yet (a match nobody acted on). files: the
// job's files as data: URLs (lib/store/files.js: screenshots of logged messages, a tailored CV), shown under Messages.
export async function jobPage(storage, url, {call = engine.call, links = false} = {}) {
  const app = await call(storage, 'applications', 'get', {url: String(url || '')});
  if (!app?.id) return {app: null, sections: {}, kit: null, events: [], files: [], links};
  const [sections, events, files] = await Promise.all([
    call(storage, 'applications', 'sections', {app_id: app.id}),
    call(storage, 'events', 'list', {app_id: app.id}),
    jobFiles(storage, app.id, {call}),
  ]);
  return {app, sections: sections || {}, kit: kitOf(sections?.[KIT_SECTION]), events: events || [], files, links};
}

export function registerJobPageHandlers({ipcMain, storage, DEMO, here, log, call = engine.call}) {
  ipcMain.handle('jobPage', async (_, url) => {
    if (DEMO) {
      const pages = JSON.parse(fs.readFileSync(path.join(here, 'demo', 'job-pages.json'), 'utf8'));
      const page = pages[url] || {app: null, sections: {}, events: []};
      return {...page, kit: kitOf(page.sections?.[KIT_SECTION]), links: false};
    }
    const started = Date.now();
    try {
      const links = store.openStore(storage).caps.has(store.LINKS);
      const page = await jobPage(storage, url, {call, links});
      log('jobs', 'job page read', {sections: Object.keys(page.sections).length, events: page.events.length, files: page.files.length, kit: !!page.kit, ms: Date.now() - started});
      return page;
    } catch (error) {
      log('jobs', 'job page not read', {error: error.message, ms: Date.now() - started});
      return {error: error.message};
    }
  });
}
