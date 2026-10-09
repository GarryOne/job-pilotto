// Reports (renderer/pages/reports.js): the 💡 Insights history from the active store through the engine (insights.list), and the feedback a
// person gives an insight (Useful / Not useful / Acting on it), merged into its fields so the others stay. Demo mode: demo/reports.json,
// made by the engine's own writers (test/fixtures/report_insights.py). Guarded by test/reports-handlers.test.js.
import fs from 'node:fs';
import path from 'node:path';
import * as engine from './store/engine.js';

export const FEEDBACK = ['Useful', 'Not useful', 'Acting on it'];   // the Insights Feedback column's options (Telegram's buttons too)
export const DAYS = 120;   // the history the page reads: about four months

export async function insightsList(storage, {call = engine.call, now = Date.now()} = {}) {
  const since = new Date(now - DAYS * 86400000).toISOString().slice(0, 10);
  return (await call(storage, 'insights', 'list', {since})) || [];
}

export async function setFeedback(storage, id, value, {call = engine.call} = {}) {
  if (!FEEDBACK.includes(value)) return {ok: false, error: `Feedback is one of: ${FEEDBACK.join(', ')}`};
  const found = (await call(storage, 'insights', 'list', {}) || []).find(row => String(row.id) === String(id));
  if (!found) return {ok: false, error: 'That insight is gone.'};
  await call(storage, 'insights', 'update', {insight_id: found.id, fields: {fields: {...(found.fields || {}), feedback: value}}});
  return {ok: true};
}

export function registerReportsHandlers({ipcMain, storage, DEMO, here, log, call = engine.call}) {
  ipcMain.handle('reportsInsights', async () => {
    if (DEMO) return {ok: true, insights: JSON.parse(fs.readFileSync(path.join(here, 'demo', 'reports.json'), 'utf8'))};
    const started = Date.now();
    try {
      const insights = await insightsList(storage, {call});
      log('reports', 'insights read', {count: insights.length, ms: Date.now() - started});
      return {ok: true, insights};
    } catch (error) {
      log('reports', 'insights not read', {error: error.message});
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('insightFeedback', async (_, id, value) => {
    if (DEMO) return {ok: FEEDBACK.includes(value)};
    try {
      const done = await setFeedback(storage, id, value, {call});
      log('reports', done.ok ? 'insight feedback saved' : 'insight feedback refused', {value: String(value)});
      return done;
    } catch (error) {
      log('reports', 'insight feedback not saved', {error: error.message});
      return {ok: false, error: error.message};
    }
  });
}
