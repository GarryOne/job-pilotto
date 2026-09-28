// One-time moves of user data from this Mac to Notion, the source of truth (the Mac keeps only keys, large
// files and caches). Each step runs at start-up while it has something to move, and only deletes the local
// copy after Notion confirmed it has the data, so nothing is ever lost. A failed step retries next start.
import * as strategy from './strategy.js';

export const STEPS = [
  // Profile and standard answers: Notion pages since setup; the local copies are leftovers.
  {name: 'profile copies', run: async storage => {
    if (!storage.readText('profile.md') && !storage.readText('answers.md')) return false;
    const {profile, answers} = await strategy.profileTexts(storage);
    if (!profile.trim() || (storage.readText('answers.md') && !answers.trim())) return false;  // Notion looks empty: keep them
    strategy.dropLocalCopies(storage);
    return true;
  }},
];

export async function run(storage, onLine = () => {}, steps = STEPS) {
  const settings = storage.settings();
  if (!settings.setupDone || !storage.secret('NOTION_TOKEN') || !settings.notionIds?.NOTION_PROFILE_PAGE_ID) return [];
  const moved = [];
  for (const step of steps) {
    try {
      if (await step.run(storage)) moved.push(step.name);
    } catch (error) {
      onLine(`Moving ${step.name} to Notion failed (will retry next start): ${error.message}`);
    }
  }
  if (moved.length) onLine(`Moved to Notion: ${moved.join(', ')}.`);
  return moved;
}
