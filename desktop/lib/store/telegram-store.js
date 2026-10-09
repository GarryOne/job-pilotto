// The Telegram bot's lists and buttons with the data on this Mac (worker/src/index.js env.store): /saved, /applied, /status and an
// outcome tap, from the engine's store (lib/store/engine.js) as the plain items the bot's formatters read (worker/src/format.js appItem,
// runItem), so a message reads the same as with Notion. Guarded by test/telegram-store.test.js.
import * as engine from './engine.js';

const NOT_APPLIED = ['Saved', 'Kit ready', 'Dismissed', 'Closed'];   // /applied: real applications only (as the Notion query)
const LIMIT = 30;
const RUN_DAYS = 14;
const item = app => ({id: app.id, title: app.title || '', company: app.company || '', stage: app.stage || '', applied_on: app.applied_on || '',
  next_interview: app.next_interview || '', url: app.url || ''});
// Newest first by a date field; empty last (as Notion sorts).
const newest = key => (a, b) => String(b[key] || '').localeCompare(String(a[key] || ''));

export function telegramStore(storage, {call = engine.call, now = () => new Date()} = {}) {
  const store = (entity, method, kwargs) => call(storage, entity, method, kwargs);
  return {
    saved: async () => (await store('applications', 'list', {stages: ['Saved']})).sort(newest('created_at')).slice(0, LIMIT).map(item),
    applied: async () => (await store('applications', 'list', {})).filter(app => !NOT_APPLIED.includes(app.stage))
      .sort(newest('applied_on')).slice(0, LIMIT).map(item),
    async runs(n) {
      const since = new Date(now().getTime() - RUN_DAYS * 86400000).toISOString();
      return (await store('cron_runs', 'list', {since})).slice(0, n).map(run => ({link: '', mode: run.mode || run.kind || '', status: run.status || '',
        started: run.started_at || '', summary: run.summary || '',
        where: run.run_url ? 'github' : /^Mac/.test(run.trigger || '') || (!run.trigger && run.where === 'mac') ? 'mac' : ''}));
    },
    // Stage on the application plus one event: the history the learning reports read (as the bot's Notion recordOutcome).
    async recordOutcome(id, stage) {
      // A button carries the id without dashes (callback data is short): back to the store's own id.
      const bare = String(id).replace(/-/g, '');
      const appId = (await store('applications', 'list', {})).find(each => String(each.id).replace(/-/g, '') === bare)?.id || id;
      const app = await store('applications', 'update', {app_id: appId, fields: {stage}});
      await store('events', 'add', {app_id: appId, kind: stage, at: now().toISOString(), source: 'Telegram'});
      return app?.title || 'Application';
    },
    async insightFeedback() { throw new Error('Insight feedback is not kept on this Mac yet.'); },
  };
}
