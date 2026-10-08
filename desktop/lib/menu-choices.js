// A menu's answer in another wording, remembered as the menu's own choice per site, field and answer ("+41" on Coop's "Indicatif de pays" ->
// "Suisse"), so the next fill tries the right choice first: no wrong attempt, no AI call, no re-arm (owner, 8 Oct 2026: "why does it first try
// +41?"). Written by lib/menu-rearm.js when Claude finds the choice; served with the details (lib/server-contact.js me) to extension/flow.js.
// A cache on this Mac like the menu picks of lib/option-pick.js. Guarded by test/menu-choices.test.js.
const FILE = 'menu-choices.json', KEEP = 300;
const norm = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}+]+/gu, ' ').trim();
const hostOf = url => { try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; } };
const read = storage => { try { return JSON.parse(storage.readText(FILE) || '[]'); } catch { return []; } };

export function rememberChoice(storage, {url, label, value, choice}) {
  const host = hostOf(url);
  if (!host || !label || !value || !choice || norm(value) === norm(choice)) return false;
  const kept = read(storage).filter(item => !(item.host === host && norm(item.label) === norm(label) && norm(item.value) === norm(value)));
  storage.writeText(FILE, JSON.stringify([...kept, {host, label: String(label).slice(0, 120), value: String(value).slice(0, 120), choice: String(choice).slice(0, 120)}].slice(-KEEP)));
  return true;
}

// For one site, or every remembered one (no url): the details are asked with the posting's address, the form may sit on another site.
export const choicesFor = (storage, url = '') => { if (!url) return read(storage); const host = hostOf(url); return host ? read(storage).filter(item => item.host === host || host.endsWith(`.${item.host}`)) : []; };
