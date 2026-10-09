// Form-fill history (Reports → Form fills, renderer/pages/form-fills.js): past extension fills and Apply with Claude sessions from the
// active store's agent_runs (src/stores/base.py AGENT_RUN_FIELDS + AGENT_RUN_EXTRAS; fields.data and fields.timeline as the spec's
// "Agent run shapes"). The conversation (`transcript`) stays out: it is large and the session page shows it. Demo mode: demo/form-fills.json
// (fictional). Guarded by test/form-fills-handlers.test.js.
import fs from 'node:fs';
import path from 'node:path';
import * as engine from './store/engine.js';

const LIMIT = 200;
const slim = run => { if (!run) return null; const {transcript, ...rest} = run; return {...rest, has_transcript: !!transcript}; };

export async function formFills(storage, {call = engine.call, limit = LIMIT} = {}) {
  return ((await call(storage, 'agent_runs', 'list', {limit})) || []).map(slim);
}

export async function formFill(storage, id, {call = engine.call} = {}) {
  return slim(await call(storage, 'agent_runs', 'get', {run_id: String(id || '')}));
}

export function registerFormFillsHandlers({ipcMain, storage, DEMO, here, log, call = engine.call}) {
  const demo = () => JSON.parse(fs.readFileSync(path.join(here, 'demo', 'form-fills.json'), 'utf8')).map(slim);
  ipcMain.handle('formFills', async () => {
    if (DEMO) return {runs: demo()};
    const started = Date.now();
    try {
      const runs = await formFills(storage, {call});
      log('reports', 'form fills read', {count: runs.length, ms: Date.now() - started});
      return {runs};
    } catch (error) {
      log('reports', 'form fills not read', {error: error.message, ms: Date.now() - started});
      return {error: error.message};
    }
  });
  ipcMain.handle('formFill', async (_, id) => {
    if (DEMO) return {run: demo().find(run => run.id === id) || null};
    try {
      return {run: await formFill(storage, id, {call})};
    } catch (error) {
      log('reports', 'form fill not read', {error: error.message});
      return {error: error.message};
    }
  });
}
