// Employers & Sources (renderer/pages/employers.js): every employer and job board the person tracks, from the active store through the
// engine (lib/store/engine.js: stores.employers, the fields in src/stores/base.py EMPLOYER_FIELDS), so it reads the same on every store.
// Active on/off is the one write: employers.upsert({name, active}), the same call Find employers makes. Demo mode: demo/employers.json
// (fictional). Guarded by test/employers-handlers.test.js.
import fs from 'node:fs';
import path from 'node:path';
import * as engine from './store/engine.js';

// Every employer, active or not (list(active=None)), sorted by name.
export async function employers(storage, {call = engine.call} = {}) {
  const rows = await call(storage, 'employers', 'list', {active: null});
  return (rows || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, {sensitivity: 'base'}));
}

export async function setActive(storage, name, active, {call = engine.call} = {}) {
  if (!String(name || '').trim()) throw new Error('No employer named');
  return call(storage, 'employers', 'upsert', {employer: {name: String(name), active: !!active}});
}

export function registerEmployersHandlers({ipcMain, storage, DEMO, here, log, call = engine.call}) {
  const demo = () => JSON.parse(fs.readFileSync(path.join(here, 'demo', 'employers.json'), 'utf8'));
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
