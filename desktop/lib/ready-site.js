// Ready to send, the app's calls to the site (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): is this install the owner's, send tonight's batch, start it now, read the morning's rows, mark a job Done.
// The install's own key (the one Free AI uses) is the only credential; the site answers 404 or 401 to anyone but the owner, so the card is shown only when `owner` says yes. Guard: test/ready-site.test.js.
import {FREE_BASE} from './ai-free.js';
import {call as callWith, keyOf} from './hosted-search.js';
import {read as keychainRead} from './keychain.js';
import {installId} from './pool-share.js';

// The install's key for the site. An install on its own engine (Claude Code, its own key) has no JPF1 key, so its token is minted from the install id (as Free AI does) and kept in memory only:
// it is not saved as the Anthropic key, so the engine does not change. The owner is told by the site's READY_OWNER match (the install id), nothing else.
const minted = new Map();
async function keyFor(storage, {fetcher = globalThis.fetch} = {}) {
  const own = keyOf(storage);
  if (own) return own;
  const install = installId(storage);
  if (!install) return '';
  if (!minted.has(install)) {
    try {
      const response = await fetcher(`${FREE_BASE.replace(/\/api\/ai$/, '')}/api/install-token`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({install, purpose: 'ai'})});
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.token) minted.set(install, `JPF1.${install}.${body.token}`);
    } catch { /* offline: the card stays closed */ }
  }
  return minted.get(install) || '';
}
// Every call carries the owner secret too, never the install id: the app's own store, else this Mac's Keychain item job-pilotto.ready.owner_secret (read through lib/keychain.js, so a test or twin never reaches it).
// Without it the site opens no owner route and the card stays closed. Tests replace the reader.
let readKeychain = service => keychainRead(service, {account: 'job-pilotto'});
export const useKeychainReader = fn => { readKeychain = fn; };
export const ownerSecret = storage => String(storage.secret('READY_OWNER_SECRET') || readKeychain('job-pilotto.ready.owner_secret') || '');
const call = async (storage, route, options = {}) => callWith(storage, route, {...options, key: await keyFor(storage, options), headers: {'x-ready-owner': ownerSecret(storage)}});

const words = result => (result.ok ? result : {ok: false, status: result.status, error: result.status === 401 || result.status === 404 ? 'Ready to send is not on for this install.' : result.error});

export const owner = async (storage, options) => (await call(storage, '/api/ready/state', options)).ok === true;
export const rows = async (storage, options) => words(await call(storage, '/api/ready/state', options));   // -> {ok, batch: {night, state, costUsd, expiresAt}, jobs: [...]}
export const send = async (storage, batch, options) => words(await call(storage, '/api/ready/batch', {method: 'POST', body: batch, ...options}));
export const runNow = async (storage, options) => words(await call(storage, '/api/ready/run', {method: 'POST', body: {}, ...options}));
export const done = async (storage, job, options) => words(await call(storage, '/api/ready/done', {method: 'POST', body: {job}, ...options}));
export const deleteAll = async (storage, options) => words(await call(storage, '/api/ready/data', {method: 'DELETE', ...options}));
export const link = async (storage, job, options) => words(await call(storage, '/api/ready/link', {method: 'POST', body: {job}, ...options}));   // -> {ok, url, expiresAt}: the 10-minute live-view link for one form
