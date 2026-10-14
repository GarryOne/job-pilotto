// The scrub of a "Report this form" record (spec docs/superpowers/specs/2026-10-15-report-this-form.md §2): the record keeps its shape (hosts, paths, timings, statuses) and loses
// whatever could be the person's: URL query values, typed-value attributes and text, the person's own values (lib/owner-values.js), any e-mail or phone. Then lastGate() scans the
// result again with the same values: one hit and nothing is sent. Kinds and counts only ever leave here, never a value. Pure: no files, no network.
// Guard: test/report-scrub.test.js.
import {EMAIL, FAKE_EMAIL, PHONE, fakeContacts} from './live-capture.js';
import {KEEP_HEADER, keepRecord, sha} from './net-keep.js';

const CODE = /javascript|ecmascript|text\/css/i, TEXT = /html|json|xml|text\/|javascript|ecmascript/i;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ONE_EMAIL = new RegExp(`^${EMAIL.source}$`);
const TOKEN = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;   // an id-like path segment: long, with a digit

// A URL with its query values and fragment gone, an e-mail or id-like path segment named <id>. -> string
export function scrubUrl(url) {
  let u;
  try { u = new URL(url, 'https://x.invalid'); } catch { return String(url).split('#')[0].split('?')[0]; }
  const path = u.pathname.split('/').map(part => (ONE_EMAIL.test(decodeURIComponent(part)) || TOKEN.test(part) ? '<id>' : part)).join('/'); 
  const keys = [...u.searchParams.keys()], query = keys.length ? `?${keys.map(key => `${encodeURIComponent(key)}=<v>`).join('&')}` : '';
  return `${/^https?:/i.test(url) ? `${u.protocol}//${u.host}` : ''}${path}${query}`;
}

// What the person typed in a page's own markup: an input's value, a textarea's text, a chosen option. A button's, radio's or checkbox's value is the page's own wording.
const KEEPS_VALUE = /\btype\s*=\s*["']?(submit|button|reset|image|radio|checkbox)\b/i;
function blankTyped(html, counts) {
  let out = html.replace(/<input\b[^>]*>/gi, tag => (KEEPS_VALUE.test(tag) ? tag : tag.replace(/(\svalue\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, (_, head) => { counts.typed += 1; return `${head}""`; })));
  out = out.replace(/(<textarea\b[^>]*>)([^<]+)(<\/textarea>)/gi, (_, open, body, close) => { counts.typed += 1; return `${open}${close}`; });
  return out.replace(/<option\b[^>]*\sselected\b[^>]*>/gi, tag => { counts.typed += 1; return tag.replace(/\sselected(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/i, ''); });
}

// Owner values that may be replaced or searched in this kind of text: code (a script, a style sheet) takes e-mails, phones and multi-word values only, so a name word that is also
// an identifier never breaks a page's code.
const usable = (values, code) => [...values].filter(([value, kind]) => !code || kind === 'email' || kind === 'phone' || /\s/.test(value));
// In code, two or more of the person's name words in a row ("Rosalind Quill") are a name, not an identifier. -> RegExp or null
const nameRun = values => {
  const words = [...values].filter(([, kind]) => kind === 'name').map(([value]) => escape(value));
  return words.length > 1 ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?:\\s+(?:${words.join('|')}))+(?![\\p{L}\\p{N}])`, 'giu') : null;
};
const NAME = 'Candidate', PLACE = 'Elsewhere';

function ownOut(text, values, code, counts) {
  let out = code && nameRun(values) ? text.replace(nameRun(values), () => { counts.own += 1; return NAME; }) : text;
  for (const [value, kind] of usable(values, code)) {
    if (kind === 'phone') continue;   // a phone is scrubbed by shape below (any 9+ digits), whatever its separators
    const word = kind === 'name' || kind === 'location', re = new RegExp(word ? `(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])` : escape(value), 'giu');   // letters and digits bound a word, not _ (a file name "Quill_Rosalind_CV.pdf")
    out = out.replace(re, () => { counts.own += 1; return kind === 'email' || kind === 'account' ? FAKE_EMAIL : kind === 'location' ? PLACE : NAME; });   // every case: a name in capitals is still the name
  }
  return out;
}
function contactsOut(text, counts) {
  EMAIL.lastIndex = 0; PHONE.lastIndex = 0;
  const out = fakeContacts(text);
  if (out !== text) counts.contacts += (text.match(EMAIL) || []).filter(e => !/@example\.(com|org|net)$/i.test(e)).length + (text.match(PHONE) || []).filter(p => p.replace(/\D/g, '').length >= 9).length;
  return out;
}

// -> {entries, bodies, stats}: the record after the keep rules (net-keep.js) and the scrub. stats.removed counts what was taken out, by kind.
export function scrubRecord(record, values = new Map()) {
  const kept = keepRecord(record), counts = {typed: 0, own: 0, contacts: 0, urls: 0}, bodies = new Map(), entries = [];
  for (const entry of kept.entries) {
    const url = scrubUrl(entry.url); if (url !== entry.url) counts.urls += 1;
    const own = Object.fromEntries(Object.entries(entry.headers || {}).filter(([name]) => KEEP_HEADER.test(name))), type = own['content-type'] || '', headers = own.location ? {...own, location: scrubUrl(own.location)} : own;
    let hash = entry.hash;
    const body = entry.hash ? kept.bodies.get(entry.hash) : null;
    if (body && TEXT.test(type)) {
      const code = CODE.test(type) || /\.(m?js|css)(\?|$)/i.test(new URL(entry.url).pathname);
      let text = body.toString('utf8');
      if (!code) text = blankTyped(text, counts);
      text = contactsOut(ownOut(text, values, code, counts), counts);
      const next = Buffer.from(text); hash = sha(next); bodies.set(hash, next);
    } else if (body) bodies.set(hash, body);
    entries.push({...entry, url, headers, bodyKey: '', hash, size: hash ? bodies.get(hash).length : 0});
  }
  return {entries, bodies, stats: {...kept.stats, removed: counts}};
}

// The last gate before anything leaves: the scrubbed record searched again with the person's values. -> [{kind, in: 'url' | 'body'}] (kinds only; empty = clear)
export function lastGate({entries, bodies}, values = new Map()) {
  const hits = [], seen = new Set(), add = (kind, where) => { if (!seen.has(kind + where)) { seen.add(kind + where); hits.push({kind, in: where}); } };
  const scan = (text, code, where) => {
    EMAIL.lastIndex = 0; PHONE.lastIndex = 0;
    if ((text.match(EMAIL) || []).some(e => !/@example\.(com|org|net)$/i.test(e))) add('email', where);
    if ((text.match(PHONE) || []).some(p => p.replace(/\D/g, '').length >= 9)) add('phone', where);
    if (code && nameRun(values)?.test(text)) add('name', where);
    const folded = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const [value, kind] of usable(values, code)) {
      if (kind === 'phone' || kind === 'email') continue;
      const plain = value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(plain)}(?![\\p{L}\\p{N}])`, 'u').test(folded)) add(kind, where);
    }
  };
  for (const entry of entries) {
    scan(entry.url, false, 'url');
    const body = entry.hash ? bodies.get(entry.hash) : null, type = entry.headers?.['content-type'] || '';
    if (body && TEXT.test(type)) scan(body.toString('utf8'), CODE.test(type), 'body');
  }
  return hits;
}
