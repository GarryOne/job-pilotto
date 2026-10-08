// Settings → Profile → Your details over IPC: read and save the 📇 Contact details (lib/contact.js), and the values Claude proposes
// for the empty ones from the CV (lib/contact-from-cv.js). Moved out of main.js (8 Oct 2026). Guarded by test/contact-from-cv.test.js.
import * as contactDetails from './contact.js';
import * as fromCv from './contact-from-cv.js';
import {keysFor} from './contact-keys.js';
import {pickOption} from './option-pick.js';
import {aiClient} from './confirmation.js';
import {hashOf} from './cv-check.js';

// Demo mode: fictional proposals, no AI (the screenshots of the Your details panel).
const DEMO_PROPOSALS = [{field: 'phone', value: '+44 20 7946 0000', sure: true}, {field: 'location', value: 'London', sure: true},
  {field: 'postal_code', value: 'SW1A 1AA', sure: true}, {field: 'salutation', value: 'Mr', sure: false}];

export function registerContactHandlers({ipcMain, storage, DEMO, connected, needsNotion, contactSaved, log}) {
  ipcMain.handle('contact', () => (DEMO || !connected() ? {} : contactDetails.read(storage)));
  ipcMain.handle('saveContact', (_, contact) => needsNotion('profile') || contactDetails.save(storage, contact).then(saved => { contactSaved(saved || contact); return {ok: true}; })
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // One detail confirmed on the session page ("Use" on a row): merged into the others, never replacing them.
  ipcMain.handle('saveContactField', async (_, key, value) => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    if (!contactDetails.LABELS[key] || !String(value || '').trim()) return {ok: false, error: 'Nothing to save'};
    try {
      const saved = await contactDetails.save(storage, {...await contactDetails.read(storage), [key]: String(value).trim()});
      contactSaved(saved);
      log('profile', 'a detail saved from the session page', {field: key});
      return {ok: true};
    } catch (error) { return {ok: false, error: `Notion: ${error.message}`}; }
  });
  // Which contact detail each form label asks for (Claude reads labels it hasn't seen; kept per label).
  ipcMain.handle('contactKeysFor', (_, labels) => (DEMO ? {} : keysFor(storage, Array.isArray(labels) ? labels.map(String) : [], {client: aiClient(storage), log})));
  // The form's own choice for an answer, when the field is a menu (lib/option-pick.js).
  ipcMain.handle('formChoiceFor', (_, ask) => (DEMO ? {choice: '', how: 'none'} : pickOption(storage, ask || {}, {client: aiClient(storage), log})));
  // {again}: read the CV anew (the button); otherwise what was proposed for this CV, or one Claude call when it was never read for this.
  ipcMain.handle('contactProposals', async (_, {again = false} = {}) => {
    if (DEMO) return {proposals: DEMO_PROPOSALS, fresh: false};
    if (!connected()) return {proposals: [], error: 'notion'};
    const contact = await contactDetails.read(storage).catch(() => null);
    if (!contact) return {proposals: [], error: 'Couldn\'t read your details from Notion'};
    return fromCv.forCv(storage, {contact, client: aiClient(storage), cvHash: hashOf(storage), again, log});
  });
}
