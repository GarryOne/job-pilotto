// The app's side of the shared recipe library (site/src/recipes.js; design in Notion "Self-improving form filling").
// The extension never talks to the site: it asks the app for recipes by fingerprint, the app asks the site, remembers the answer
// (also "none") for a while, and passes on only what extension/recipe-schema.js accepts. It also sends back, in batches, how
// the operators fared (counts) and the structure of controls it could not read (no text). All of it follows the Technical
// reports switch: off means no fingerprint ever leaves this Mac.
import {validateRecipe} from '../shared/recipe-schema.js';
import {installId} from './app-feedback.js';
import {log} from './log.js';

export const SITE = 'https://www.jobpilotto.workers.dev';
const CACHE = 'recipes-cache.json';
const TTL_MS = 6 * 3600 * 1000;
const FLUSH_MS = 5 * 60 * 1000;

const enabled = storage => storage.settings().telemetry !== false;
const readCache = storage => { try { return JSON.parse(storage.readText(CACHE) || '{}'); } catch { return {}; } };

async function token(storage, fetcher, base) {
  const id = installId(storage);
  const kept = storage.settings().recipesToken;
  if (kept?.install === id && kept.value) return kept.value;
  const response = await fetcher(`${base}/api/install-token`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({install: id})});
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) throw new Error(`token ${response.status}`);
  storage.saveSettings({recipesToken: {install: id, value: body.token}});
  return body.token;
}

// -> {fingerprint: recipe} for the fingerprints that have a running recipe for this install. Never throws: no recipes is a
// normal answer.
export async function lookup(storage, fingerprints, {fetcher = globalThis.fetch, base = SITE, now = Date.now()} = {}) {
  if (!enabled(storage)) return {};
  const wanted = [...new Set((Array.isArray(fingerprints) ? fingerprints : []).map(String).filter(fp => /^[a-z0-9]{6,16}$/.test(fp)))].slice(0, 30);
  const cache = readCache(storage), found = {};
  const ask = wanted.filter(fp => !(cache[fp] && now - cache[fp].at < TTL_MS));
  if (ask.length) {
    try {
      const id = installId(storage);
      let bearer = await token(storage, fetcher, base);
      let response = await fetcher(`${base}/api/recipes/lookup`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`},
        body: JSON.stringify({install: id, fingerprints: ask})});
      if (response.status === 401) {   // a token from before a key change: take a new one once
        storage.saveSettings({recipesToken: null});
        bearer = await token(storage, fetcher, base);
        response = await fetcher(`${base}/api/recipes/lookup`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`},
          body: JSON.stringify({install: id, fingerprints: ask})});
      }
      if (!response.ok) throw new Error(`lookup ${response.status}`);
      const body = await response.json();
      const given = new Map((Array.isArray(body.recipes) ? body.recipes : []).map(item => [String(item?.fingerprint), validateRecipe(item)]));
      for (const fp of ask) {
        const checked = given.get(fp);
        cache[fp] = {at: now, recipe: checked?.ok ? checked.recipe : null};
      }
      storage.writeText(CACHE, JSON.stringify(cache));
    } catch (error) {
      log('recipes', `not asked: ${error.message}`);   // offline or the site down: the operators use their defaults
    }
  }
  for (const fp of wanted) if (cache[fp]?.recipe) found[fp] = cache[fp].recipe;
  return found;
}

// ---- what goes back: operator outcomes (counts per fingerprint and recipe) and new control structures ----
export function createReporter(storage, {fetcher = globalThis.fetch, base = SITE, setTimer = setTimeout} = {}) {
  let outcomes = new Map(), samples = [], timer = null;
  const schedule = () => { if (!timer) { timer = setTimer(() => { timer = null; flush().catch(() => {}); }, FLUSH_MS); timer.unref?.(); } };
  return {
    // items [{fp, ok, recipe}] from the operators.
    outcome(items) {
      if (!enabled(storage)) return;
      for (const item of Array.isArray(items) ? items.slice(0, 20) : []) {
        if (!/^[a-z0-9]{6,16}$/.test(String(item?.fp || ''))) continue;
        const key = `${item.fp}|${Number(item.recipe) || 0}`;
        const entry = outcomes.get(key) || {fp: item.fp, recipe: Number(item.recipe) || 0, ok: 0, failed: 0};
        if (item.ok) entry.ok++; else entry.failed++;
        outcomes.set(key, entry);
      }
      schedule();
    },
    // items [{fingerprint, kind, skeleton, question}] new to this Mac (lib/misses.js).
    sample(items) {
      if (!enabled(storage)) return;
      for (const item of Array.isArray(items) ? items.slice(0, 10) : []) {
        if (item?.fingerprint && item.skeleton) samples.push({fingerprint: item.fingerprint, kind: item.kind, skeleton: item.skeleton, question: item.question || ''});
      }
      samples = samples.slice(-20);
      schedule();
    },
    async flush() { return flush(); },
  };
  async function flush() {
    if (!enabled(storage) || (!outcomes.size && !samples.length)) return {sent: 0};
    const body = {install: installId(storage), samples: samples.slice(0, 10), outcomes: [...outcomes.values()].slice(0, 40)};
    const taken = {samples: samples.slice(0, 10), outcomes};
    samples = samples.slice(10);
    outcomes = new Map();
    try {
      const response = await fetcher(`${base}/api/controls`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      if (!response.ok) throw new Error(`controls ${response.status}`);
      return {sent: body.samples.length + body.outcomes.length};
    } catch (error) {
      log('recipes', `outcomes not sent: ${error.message}`);
      samples = [...taken.samples, ...samples].slice(-20);   // kept for the next try
      for (const [key, entry] of taken.outcomes) {
        const again = outcomes.get(key) || {...entry, ok: 0, failed: 0};
        again.ok += entry.ok; again.failed += entry.failed;
        outcomes.set(key, again);
      }
      return {sent: 0};
    }
  }
}
