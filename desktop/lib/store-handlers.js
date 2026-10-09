// Settings → Data & backup → "Your data": where the person's data lives (lib/store), choosing this Mac while trying, and
// "Move my data to Notion" (spec P4, lib/store-move.js). The window reads capabilities and a label, never an
// adapter's name. Guarded by test/store-handlers.test.js.
import * as notionGate from './notion-gate.js';
import * as store from './store/index.js';
import {moveToNotion} from './store-move.js';

// Whether a person may choose where the data lives (here: "Keep it on this Mac"). Off until the engine's store callers are done
// (spec P1/P2); mac-e4 flips it then. The e2e sets JOB_PILOTTO_STORE_CHOICE=1; the card's states render either way (shot --settings).
export const STORE_CHOICE = process.env.JOB_PILOTTO_STORE_CHOICE === '1';

// {label, caps, trying, choice}: what the card shows.
export function storeState(storage, {choice = STORE_CHOICE} = {}) {
  const opened = store.openStore(storage);
  return {label: opened.label, caps: [...opened.caps], trying: store.trying(storage), notionConnected: notionGate.connected(storage), choice};
}

export function registerStoreHandlers({ipcMain, storage, DEMO, log, choice = STORE_CHOICE, toWindow = () => {}, move = moveToNotion}) {
  ipcMain.handle('storeState', () => storeState(storage, {choice}));
  // Trying → this Mac: the one switch made by hand. Leaving a store is the move (one-way, spec D3/D4), never this.
  ipcMain.handle('keepOnThisMac', () => {
    if (!choice) return {ok: false, error: 'Choosing where your data lives is not available yet.'};
    if (DEMO) return {ok: true, store: storeState(storage, {choice})};
    if (!store.trying(storage)) return {ok: false, error: 'Your data already has a home: it can only move to Notion.'};
    storage.saveSettings({store: 'sqlite'});
    log('store', 'chosen', {store: 'sqlite', from: 'trying'});
    return {ok: true, store: storeState(storage, {choice})};
  });
  // "Move my data to Notion" (spec P4, lib/store-move.js): progress goes to the window as 'storeMoveProgress' {entity, done, total}.
  let moving = null;
  ipcMain.handle('moveToNotion', async () => {
    if (DEMO) return {ok: false, error: 'Demo mode: nothing moves.'};
    if (moving) return moving;   // one move at a time: a second press waits for the first
    moving = move(storage, {log, onProgress: progress => toWindow('storeMoveProgress', progress)})
      .then(result => (result.ok ? {...result, store: storeState(storage, {choice})} : result))
      .finally(() => { moving = null; });
    return moving;
  });
}
