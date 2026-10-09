// The extension's routes with the data on this Mac (worker/src/extension.js env.store): the tracked job for a form, its kit and the fill
// run's record, from the engine's store (lib/store/engine.js) instead of Notion. The values are the shared worker's own (runRecord), so a
// fill logs the same thing in either store. Guarded by test/extension-store.test.js.
import * as engine from './engine.js';
import {jobKey, runRecord} from '../../shared/worker/extension.js';

export const KIT_SECTION = '📝 Application kit';   // src/stores base.KIT_SECTION: the section the kit is kept in, on every store
// The kit's JSON in its section (base.kit_from): the readable kit, then '### Machine-readable kit' and the kit as a ```json fence. The LAST
// ```json fence is the kit (the whole fence body); null if there is none or it is not JSON.
export function kitOf(markdown) {
  // A fence opens on a line that is exactly ```json (trailing spaces allowed) and closes on a ``` line; the kit is a JSON object.
  const fences = [...String(markdown || '').matchAll(/^```json[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm)];
  let kit = null;
  try { kit = fences.length ? JSON.parse(fences.at(-1)[1]) : null; } catch { return null; }
  return kit && typeof kit === 'object' && !Array.isArray(kit) ? kit : null;
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
