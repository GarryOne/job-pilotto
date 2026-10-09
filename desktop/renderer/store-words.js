// Where the person's data is kept, in the words the window says (lib/store: Notion, or Job Pilotto on this Mac). A page says
// "Saved to Notion 🎤 Interviews" only while Notion holds the data; with the data on this Mac the same sentence names Job Pilotto.
// Before the state is read it is Notion, as before 9 Oct 2026. Guarded by test/store-words.test.js (a ratchet on hard-coded "Notion").
import {shared} from './pages/shared.js';

export const inNotion = () => (shared.state?.store?.caps || ['links']).includes('links');
// "Notion" or "Job Pilotto": where it is saved, read from or linked.
export const storeName = () => (inNotion() ? 'Notion' : 'Job Pilotto');
// One of two sentences: the Notion one, or the one for data on this Mac.
export const byStore = (notion, mac) => (inNotion() ? notion : mac);
