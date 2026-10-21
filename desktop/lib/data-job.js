// One export, import or backup at a time (Settings → Move your data): tells the window how far it is ('dataProgress' {kind, done, total, state}) and lets it cancel.
// The work itself runs beside the app (lib/archive.js); this only holds the one-at-a-time rule, the cancel signal and the event. Guard: desktop/test/data-job.test.js.
import {CANCELLED} from './archive.js';

export function createDataJob({toWindow, backupWith, appLog = () => {}}) {
  let current = null;   // {kind, controller}
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
    // work({onProgress, signal}) -> its result; a second job while one runs is refused, not queued.
    async run(kind, work) {
      if (current) throw new Error(`An ${current.kind} is already running; wait for it to finish.`);
      const controller = new AbortController();
      current = {kind, controller};
      tell(kind, {state: 'running', done: 0, total: null});
      try {
        const result = await work({onProgress: ({done, total}) => tell(kind, {state: 'running', done, total}), signal: controller.signal});
        tell(kind, {state: 'done'});
        return result;
      } catch (error) {
        tell(kind, {state: error.code === CANCELLED ? 'cancelled' : 'failed'});
        throw error;
      } finally { current = null; }
    },
  };
  return {dataJob: job, backupNow};
}
