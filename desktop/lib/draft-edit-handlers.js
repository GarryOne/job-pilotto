// The setup's drafted strategy edited through the Strategy page's own cards: the same list edits (lib/strategy-edit.js) and the same Profile block
// edits (lib/text-outline-handlers.js) the saved strategy gets, applied to the draft in memory and handed back. Nothing is written to the store, Notion
// or disk here; the window keeps the draft (cacheDraftEdits). Guarded by test/draft-edit.test.js.
import {applyEdits as applyBlocks, MAX_CHANGES} from './text-outline-handlers.js';
import * as md from './store/markdown-page.js';
import {applyEdits, cleanEdits} from './strategy-edit.js';

// {search, preferences} of a draft with the card edits applied ({list: {add, remove}}, remote, relocation, level, minScore).
export function editDraftLists(draft, asked) {
  const edits = cleanEdits(asked);
  if (!Object.keys(edits).length) return {search: draft.search, preferences: draft.preferences, changed: []};
  const next = applyEdits({search: draft.search || {}, preferences: draft.preferences || {}}, edits);
  return {...next, changed: Object.keys(edits)};
}

// A Profile text held in a variable, with the page API text-outline-handlers.js applyEdits drives.
export function memoryPage(markdown) {
  let text = String(markdown || '');
  const edit = change => { text = change(text); };
  return {
    read: () => text,
    outline: async () => md.outline(text),
    setText: async (block, value) => edit(current => md.setText(current, block, value)),
    remove: async block => edit(current => md.remove(current, block)),
    append: async values => { if (values.length) edit(current => md.append(current, values)); },
    insertAfter: async (blockId, values) => edit(current => md.insertAfter(current, blockId, values)),
    async appendHeading(value) { const [next, id] = md.appendHeading(text, value); text = next; return id; },
    setCell: async (row, index, value) => edit(current => md.setCell(current, row, index, value)),
  };
}
export async function editDraftText(markdown, changes) {
  const page = memoryPage(markdown);
  const {saved, missing} = await applyBlocks(page, await page.outline(), changes);
  return {markdown: page.read(), saved, missing};
}

export function registerDraftEditHandlers({ipcMain}) {
  ipcMain.handle('draftEditLists', (_, draft, edits) => {
    try { return {ok: true, ...editDraftLists(draft || {}, edits)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('draftTextOutline', async (_, markdown) => ({ok: true, items: md.outline(String(markdown || '')), store: 'draft', link: null}));
  ipcMain.handle('draftTextEdit', async (_, markdown, changes) => {
    if (!Array.isArray(changes) || !changes.length || changes.length > MAX_CHANGES) return {ok: false, error: 'Nothing to save.'};
    try {
      const done = await editDraftText(markdown, changes);
      return {ok: !done.missing.length, ...(done.missing.length ? {error: 'Some lines changed meanwhile. The card shows the draft as it is now.'} : {}), markdown: done.markdown,
        items: md.outline(done.markdown), store: 'draft', link: null, saved: done.saved};
    } catch (error) { return {ok: false, error: `Not changed: ${error.message}`}; }
  });
}
