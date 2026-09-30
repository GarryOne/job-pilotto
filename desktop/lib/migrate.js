// One-time moves of user data from this Mac to Notion, the source of truth (the Mac keeps only keys, large
// files and caches). Each step runs at start-up while it has something to move, and only deletes the local
// copy after Notion confirmed it has the data, so nothing is ever lost. A failed step retries next start.
import * as contact from './contact.js';
import * as knowledge from './knowledge.js';
import * as notion from './notion.js';
import * as questions from './questions.js';
import * as schema from './schema.js';
import * as pipeline from './pipeline.js';
import * as strategy from './strategy.js';

export const STEPS = [
  // The daily applications target, first kept in the app's settings -> ⚙️ Search settings in Notion.
  {name: 'daily target', run: async storage => {
    const old = storage.settings().dailyTarget;
    if (old == null) return false;
    await strategy.setDailyTarget(storage, old, {run: pipeline.run, ensurePage: notion.ensurePage, writePage: notion.writePage});
    storage.saveSettings({dailyTarget: undefined});
    return true;
  }},
  // The workspace itself: columns and databases the code needs that it lacks (config/notion_schema.json).
  {name: 'workspace', run: async (storage, fetcher) => {
    const fixed = await schema.repair(storage.secret('NOTION_TOKEN'), storage.settings().notionIds || {}, schema.load(), fetcher);
    if (!fixed.created.length && !fixed.columns.length) return false;
    storage.saveSettings({notionIds: fixed.ids});
    return true;
  }},
  // "Reached via" on leads tracked before the column existed (from their Notes), once.
  {name: 'reached via', run: async storage => {
    if (storage.settings().reachedViaFilled) return false;
    const {code} = await pipeline.run(storage, ['src.ai.opportunity', 'backfill']);
    if (code !== 0) throw new Error('could not fill Reached via');
    storage.saveSettings({reachedViaFilled: true});
    return true;
  }},
  // Profile and standard answers: Notion pages since setup; the local copies are leftovers.
  {name: 'profile copies', run: async storage => {
    if (!storage.readText('profile.md') && !storage.readText('answers.md')) return false;
    const {profile, answers} = await strategy.profileTexts(storage);
    if (!profile.trim() || (storage.readText('answers.md') && !answers.trim())) return false;  // Notion looks empty: keep them
    strategy.dropLocalCopies(storage);
    return true;
  }},
  // Search settings -> a readable ⚙️ Search settings page (the local files stay, as its cache).
  {name: 'search settings', run: async storage => {
    if (storage.settings().notionIds?.NOTION_SEARCH_SETTINGS_PAGE) return false;
    return !!await strategy.publishSearchSettings(storage, {run: pipeline.run, ensurePage: notion.ensurePage, writePage: notion.writePage});
  }},
  // A Search settings page in the first format (plain entry = whole word) -> the exact format; untouched
  // pages are rebuilt from the cache (same meaning as before), edits are kept (src/notion/search_settings.py).
  {name: 'search settings format', run: async storage => {
    const page = storage.settings().notionIds?.NOTION_SEARCH_SETTINGS_PAGE;
    if (!page) return false;
    const {code, stdout} = await pipeline.run(storage, ['src.notion.search_settings', 'upgrade']);
    if (code !== 0) throw new Error('could not read the Search settings page');
    if (!stdout.trim()) return false;
    await notion.writePage(storage.secret('NOTION_TOKEN'), page, stdout);
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

// Once, at the first start of the version whose default is "no own scout": an install that is already set up keeps
// its daily scout (written down, so it stays whatever the default is); a new install starts without one.
export function pinScoutSchedule(storage) {
  const settings = storage.settings();
  if (settings.scoutDefaultPinned) return false;
  const keep = !!settings.setupDone && settings.schedule?.scout == null;
  storage.saveSettings({scoutDefaultPinned: true, ...(keep ? {schedule: {...(settings.schedule || {}), scout: 'daily'}} : {})});
  return keep;
}

// Once: "Help the pool grow" is on by default for NEW installs; an install already set up before it existed never saw the
// option and was told nothing goes up, so it starts off and stays the user's choice.
export function pinPoolShare(storage) {
  const settings = storage.settings();
  if (settings.poolShareDefaultPinned) return false;
  const keepOff = !!settings.setupDone && settings.shareEmployers == null;
  storage.saveSettings({poolShareDefaultPinned: true, ...(keepOff ? {shareEmployers: false} : {})});
  return keepOff;
}

export async function run(storage, onLine = () => {}, steps = STEPS, fetcher) {
  pinScoutSchedule(storage);
  pinPoolShare(storage);
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
