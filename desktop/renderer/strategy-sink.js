// Where the Strategy cards read and write: the saved strategy (window.pilot, the Strategy page) or, while setup step 3 draws the same cards, the AI's
// draft (pages/setup-strategy.js useDraft): the same edit code runs on the draft in memory (lib/draft-edit-handlers.js) and nothing is saved until
// "Replace my strategy". Every card writes through this, never window.pilot directly. Guarded by test/strategy-sink.test.js.
import {searchLevel} from './goal-kinds.js';

let draft = null;   // {get() → the draft, set(fields), setGoal(key, text), reload()} while the setup shows the cards
export const useDraft = source => { draft = source; };
export const useSaved = () => { draft = null; };
export const inDraft = () => !!draft;
export const reloadDraft = () => draft?.reload();

const failed = error => ({ok: false, error: error.message});
async function editDraftLists(edits) {
  const out = await window.pilot.draftEditLists(draft.get(), edits).catch(failed);
  if (!out.ok) return out;
  draft.set({search: out.search, preferences: out.preferences});
  return {ok: true, changed: out.changed};
}

export const sink = {
  // Lists and one-value settings (lib/strategy-edit.js cleanEdits).
  editTargets: edits => (draft ? editDraftLists(edits) : window.pilot.editTargets(edits)),
  // One goal: the Profile in the store, or the drafted Profile text; Target level is the search's level too (lib/goal-level.js).
  async editGoal(key, value) {
    if (!draft) return window.pilot.editGoal(key, value);
    draft.setGoal(key, value);
    return key === 'seniority' ? editDraftLists({level: {set: searchLevel(value)}}) : {ok: true};
  },
  // A Profile text as blocks and its edits (lib/text-outline-handlers.js): the draft's own text for the Profile while drafting.
  textOutline: name => (draft && name === 'profile' ? window.pilot.draftTextOutline(draft.get().profile_markdown).catch(failed) : window.pilot.textOutline(name)),
  async textEdit(name, changes) {
    if (!draft || name !== 'profile') return window.pilot.textEdit(name, changes);
    const out = await window.pilot.draftTextEdit(draft.get().profile_markdown, changes).catch(failed);
    if (typeof out.markdown === 'string') draft.set({profile_markdown: out.markdown});
    return out;
  },
};
