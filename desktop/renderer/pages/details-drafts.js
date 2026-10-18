// Your details' drafts on the Profile page's one save bar (pages/profile-save-bar.js; owner, 18 Oct 2026, UI redesign D2): Contact with its links (one saved
// record, lib/contact.js) and the fact sections (Work eligibility, Availability & compensation, Languages: one save, lib/profile-sections.js). Each counts the
// fields that differ from what was last read or saved, so the bar says how many and a refresh never draws over them. A live section (LIVE_KEYS: Languages, the
// live-cards pilot, owner 18 Oct 2026) is never a draft: each change saves that section alone (live-save.js); the bar counts it only when a save failed.
// Guarded by test/details-drafts.test.js and test/live-save.test.js.
import {profileBar} from './profile-save-bar.js';
import {liveSaver} from '../live-save.js';
import {factsNow, showFacts} from './details-facts.js';
import {clearProposals} from './contact-proposals.js';
import {contactNow, countContact, countFacts} from '../details-count.js';

export {contactNow, countContact, countFacts};

export const LIVE_KEYS = ['languages'];
const drafted = facts => Object.fromEntries(Object.entries(facts).filter(([key]) => !LIVE_KEYS.includes(key)));
let savedContact = {}, savedFacts = {};
let contact = null, facts = null;
// The read views and Done buttons (pages/details-read.js) follow these: 'details-changed' after a read or an edit, 'details-settled' after a save or a discard.
const tell = name => globalThis.document?.dispatchEvent?.(new Event(name));
// What is on screen right after a read or a save: the drafts count from here.
export function contactRead() { savedContact = contactNow(); contact?.changed(); tell('details-changed'); }
export function factsRead() { savedFacts = factsNow(); facts?.changed(); tell('details-changed'); }
export const contactDirty = () => countContact(savedContact, contactNow()) > 0;
export const factsDirty = () => countFacts(drafted(savedFacts), drafted(factsNow())) > 0 || Boolean(live?.pending());
// One card's own changes (its Done shows only at 0): Contact's or Links' fields, one fact section.
export const contactChangedIn = keys => { const now = contactNow(); return countContact(savedContact, Object.fromEntries(keys.filter(key => key in now).map(key => [key, now[key]]))); };
export const factsChangedIn = key => countFacts({[key]: savedFacts[key] || []}, {[key]: factsNow()[key] || []});
// Something was typed, picked, added or filled in from the CV.
export function detailsChanged() { contact?.changed(); facts?.changed(); tell('details-changed'); }

export function registerDetails({repaintContact}) {
  const bar = profileBar();
  contact = bar.register({id: 'details-contact', tab: 'details', label: 'Contact',
    count: () => countContact(savedContact, contactNow()),
    async save() {
      const now = contactNow();
      if (now.first_name && now.last_name) now.full_name = `${now.first_name} ${now.last_name}`;   // forms that ask for the full name get first + last
      const result = await window.pilot.saveContact(Object.fromEntries(Object.entries(now).filter(([, value]) => value)));
      if (result.ok) { clearProposals(); contactRead(); tell('details-settled'); }
      return result;
    },
    discard() { clearProposals(); savedContact = {}; repaintContact(); tell('details-settled'); },
    reveal: () => document.getElementById('setting-contact')?.scrollIntoView({block: 'start'}),
  });
  facts = bar.register({id: 'details-facts', tab: 'details', label: 'Eligibility, availability and languages',
    count: () => countFacts(drafted(savedFacts), drafted(factsNow())),
    async save() { const result = await window.pilot.saveDetailsFacts(drafted(factsNow())); if (result.ok) { factsRead(); tell('details-settled'); } return result; },
    discard() { savedFacts = {}; showFacts({redraw: true}).then(() => tell('details-settled')); },
    reveal: () => document.getElementById('setting-eligibility')?.scrollIntoView({block: 'start'}),
  });
}

// The live sections' one saver: a change saves those sections alone (the handler writes only the sections it is given), so the other cards' drafts stay drafts.
let live = null;
export function liveFacts() {
  live ||= liveSaver({bar: profileBar(), id: 'details-live', tab: 'details', label: 'Languages',
    async save() {
      const now = factsNow(), part = Object.fromEntries(LIVE_KEYS.map(key => [key, now[key] || []]));
      const result = await window.pilot.saveDetailsFacts(part);
      if (result?.ok) { Object.assign(savedFacts, part); tell('details-changed'); }
      return result;
    },
    onSaved: rows => rows.forEach(row => row.dispatchEvent?.(new Event('live-saved'))),
  });
  return live;
}
