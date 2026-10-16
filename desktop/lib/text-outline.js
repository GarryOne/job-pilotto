// Settings → Profile's three texts (Profile, standard answers, Form knowledge) read as an outline and edited block by block, the same way on
// every store: IPC textOutline(name) → {ok, items, store, link}, textEdit(name, changes) → the same, fresh. A change names the block it read
// and the text it read there; it is applied only when a FRESH outline still has that block with that text (else nothing is lost: "changed
// meanwhile, reload"). Never a whole-page write, so a Notion page's other blocks (📎 CV file, embeds) are never touched. Spec:
// docs/superpowers/specs/2026-10-16-profile-tabs-mockups.md. Guarded by test/text-outline.test.js.
import * as store from './store/index.js';
import * as sqliteStore from './store/sqlite.js';

export const MAX_CHANGES = 200;
const oneLine = text => String(text ?? '').replace(/\s*\n\s*/g, ' ').trim().slice(0, 1900);
const lineNo = id => Number(String(id).replace(/^[LT]/, '')) || 0;

// Every block and table row of an outline by id (rows know their table; nested children too).
export function index(items) {
  const blocks = new Map(), rows = new Map();
  const walk = list => {
    for (const item of list || []) {
      if (item.type === 'table') { blocks.set(item.id, item); for (const row of item.rows || []) rows.set(row.id, {row, table: item}); }
      else { blocks.set(item.id, item); walk(item.children); }
    }
  };
  walk(items);
  return {blocks, rows};
}

// changes: [{op: 'cell', id, index, value, was} | {op: 'text', id, value, was} | {op: 'remove', id, was} | {op: 'insert', after, lines}
// | {op: 'append', lines}] → {saved, missing: [ids]}. In-place edits first, then the ones that move lines, last line first (this Mac's ids are
// line numbers: an earlier insert or removal would move the later ones), then appends.
export async function applyEdits(page, items, changes) {
  const {blocks, rows} = index(items);
  let saved = 0;
  const missing = [];
  const inPlace = changes.filter(c => c.op === 'cell' || c.op === 'text');
  const moving = changes.filter(c => c.op === 'remove' || c.op === 'insert').sort((a, b) => lineNo(b.id ?? b.after) - lineNo(a.id ?? a.after));
  for (const change of [...inPlace, ...moving]) {
    const value = oneLine(change.value);
    if (change.op === 'cell') {
      const found = rows.get(change.id), index = Number(change.index);
      if (!found || !(index >= 0 && index < found.row.cells.length) || (change.was !== undefined && found.row.cells[index] !== change.was)) { missing.push(String(change.id)); continue; }
      await page.setCell(found.row, index, value);
    } else if (change.op === 'text' || change.op === 'remove') {
      const block = blocks.get(change.id);
      if (!block || block.type === 'table' || (change.was !== undefined && block.text !== change.was)) { missing.push(String(change.id)); continue; }
      if (change.op === 'text') await page.setText(block, value); else await page.remove(block);
    } else {
      const lines = (change.lines || []).map(oneLine).filter(Boolean);
      if (!lines.length) continue;
      if (!blocks.has(change.after)) { missing.push(String(change.after)); continue; }
      await page.insertAfter(change.after, lines);
    }
    saved++;
  }
  const appended = changes.filter(c => c.op === 'append').flatMap(c => (c.lines || []).map(oneLine)).filter(Boolean);
  if (appended.length) { await page.append(appended); saved += appended.length; }
  return {saved, missing};
}

const known = name => store.TEXTS.includes(String(name));

export function registerTextOutlineHandlers({ipcMain, storage, DEMO, log, open = store.openStore}) {
  // Demo (look-around, screenshots): the demo folder's own files, through this Mac's adapter, whatever store the demo says it uses.
  const opened = () => (DEMO ? sqliteStore.open(storage) : open(storage));
  const shape = async (it, name) => ({ok: true, items: await it.page(name).outline(), store: it.label, link: it.textLink?.(name) || null});
  ipcMain.handle('textOutline', async (_, name) => {
    if (!known(name)) return {ok: false, error: `No text called ${name}`};
    try { return await shape(opened(), name); } catch (error) {
      log('store', 'text outline not read', {name: String(name), error: error.message});
      return {ok: false, error: error.message};
    }
  });
  ipcMain.handle('textEdit', async (_, name, changes) => {
    if (!known(name)) return {ok: false, error: `No text called ${name}`};
    if (!Array.isArray(changes) || !changes.length || changes.length > MAX_CHANGES) return {ok: false, error: 'Nothing to save.'};
    try {
      const it = opened(), page = it.page(name);
      const {saved, missing} = await applyEdits(page, await page.outline(), changes);
      log('store', 'text edited', {name: String(name), saved, missing: missing.length});   // how many, never what
      if (missing.length) return {...await shape(it, name), ok: false, error: `Some lines changed meanwhile (${saved} saved). The tab shows the page as it is now.`};
      return {...await shape(it, name), saved};
    } catch (error) {
      log('store', 'text not edited', {name: String(name), error: error.message});
      return {ok: false, error: `Not saved: ${error.message}`};
    }
  });
}
