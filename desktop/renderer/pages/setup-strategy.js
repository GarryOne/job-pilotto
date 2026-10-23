// Setup step 3's cards: the Strategy page's own live block (Main goals, Locations, Job preferences, Advanced search settings) moved into the wizard while the
// draft is reviewed. It reads the AI's draft (renderer/draft-strategy.js) and every edit goes back into the draft through renderer/strategy-sink.js, so the
// setup has no second renderer of any field (owner, 24 Oct 2026: "literally the same cards"). hideCards puts the block back on the Strategy page.
// Guarded by test/setup-strategy.test.js.
import {draftAsStrategy} from '../draft-strategy.js';
import {applyGoal} from '../markdown-edit.js';
import {useDraft, useSaved} from '../strategy-sink.js';
import {$} from './core.js';
import {loadPreferences} from './job-preferences.js';
import {shared} from './shared.js';
import {strategyState} from './strategy-state.js';
import {renderCards} from './strategy-targets.js';

let returnTo = null;   // the Strategy page's panel the block came from
const reset = () => Object.assign(strategyState, {targetEdits: {}, typed: {}, goalEdits: {}, editing: ''});

// changed(fields): the draft fields that changed, kept on this Mac (strategy-review.js draftChanged).
function source(changed) {
  const refresh = () => { strategyState.lastStrategy = draftAsStrategy(shared.draft); renderCards(); };
  return {
    get: () => shared.draft,
    set(fields) { Object.assign(shared.draft, fields); changed(Object.keys(fields)); },
    // A goal is a line of the drafted Profile (markdown-edit.js applyGoal), which is also what Job preferences reads.
    setGoal(key, text) {
      shared.draft.goals = {...shared.draft.goals, [key]: text};
      shared.draft.profile_markdown = applyGoal(shared.draft.profile_markdown, key, text);
      changed(['goals', 'profile_markdown']);
      loadPreferences();
    },
    reload: refresh,
  };
}

export function showCards({changed}) {
  const live = $('strategy-live'), slot = $('setup-strategy-slot');
  if (!live || !slot) return;
  returnTo ||= live.parentNode;
  slot.append(live);
  $('strategy-locations-which').hidden = true;   // compares saved settings with the saved Profile: nothing to compare in a draft
  useDraft(source(changed));
  reset();
  strategyState.strategyShown = true;
  strategyState.lastStrategy = draftAsStrategy(shared.draft);
  renderCards();
  loadPreferences();
}

export function hideCards() {
  if (!returnTo) return;
  useSaved();
  returnTo.prepend($('strategy-live'));
  returnTo = null;
  reset();
  Object.assign(strategyState, {strategyShown: false, lastStrategy: null});   // the Strategy page reads the saved strategy again
}
