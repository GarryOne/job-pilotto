// The free allowance and license keys (Stage 1: checked here, offline). Free for the first 30 applications
// (Stage Applied or later) or the first 60 days since this app first ran, whichever lasts longer. After that only NEW
// work pauses (Prepare kit, Fill in Chrome / Apply with Claude, manual searches); tracking, Notion, export and data
// keep working, and nothing is cut mid-application. A key signed by the owner (Ed25519, tools/license.py in the private
// ops repo) lifts the limit. Key: JP1.<base64url payload>.<base64url signature>, payload {id, name, kind, until?}.
// A technical user can patch this out: accepted at this stage (the server enforces it in Stage 2).
import crypto from 'node:crypto';

export const PUBLIC_KEY = 'cfYdshTDuVKHsd89v28_UbZieTTEpId-sKptFb1vu40';  // the owner's public key (raw Ed25519, base64url)
export const FREE_APPLICATIONS = 30, FREE_DAYS = 60;
export const KINDS = ['founder', 'friend', 'pass'];
const DAY = 24 * 60 * 60 * 1000;
// SPKI prefix for a raw Ed25519 public key, so node's crypto can load it.
const spki = raw => crypto.createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki'});
const unb64 = text => Buffer.from(text, 'base64url');

// A signed text (`prefix.payload.signature`) -> its payload, or null when it isn't genuinely signed by the owner.
export function open(text, prefix = 'JP1', publicKey = PUBLIC_KEY) {
  const parts = String(text || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  try {
    if (!crypto.verify(null, Buffer.from(parts[1]), spki(unb64(publicKey)), unb64(parts[2]))) return null;
    return JSON.parse(unb64(parts[1]).toString('utf8'));
  } catch { return null; }
}

// Check a pasted key: {ok, license: {id, name, kind, until}} or {ok: false, error} in words the user can act on.
export function check(text, {now = Date.now(), revoked = [], publicKey = PUBLIC_KEY} = {}) {
  const payload = open(text, 'JP1', publicKey);
  if (!payload || !payload.id || !payload.name || !KINDS.includes(payload.kind)) return {ok: false, error: "That isn't a Job Pilotto license key. Paste it exactly as you got it (it starts with JP1.)."};
  if (revoked.includes(payload.id)) return {ok: false, error: 'This key was withdrawn. Ask Igor for a new one.'};
  if (payload.until && Date.parse(`${payload.until}T23:59:59Z`) < now) return {ok: false, error: `This key ended on ${payload.until}. Ask Igor for a new one.`};
  return {ok: true, license: {id: payload.id, name: payload.name, kind: payload.kind, until: payload.until || null}};
}

// The list of withdrawn keys, signed like a key (JP1R…): its ids, or null when not genuine. (Fetching it comes later.)
export const revocations = (text, publicKey = PUBLIC_KEY) => { const payload = open(text, 'JP1R', publicKey); return Array.isArray(payload?.revoked) ? payload.revoked : null; };

// Where the user stands. `applied`: applications at Stage Applied or later; `firstRunAt`: ISO date of the first run.
export function allowance({applied = 0, firstRunAt, key = '', revoked = [], now = Date.now(), publicKey = PUBLIC_KEY}) {
  const started = Date.parse(firstRunAt) || now;
  const daysLeft = Math.max(0, Math.ceil(FREE_DAYS - (now - started) / DAY));
  const mine = key ? check(key, {now, revoked, publicKey}) : null;
  const ended = applied >= FREE_APPLICATIONS && daysLeft === 0;
  return {licensed: !!mine?.ok, license: mine?.ok ? mine.license : null, keyProblem: mine && !mine.ok ? mine.error : '',
    used: applied, limit: FREE_APPLICATIONS, daysLeft, ended: ended && !mine?.ok};
}

export const text = state => (state.licensed ? `Licensed to ${state.license.name} · ${state.license.kind} key${state.license.until ? ` · until ${state.license.until}` : ''}`
  : state.ended ? `${state.used} of ${state.limit} free applications used · free period over`
    : `${state.used} of ${state.limit} free applications · ${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left`);

// Storage-bound part. settings.license = {key, appliedSeen}; settings.firstRunAt is set once. `appliedNow` is read from the
// last Focus funnel (Applied reached); the largest number seen is kept so a slow or empty read never lowers it.
export function create(storage, {appliedNow = () => 0, now = () => Date.now()} = {}) {
  const state = () => {
    const settings = storage.settings();
    if (!settings.firstRunAt) storage.saveSettings({firstRunAt: new Date(now()).toISOString()});
    const mine = settings.license || {};
    const applied = Math.max(mine.appliedSeen || 0, Number(appliedNow()) || 0);
    if (applied !== (mine.appliedSeen || 0)) storage.saveSettings({license: {...mine, appliedSeen: applied}});
    return allowance({applied, firstRunAt: settings.firstRunAt || new Date(now()).toISOString(), key: mine.key, revoked: mine.revoked || [], now: now()});
  };
  return {
    state,
    set(pasted) {
      const revoked = storage.settings().license?.revoked || [];
      const result = check(pasted, {now: now(), revoked});
      if (result.ok) storage.saveSettings({license: {...(storage.settings().license || {}), key: String(pasted).trim()}});
      return result.ok ? {ok: true, state: state()} : result;
    },
    remove() { const {key, ...rest} = storage.settings().license || {}; storage.saveSettings({license: rest}); return state(); },
    // null when new work may start; else the state, so the caller can say why.
    blocked: () => { const now = state(); return now.ended ? now : null; },
  };
}
