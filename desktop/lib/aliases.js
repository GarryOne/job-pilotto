// The app's side of the label meanings (site/src/aliases.js; format extension/alias-schema.js; plan in Notion "Knowledge as data"). The
// extension asks the app, the app asks the site (with the same install token as the recipes), remembers the answer for a few hours and
// passes on only what the shared schema accepts. Off with the Technical reports switch: nothing is asked, the built-in patterns work alone.
import {cleanLabel, validateBundle} from '../shared/alias-schema.js';
import {installId} from './app-feedback.js';
import * as benchmarks from './benchmarks.js';
import {log} from './log.js';
import {SITE, token} from './recipes.js';

const CACHE = 'aliases-cache.json';
const TTL_MS = 6 * 3600 * 1000;
export const HINT_REASONS = ['seniority', 'location', 'tech', 'company', 'role'];
// Only a fixed reason word and its share are kept: the sentence the scorer reads is the engine's own template, never text from the site.
// The meanings pack's rows the site learned and the seed rows it switched off (site/src/meanings.js). Only the shape is checked here: the
// engine checks every row against config/meanings_schema.json and compiles its pattern before using it (src/ai/meanings_pack.py).
const short = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
export const cleanMeanings = pack => ({
  rows: (Array.isArray(pack?.rows) ? pack.rows : []).filter(row => short(row?.topic, 60) && ['pattern', 'exact'].includes(row.kind)
    && short(row.wording, row.kind === 'exact' ? 200 : 2000) && short(row.answer, 60)).slice(0, 5000)
    .map(({topic, kind, wording, answer, ord}) => ({topic, kind, wording, answer, ord: Number(ord) || 0})),
  off: (Array.isArray(pack?.off) ? pack.off : []).filter(item => Array.isArray(item) && item.length === 3 && item.every(part => short(part, 2000))).slice(0, 5000),
});
// What this install's AI said public wordings mean (src/ai/meanings_pack.py queue: public wordings only), sent once to the site, which
// learns a wording when 3+ installs agree (site/src/meanings.js). Logged by count only, never the wordings.
async function sendMeanings(storage, id, fetcher, base) {
  let rows = [];
  try { rows = JSON.parse(storage.readText('data/meanings_outbox.json') || '{}').rows || []; } catch { rows = []; }
  if (!rows.length) return;
  const response = await fetcher(`${base}/api/packs/aliases`, {method: 'POST', headers: {Authorization: `Bearer ${await token(storage, fetcher, base)}`,
    'X-Install-Id': id, 'Content-Type': 'application/json'}, body: JSON.stringify({meanings: rows.slice(0, 200)})});
  if (!response.ok) throw new Error(`meanings ${response.status}`);
  storage.writeText('data/meanings_outbox.json', JSON.stringify({rows: rows.slice(200)}));
  log('aliases', 'meanings sent', {count: Math.min(rows.length, 200)});
}

export const cleanHints = list => (Array.isArray(list) ? list : []).filter(item => HINT_REASONS.includes(item?.reason) && Number(item.share) > 0 && Number(item.share) <= 1)
  .slice(0, 3).map(item => ({reason: item.reason, share: Math.round(Number(item.share) * 100) / 100}));
const enabled = storage => storage.settings().telemetry !== false;

// What the extension fills by: the shared meanings, then what Claude decided on this Mac (lib/contact-keys.js) for wordings the pack
// doesn't have yet, so this Mac's next form fills them at once while they wait to be shared. Same schema check as the pack's.
export async function forExtension(storage, options = {}) {
  const shared = await lookup(storage, options);
  let local = {};
  try { local = JSON.parse(storage.readText('contact-label-keys.json') || '{}') || {}; } catch {}
  const mine = validateBundle(Object.entries(local).filter(([, key]) => key).map(([phrase, key]) => ({key, phrase: cleanLabel(phrase)})))
    .map(({key, phrase}) => ({key, phrase})).filter(item => !shared.some(other => other.phrase === item.phrase));
  return [...shared, ...mine];
}
// -> [{key, phrase}] for this install. Never throws: no meanings is a normal answer.
export async function lookup(storage, {fetcher = globalThis.fetch, base = SITE, now = Date.now(), onSent = null} = {}) {
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
    onSent?.('label meanings request → /api/packs/aliases', {install: id});
    const body = await response.json();
    const aliases = validateBundle(body.aliases).map(({key, phrase}) => ({key, phrase}));
    storage.writeText(CACHE, JSON.stringify({at: now, aliases}));
    benchmarks.save(storage, body.benchmarks, now);
    storage.writeText('data/hints.json', JSON.stringify({at: now, hints: cleanHints(body.hints)}));   // read by the scoring step (src/ai/hints.py)
    storage.writeText('data/meanings.json', JSON.stringify({at: now, ...cleanMeanings(body.meanings)}));   // read by src/ai/meanings_pack.py
    await sendMeanings(storage, id, fetcher, base).catch(error => log('aliases', `meanings not sent: ${error.message}`));
    return aliases;
  } catch (error) {
    log('aliases', `not asked: ${error.message}`);   // offline or the site down: the built-in patterns work alone
    return kept?.aliases || [];
  }
}
