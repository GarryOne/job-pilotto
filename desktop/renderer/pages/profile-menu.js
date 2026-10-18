// The Profile page's ⋯ menu (owner, 18 Oct 2026, UI redesign fix 10): the quiet home of "Fill empty details from my CV" and the page's one "View source in
// Notion", instead of orange links on the Contact card. The same two actions are in ⌘K (pages/nav.js). Guarded by test/profile-page.test.js.
import {moreButton} from '../components.js';
import {shared} from './shared.js';
import {openInNotion} from './notion-connect.js';
import {loadProposals} from './contact-proposals.js';

// The Fill result is said in the Contact card's own line; the values are drafts on the page bar, marked "From your CV", never saved by themselves.
export function fillFromCv(openTab) { openTab('details'); return loadProposals({again: true}); }
export function profileMenuItems(openTab) {
  const items = [{label: 'Fill empty details from my CV', run: () => fillFromCv(openTab)}];
  if (shared.state?.notion?.NOTION_PROFILE_PAGE_ID) items.push({label: 'View source in Notion', run: () => openInNotion('NOTION_PROFILE_PAGE_ID')});   // about Notion
  return items;
}
export function mountProfileMenu(slot, openTab) { slot?.replaceChildren(moreButton(() => profileMenuItems(openTab), 'More: fill from your CV, view the source')); }
