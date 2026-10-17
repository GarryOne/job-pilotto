// Strategy's chip lists over IPC (owner, 17 Oct 2026: "One chip per meaning", "Did you mean…"): listMeanings reads the lists once with the AI
// (lib/list-meanings.js, cached by their contents); keepTypo remembers an entry the person kept as written, so it is not flagged again.
// Registered by lib/search-tuning-handlers.js. Guarded by test/list-meanings.test.js.
import {meaningsFor} from './list-meanings.js';
import {claudeAi} from './question-ai.js';

export function registerListMeaningsHandlers({ipcMain, storage, DEMO, log, ai: aiFor = claudeAi}) {
  ipcMain.handle('listMeanings', async (_, lists) => {
    const kept = storage.settings().keptTypos || [];
    if (DEMO) return {ok: true, meanings: storage.settings().demoListMeanings || {}, kept};
    try {
      return {ok: true, ...(await meaningsFor(storage, lists && typeof lists === 'object' ? lists : {}, aiFor(storage))), kept};
    } catch (error) { log('strategy', 'list meanings not read', {error: error.message}); return {ok: false, meanings: {}, kept}; }
  });
  ipcMain.handle('keepTypo', async (_, entry) => {
    const kept = new Set(storage.settings().keptTypos || []);
    kept.add(String(entry || '').slice(0, 120));
    storage.saveSettings({keptTypos: [...kept]});
    return {ok: true};
  });
}
