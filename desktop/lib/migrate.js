// One-time moves of user data from this Mac to Notion, the source of truth (the Mac keeps only keys, large
// files and caches). Each step runs at start-up while it has something to move, and only deletes the local
// copy after Notion confirmed it has the data, so nothing is ever lost. A failed step retries next start.
import * as contact from './contact.js';
import * as knowledge from './knowledge.js';
import * as notion from './notion.js';
import * as questions from './questions.js';
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
  // Open questions -> ❓ lines of the standard answers page (skipping ones already there).
  {name: 'open questions', run: async (storage, fetcher) => {
    const open = storage.settings().openQuestions;
    if (!open?.length && !storage.settings().answeredQuestions) return false;
    const ids = storage.settings().notionIds || {};
    if (!ids.NOTION_ANSWERS_PAGE_ID) return false;
    const token = storage.secret('NOTION_TOKEN');
    const there = new Set((await notion.textBlocks(token, ids.NOTION_ANSWERS_PAGE_ID, fetcher))
      .map(block => questions.key(block.text.split(/:\s| — /)[0].replace(/❓/g, ''))));
    const missing = (open || []).filter(q => !there.has(q.key));
    if (missing.length) await notion.appendBullets(token, ids.NOTION_ANSWERS_PAGE_ID, missing.map(q => questions.questionLine(q.question, q.company)), fetcher);
    storage.saveSettings({openQuestions: undefined, answeredQuestions: undefined});
    return true;
  }},
  // Form knowledge -> the 🧠 Form knowledge page (a note already there, same site + field, is kept).
  {name: 'form knowledge', run: async (storage, fetcher) => {
    const local = storage.settings().formKnowledge;
    if (!local?.length) return false;
    const there = new Set((await knowledge.notes(storage, fetcher)).map(n => `${n.scope}|${n.field}`.toLowerCase()));
    const missing = local.filter(n => !there.has(`${n.scope}|${n.field}`.toLowerCase()));
    if (missing.length) await knowledge.add(storage, missing, fetcher);
    storage.saveSettings({formKnowledge: undefined});
    return true;
  }},
  // Contact details -> the 📇 Contact details section of the Profile page (what's already in Notion wins).
  {name: 'contact details', run: async (storage, fetcher) => {
    const local = storage.settings().contact;
    if (!local || !Object.keys(local).length) return false;
    const there = await contact.read(storage, fetcher);
    await contact.save(storage, {...local, ...there}, fetcher);
    storage.saveSettings({contact: undefined});
    return true;
  }},
];

export async function run(storage, onLine = () => {}, steps = STEPS, fetcher) {
  const settings = storage.settings();
  if (!settings.setupDone || !storage.secret('NOTION_TOKEN') || !settings.notionIds?.NOTION_PROFILE_PAGE_ID) return [];
  const moved = [];
  for (const step of steps) {
    try {
      if (await step.run(storage, fetcher)) moved.push(step.name);
    } catch (error) {
      onLine(`Moving ${step.name} to Notion failed (will retry next start): ${error.message}`);
    }
  }
  if (moved.length) onLine(`Moved to Notion: ${moved.join(', ')}.`);
  return moved;
}
