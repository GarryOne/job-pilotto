// The search's level follows Goals → Target level, its one home (owner, 18 Oct 2026: "Goals only"): a Target level save, and a Strategy read that finds the two
// apart, write Search settings' level through the same edit as the lists (lib/strategy-edit.js). Guarded by test/goal-level.test.js.
import {searchLevel} from '../renderer/goal-kinds.js';

// goal: the Target level as saved; now: the search's level today ('' = any, null = not known: written). -> {changed, level}
export async function levelFollowsGoal(storage, goal, now, {editLists, deps} = {}) {
  const level = searchLevel(goal);
  if (now !== null && level === (now || '')) return {changed: false, level};
  await editLists(storage, {level: {set: level}}, deps);
  return {changed: true, level};
}
