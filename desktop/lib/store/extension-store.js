// The extension's routes with the data on this Mac (worker/src/extension.js env.store): the tracked job for a form, its kit and the fill
// run's record, from the engine's store (lib/store/engine.js) instead of Notion. The values are the shared worker's own (runRecord), so a
// fill logs the same thing in either store. Guarded by test/extension-store.test.js.
import * as engine from './engine.js';
import {jobKey, runRecord} from '../../shared/worker/extension.js';

export const KIT_SECTION = '📝 Application kit';   // src/ai/kit.py KIT_HEADING: the section the kit is kept in
// The kit's JSON in its section: a fenced block (```json … ```), as Notion keeps it in a code block.
export function kitOf(markdown) {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(String(markdown || ''))?.[1];
  try { return fenced ? JSON.parse(fenced) : null; } catch { return null; }
}

export function extensionStore(storage, {call = engine.call} = {}) {
  const store = (entity, method, kwargs) => call(storage, entity, method, kwargs);
  async function findJob(url) {
    let app = await store('applications', 'get', {url});
    const key = !app && jobKey(url);
    if (key) app = (await store('applications', 'list', {}) || []).find(each => String(each.url || '').includes(key)) || null;
    return app ? {id: app.id, title: app.title || '', company: app.company || '', stage: app.stage || '', url: app.url || '', notion_url: ''} : null;
  }
  return {
    findJob,
    kit: async id => kitOf(await store('applications', 'section', {app_id: id, name: KIT_SECTION})),
    async logRun(run) {
      const job = await findJob(run.url).catch(() => null);
      const made = await store('agent_runs', 'add', {run: runRecord(run, job || {})});
      return {ok: true, id: made?.id || null};
    },
  };
}
