// The extension's routes with the data on this Mac (worker/src/extension.js env.store): the tracked job for a form, its kit and the fill
// run's record, from the engine's store (lib/store/engine.js) instead of Notion. The values are the shared worker's own (runRecord), so a
// fill logs the same thing in either store. Guarded by test/extension-store.test.js.
import * as engine from './engine.js';
import {jobKey, runRecord} from '../../shared/worker/extension.js';
import {KIT_SECTION, kitOf} from './kit-section.js';
import {JOB_ANSWERS_SECTION, jobAnswersOf} from '../../shared/worker/job-answers.js';

export {KIT_SECTION, kitOf};   // their home is ./kit-section.js (a leaf module)

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
    // What the person answered for this job only (lib/job-answers.js): the fill's ask reads it for this job's form and no other.
    jobAnswers: async id => jobAnswersOf(await store('applications', 'section', {app_id: id, name: JOB_ANSWERS_SECTION})),
    async logRun(run) {
      const job = await findJob(run.url).catch(() => null);
      const made = await store('agent_runs', 'add', {run: runRecord(run, job || {})});
      return {ok: true, id: made?.id || null};
    },
    // The same run's row corrected (the record after a late retype): what changed is what a fill's end says; the row's own job, company and start stay (agent_runs.update replaces
    // the `fields` column, so the row's own values are read and kept). A row that is gone is no update, never a new row.
    async updateRun(run) {
      const id = String(run.update), was = await store('agent_runs', 'get', {run_id: id});
      if (!was) return {ok: false, skipped: true};
      const {outcome, learnings, fields} = runRecord(run, {});
      const changed = Object.fromEntries(Object.entries(fields).filter(([key]) => !['job', 'company', 'started'].includes(key)));   // the row keeps its own
      await store('agent_runs', 'update', {run_id: id, fields: {outcome, learnings, fields: {...(was.fields || {}), ...changed}}});
      return {ok: true, id};
    },
  };
}
