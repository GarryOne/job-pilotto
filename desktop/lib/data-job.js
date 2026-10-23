// One export, import or backup at a time (Settings → Move your data): tells the window how far it is ('dataProgress' {kind, done, total, state}) and lets it cancel.
// The work itself runs beside the app (lib/archive.js); this only holds the one-at-a-time rule, the cancel signal and the event. Guard: desktop/test/data-job.test.js.
import {CANCELLED, killAllTars} from './archive.js';
import * as critical from './critical.js';

// What the quit question calls each job (the same words as the Settings buttons' handlers).
const LABELS = {export: 'Exporting your data', import: 'Importing your data', backup: 'Backing up your data', clear: 'Clearing your job list'};

export function createDataJob({toWindow, backupWith, appLog = () => {}}) {
  let current = null;   // {kind, controller, finished}
  const tell = (kind, fields) => toWindow('dataProgress', {kind, ...fields});
  // The backup button and the weekly timer: the same job as an export, so only one runs and the window shows it. backupWith(options) -> {file, removed}.
  const backupNow = async (why = 'button') => {
    try {
      const done = await job.run('backup', options => backupWith(options));
      console.log(`Backup saved: ${done.file}`); appLog('data', 'backup saved', {file: done.file.split(/[\\/]/).pop(), decidedBy: why});
      return {ok: true, ...done};
    } catch (error) {
      console.error(`Backup failed: ${error.message}`); appLog('data', 'backup failed', {error: error.message, decidedBy: why});
      return {ok: false, error: error.message};
    }
  };
  const job = {
    running: () => current?.kind || null,
    cancel: () => { current?.controller.abort(); return !!current; },
    // Quitting: cancel the running job and wait until its tar is gone (at most `waitMs`, then every tar still alive is killed), so no archive step outlives the app.
    async stop(waitMs = 5000) {
      if (!current) return false;
      const {controller, finished} = current;
      controller.abort();
      let timer;
      await Promise.race([finished, new Promise(resolve => { timer = setTimeout(resolve, waitMs); })]);
      clearTimeout(timer);
      killAllTars();
      return true;
    },
    // work({onProgress, signal}) -> its result; a second job while one runs is refused, not queued.
    async run(kind, work) {
      if (current) throw new Error(`An ${current.kind} is already running; wait for it to finish.`);
      const controller = new AbortController();
      let finish;
      current = {kind, controller, finished: new Promise(resolve => { finish = resolve; })};
      tell(kind, {state: 'running', done: 0, total: null});
      try {
        // Listed as important work while it runs, so quitting asks (wait / stop and quit) for a backup or an import too, not only an export.
        const started = (() => { try { return Promise.resolve(work({onProgress: ({done, total}) => tell(kind, {state: 'running', done, total}), signal: controller.signal})); } catch (error) { return Promise.reject(error); } })();   // the work starts now, not a tick later
        const result = await critical.during(LABELS[kind] || `Running ${kind}`, () => started);
        tell(kind, {state: 'done'});
        return result;
      } catch (error) {
        tell(kind, {state: error.code === CANCELLED ? 'cancelled' : 'failed'});
        throw error;
      } finally { current = null; finish(); }
    },
  };
  return {dataJob: job, backupNow};
}
