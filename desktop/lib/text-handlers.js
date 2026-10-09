// Settings → Profile: the user's whole texts (the Profile, standard answers, Form knowledge) read and edited in the app, through the store
// (renderer/pages/text-editors.js). Read: the engine's texts.get (the same Markdown on every store). Edit: the store's page.write, only on
// a store without pages to open (this Mac); on Notion the page stays the editor ("Edit in Notion"), because a whole-page write there
// would drop the blocks Markdown can't carry (the Profile's 📎 CV file, embeds; lib/notion-write.js patchPlan). Guarded by test/text-handlers.test.js.
import * as engine from './store/engine.js';
import * as store from './store/index.js';
import {TEXT_FILES} from './store/text-files.js';

export const MAX_CHARS = 200000;   // a text is a few pages; a paste of a whole book is refused, not saved half

const known = name => store.TEXTS.includes(String(name));

// {ok, markdown, editable} or {ok: false, error}
export async function readText(storage, name, {call = engine.call, open = store.openStore} = {}) {
  if (!known(name)) return {ok: false, error: `No text called ${name}`};
  const opened = open(storage);
  // Notion: the page's own text, its tables' rows included (the engine's Markdown of a page leaves tables out); shown, not edited here.
  if (opened.caps.has(store.LINKS)) return {ok: true, markdown: String(await opened.page(name).text() || ''), editable: false};
  return {ok: true, markdown: String(await call(storage, 'texts', 'get', {name}) || ''), editable: true};
}

export async function saveText(storage, name, markdown, {open = store.openStore} = {}) {
  if (!known(name)) return {ok: false, error: `No text called ${name}`};
  const opened = open(storage);
  if (opened.caps.has(store.LINKS)) return {ok: false, error: `Your ${name} is edited on its ${opened.label} page.`};
  const text = String(markdown ?? '');
  if (text.length > MAX_CHARS) return {ok: false, error: `Too long to save (${text.length} characters; at most ${MAX_CHARS}).`};
  await opened.page(name).write(text);
  return {ok: true};
}

export function registerTextHandlers({ipcMain, storage, DEMO, log, call = engine.call, open = store.openStore}) {
  ipcMain.handle('textGet', async (_, name) => {
    try {
      if (DEMO) return {ok: known(name), markdown: known(name) ? storage.readText(TEXT_FILES[name]) || '' : '', editable: !open(storage).caps.has(store.LINKS)};
      return await readText(storage, name, {call, open});
    } catch (error) {
      log('store', 'text not read', {name: String(name), error: error.message});
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('textSave', async (_, name, markdown) => {
    try {
      const saved = await saveText(storage, name, markdown, {open});
      // What was saved, never its words (lib/log.js).
      log('store', saved.ok ? 'text saved' : 'text not saved', {name: String(name), chars: String(markdown ?? '').length, ...(saved.ok ? {} : {error: saved.error})});
      return saved;
    } catch (error) {
      log('store', 'text not saved', {name: String(name), error: error.message});
      return {ok: false, error: error.message};
    }
  });
}
