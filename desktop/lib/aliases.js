// The app's side of the label meanings (site/src/aliases.js; format extension/alias-schema.js; plan in Notion "Knowledge as data"). The
// extension asks the app, the app asks the site (with the same install token as the recipes), remembers the answer for a few hours and
// passes on only what the shared schema accepts. Off with the Technical reports switch: nothing is asked, the built-in patterns work alone.
import {validateBundle} from '../shared/alias-schema.js';
import {installId} from './app-feedback.js';
import {log} from './log.js';
import {SITE, token} from './recipes.js';

const CACHE = 'aliases-cache.json';
const TTL_MS = 6 * 3600 * 1000;
const enabled = storage => storage.settings().telemetry !== false;

// -> [{key, phrase}] for this install. Never throws: no meanings is a normal answer.
export async function lookup(storage, {fetcher = globalThis.fetch, base = SITE, now = Date.now()} = {}) {
  if (!enabled(storage)) return [];
  let kept = null;
  try { kept = JSON.parse(storage.readText(CACHE) || 'null'); } catch { kept = null; }
  if (kept && now - kept.at < TTL_MS && Array.isArray(kept.aliases)) return kept.aliases;
  try {
    const id = installId(storage);
    const ask = async bearer => fetcher(`${base}/api/packs/aliases`, {headers: {Authorization: `Bearer ${bearer}`, 'X-Install-Id': id}});
    let response = await ask(await token(storage, fetcher, base));
    if (response.status === 401) { storage.saveSettings({recipesToken: null}); response = await ask(await token(storage, fetcher, base)); }
    if (!response.ok) throw new Error(`aliases ${response.status}`);
    const aliases = validateBundle((await response.json()).aliases).map(({key, phrase}) => ({key, phrase}));
    storage.writeText(CACHE, JSON.stringify({at: now, aliases}));
    return aliases;
  } catch (error) {
    log('aliases', `not asked: ${error.message}`);   // offline or the site down: the built-in patterns work alone
    return kept?.aliases || [];
  }
}
