// The Profile's CV gaps over IPC (owner, 17 Oct 2026, review M7): opening Experience splits the paragraph once into one line per gap (lib/gaps-move.js, copy and backup first) and says so,
// with Undo. Registered by lib/contact-handlers.js. Guarded by test/gaps-move.test.js and test/ipc.test.js.
import * as gaps from './gaps-move.js';
import {claudeAi} from './question-ai.js';

export function registerGapsHandlers({ipcMain, storage, DEMO, connected, needsNotion, log, ai = () => claudeAi(storage), copy}) {
  const tidied = () => { const done = storage.settings().gapsTidy; return done && !done.undone ? {changed: done.changed, at: done.at} : null; };
  ipcMain.handle('moveCvGaps', async () => {
    if (DEMO || !connected()) return {ok: true, changed: 0, tidied: null};
    try {
      const moved = await gaps.migrate(storage, {ai: ai(), ...(copy ? {copy} : {})});
      if (moved.changed) log('profile', 'CV gaps split into lines', {changed: moved.changed});   // a count, never a value
      return {ok: true, changed: moved.changed, tidied: tidied()};
    } catch (error) {
      log('profile', 'the CV gaps move stopped', {error: error.message});
      return {ok: false, error: error.message, changed: 0, tidied: tidied()};
    }
  });
  ipcMain.handle('undoCvGaps', async () => {
    if (DEMO) return {ok: true};
    return needsNotion('profile') || gaps.undo(storage).catch(error => ({ok: false, error: error.message}));
  });
}
