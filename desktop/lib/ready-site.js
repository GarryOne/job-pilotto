// Ready to send, the app's calls to the site (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): is this install the owner's, send tonight's batch, start it now, read the morning's rows, mark a job Done.
// The install's own key (the one Free AI uses) is the only credential; the site answers 404 or 401 to anyone but the owner, so the card is shown only when `owner` says yes. Guard: test/ready-site.test.js.
import {FREE_BASE} from './ai-free.js';
import {call as callWith, keyOf} from './hosted-search.js';
import {siteIsOff, siteOffReason} from './recipes.js';
import {DEV_BUILD} from './telemetry.js';
import {read as keychainRead} from './keychain.js';
import {installId} from './pool-share.js';
import {installToken} from './install-token.js';

// The install's key for the site. An install on its own engine (Claude Code, its own key) has no JPF1 key, so its token is asked for from the install id (as Free AI does) through lib/install-token.js, kept in settings:
// it is not saved as the Anthropic key, so the engine does not change. The owner is told by the site's READY_OWNER match (the install id), nothing else.
async function keyFor(storage, {fetcher = globalThis.fetch} = {}) {
  const own = keyOf(storage);
  if (own) return own;
  const install = installId(storage);
  if (!install) return '';
  const token = await installToken(storage, install, 'ai', {base: FREE_BASE.replace(/\/api\/ai$/, ''), fetcher});   // kept once asked; no new ask after a refusal until tomorrow
  return token ? `JPF1.${install}.${token}` : '';
}
// Every call carries the owner secret too, never the install id: the app's own store, else this Mac's Keychain item job-pilotto.ready.owner_secret (read through lib/keychain.js, so a test or twin never reaches it).
// Without it the site opens no owner route and the card stays closed. Tests replace the reader.
let readKeychain = service => keychainRead(service, {account: 'job-pilotto'});
export const useKeychainReader = fn => { readKeychain = fn; };
export const ownerSecret = storage => String(storage.secret('READY_OWNER_SECRET') || readKeychain('job-pilotto.ready.owner_secret') || '');
// devBuild: the owner runs his app from source (18 Oct 2026: the card said "Always on needs a regular install" there); tests, CI and smoke runs stay off the site.
const call = async (storage, route, options = {}) => callWith(storage, route, {...options, key: await keyFor(storage, options), headers: {'x-ready-owner': ownerSecret(storage)}, devBuild: true});

const words = result => (result.ok ? result : {ok: false, status: result.status, error: result.status === 401 || result.status === 404 ? 'Ready to send is not on for this install.' : result.error});

export const owner = async (storage, options) => (await call(storage, '/api/ready/state', options)).ok === true;
const clock = at => new Date(at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
// The morning's rows, or why the card cannot work right now, in plain words (the card is always shown and says this; owner, 18 Oct 2026: "show the card always... an error message/status and disabled buttons").
// -> {ok: true, batch, jobs} or {ok: false, why}.
export async function status(storage, {now = Date.now, ...options} = {}) {
  if (siteIsOff() && siteOffReason() !== DEV_BUILD) return {ok: false, why: `Not in ${siteOffReason()}: it never reaches our server.`};
  if (!ownerSecret(storage)) return {ok: false, why: 'Only on the owner\'s install while it is tested.'};
  const key = await keyFor(storage, options);
  if (!key) {
    const wait = storage.settings().siteTokenWait?.ai || 0;
    return {ok: false, why: wait > now() ? `Our site gave this install no token today (its daily limit); asked again at ${clock(wait)}.` : 'Could not get this install\'s token from our site. Check the connection.'};
  }
  const result = await callWith(storage, '/api/ready/state', {...options, key, headers: {'x-ready-owner': ownerSecret(storage)}, devBuild: true});
  if (result.ok) return result;
  return {ok: false, why: result.status === 401 || result.status === 404 ? 'Our site does not know this install as the owner\'s.' : `Our server did not answer${result.status ? ` (${result.status})` : ''}: ${result.error}`};
}
export const rows = async (storage, options) => words(await call(storage, '/api/ready/state', options));   // -> {ok, batch: {night, state, costUsd, expiresAt}, jobs: [...]}
export const send = async (storage, batch, options) => words(await call(storage, '/api/ready/batch', {method: 'POST', body: batch, ...options}));
export const runNow = async (storage, options) => words(await call(storage, '/api/ready/run', {method: 'POST', body: {}, ...options}));
export const done = async (storage, job, options) => words(await call(storage, '/api/ready/done', {method: 'POST', body: {job}, ...options}));
export const deleteAll = async (storage, options) => words(await call(storage, '/api/ready/data', {method: 'DELETE', ...options}));
export const handoff = async (storage, job, options) => words(await call(storage, `/api/ready/handoff?job=${encodeURIComponent(job)}`, options));   // -> {ok, url, storage, sessionStorage, snapshot}: Open in my browser
export const link = async (storage, job, options) => words(await call(storage, '/api/ready/link', {method: 'POST', body: {job}, ...options}));   // -> {ok, url, expiresAt}: the 10-minute live-view link for one form
