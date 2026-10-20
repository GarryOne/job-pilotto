// Employers & Sources (renderer/pages/employers.js): every employer and job board the person tracks, from the active store through the
// engine (lib/store/engine.js: stores.employers, the fields in src/stores/base.py EMPLOYER_FIELDS), so it reads the same on every store.
// Active on/off is the one write: employers.upsert({name, active}), the same call Find employers makes. Demo mode: demo/employers.json
// (fictional). Guarded by test/employers-handlers.test.js.
import fs from 'node:fs';
import * as engine from './store/engine.js';
import {demoPath} from './demo.js';

// Every employer, active or not (list(active=None)), sorted by name.
export async function employers(storage, {call = engine.call} = {}) {
  const rows = await call(storage, 'employers', 'list', {active: null});
  return (rows || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, {sensitivity: 'base'}));
}

export async function setActive(storage, name, active, {call = engine.call} = {}) {
  if (!String(name || '').trim()) throw new Error('No employer named');
  return call(storage, 'employers', 'upsert', {employer: {name: String(name), active: !!active}});
}

// Add from a page (Employers page, ⌘K): the pasted text (or one address) is kept in the data folder and the scout checks its companies first.
// Never a login page fetched by us: the person pastes what they see. Answers at once; the run shows in Recent activity.
export const PASTE_FILE = 'data/pasted-page.txt';
export const PASTE_MAX = 200000;
export function fromPage(storage, text, scoutFromPage) {
  const body = String(text || '').trim();
  if (!body) return {ok: false, error: 'Paste the page’s text or its address first.'};
  storage.writeText(PASTE_FILE, body.slice(0, PASTE_MAX));
  scoutFromPage(storage.path(PASTE_FILE)).catch(() => {});   // its own run record says how it ended
  return {ok: true, chars: Math.min(body.length, PASTE_MAX)};
}

export function registerEmployersHandlers({ipcMain, storage, DEMO, here, log, call = engine.call, scoutFromPage = async () => {}}) {
  const demo = () => JSON.parse(fs.readFileSync(demoPath(here, 'employers.json'), 'utf8'));
  ipcMain.handle('employers', async () => {
    if (DEMO) return {employers: demo()};
    const started = Date.now();
    try {
      const rows = await employers(storage, {call});
      log('employers', 'list read', {count: rows.length, active: rows.filter(row => row.active).length, ms: Date.now() - started});
      return {employers: rows};
    } catch (error) {
      log('employers', 'list not read', {error: error.message, ms: Date.now() - started});
      return {error: error.message};
    }
  });
  ipcMain.handle('employersFromPage', async (_, text) => {
    if (DEMO) return {ok: true, demo: true};
    const answer = fromPage(storage, text, scoutFromPage);
    log('employers', answer.ok ? 'page pasted' : 'page not pasted', answer.ok ? {chars: answer.chars} : {error: answer.error});
    return answer;
  });
  // Turned on or off by the person on the Employers page: the next job search reads (or skips) its feed.
  ipcMain.handle('employerActive', async (_, name, active) => {
    if (DEMO) return {ok: true, employer: {...demo().find(row => row.name === name), active: !!active}};
    try {
      const employer = await setActive(storage, name, active, {call});
      log('employers', 'active set', {id: employer?.id || '', active: !!active, by: 'person'});
      return {ok: true, employer};
    } catch (error) {
      log('employers', 'active not set', {error: error.message});
      return {ok: false, error: error.message};
    }
  });
}
