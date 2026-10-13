// Settings → Profile → Preferences on a store whose page is the editor (Notion): read the page's outline as the form's sections, and save a
// change as ONE cell or ONE bullet (lib/profile-outline.js), never a whole-page write. The ids come from the window but the blocks are looked up
// again in a fresh outline and only inside the form's known sections, so nothing else on the page can be reached. Guarded by
// test/profile-outline.test.js.
import * as store from './store/index.js';
import {applyChanges, fromOutline} from './profile-outline.js';

export const MAX_CHANGES = 80;

// Demo mode (look-around, screenshots): a made-up Profile page, nothing read from or written to Notion.
const row = (id, ...cells) => ({id, type: 'table_row', cells});
export const DEMO_OUTLINE = [
  {id: 'd0', type: 'callout', text: 'The AI scorer reads this page at every run to judge how well each job fits. Fields marked ❓ are still open.'},
  {id: 'd1', type: 'heading_1', text: 'Hard constraints'},
  {id: 'd2', type: 'paragraph', text: 'Jobs that break these are filtered out before any AI scoring.'},
  {id: 'd3', type: 'table', header: true, rows: [row('r0', 'Constraint', 'Value'), row('r1', 'Countries', 'Switzerland (anywhere), plus Berlin, London, or remote roles'),
    row('r2', 'Home base', 'Zurich today; open to relocating'), row('r3', 'Work mode', 'On-site, hybrid or remote'), row('r4', 'Work permit / visa', 'EU citizen; no sponsorship needed in the EU'),
    row('r5', 'Languages I can work in', 'English (fluent), German (B1)'), row('r6', 'Minimum seniority', 'Senior'), row('r7', 'Workload', '❓ full-time or a percentage'),
    row('r8', 'Recruiter listings', '❓ allow, down-rank or exclude')]},
  {id: 'd4', type: 'heading_1', text: 'Compensation'},
  {id: 'd5', type: 'bulleted_list_item', text: 'Target: CHF 150k gross'},
  {id: 'd6', type: 'bulleted_list_item', text: 'Minimum acceptable: CHF 130k gross'},
  {id: 'd7', type: 'heading_1', text: 'Summary (from CV)'},
  {id: 'd8', type: 'paragraph', text: 'Site reliability engineer with 8 years of AWS, Kubernetes and observability.'},
];

export function registerProfileFormHandlers({ipcMain, storage, DEMO, log, open = store.openStore}) {
  const notionPage = () => {
    const opened = open(storage);
    return opened.caps.has(store.LINKS) ? opened.page('profile') : null;
  };
  ipcMain.handle('profileForm', async () => {
    try {
      if (DEMO) return {ok: true, ...fromOutline(DEMO_OUTLINE)};
      const page = notionPage();
      return page ? {ok: true, ...fromOutline(await page.outline())} : {ok: false};
    } catch (error) { log('store', 'profile form not read', {error: error.message}); return {ok: false, error: error.message}; }
  });
  ipcMain.handle('profileFormSave', async (_, changes) => {
    try {
      if (DEMO) return {ok: false, error: 'Not available in the demo.'};
      const page = notionPage();
      if (!page) return {ok: false, error: 'The Profile is edited on its page.'};
      if (!Array.isArray(changes) || !changes.length || changes.length > MAX_CHANGES) return {ok: false, error: 'Nothing to save.'};
      const items = await page.outline();
      const {saved, missing} = await applyChanges(page, items, changes);
      log('store', 'profile fields saved', {saved, missing: missing.length});   // how many, never what
      if (missing.length) return {ok: false, error: `Some rows changed on the page meanwhile (${saved} saved). Reload this tab and try again.`};
      return {ok: true, saved, ...fromOutline(await page.outline())};
    } catch (error) {
      log('store', 'profile fields not saved', {error: error.message});
      return {ok: false, error: `Not saved: ${error.message}`};
    }
  });
}
