// Test inboxes: the Email Worker for test-account-*@jobpilotto.top. Stores sender, recipient, subject, time, the text body and the links/codes in it
// (D1 test_mail, 7 days); GET /admin/test-mail (Bearer, the owner's scripts only) reads them. Any other address is rejected and never stored. Guard: test/test-mail.test.js.
import {isOwner} from './auth.js';

export const KEEP_DAYS = 7;
const BODY_MAX = 20000;
const TEST_ADDRESS = /^test-account-[a-z0-9][a-z0-9._+-]{0,60}@jobpilotto\.top$/;
export const isTestAddress = address => TEST_ADDRESS.test(String(address || '').trim().toLowerCase());

const latin1 = new TextDecoder('latin1');
function decodeBytes(text, encoding, charset) {
  let bytes;
  if (/base64/i.test(encoding)) bytes = Uint8Array.from(atob(text.replace(/\s+/g, '')), c => c.charCodeAt(0));
  else if (/quoted-printable/i.test(encoding)) {
    const raw = text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    bytes = Uint8Array.from(raw, c => c.charCodeAt(0) & 255);
  } else bytes = Uint8Array.from(text, c => c.charCodeAt(0) & 255);
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return latin1.decode(bytes); }
}
function splitHeaders(part) {
  const at = part.search(/\r?\n\r?\n/);
  const head = at < 0 ? part : part.slice(0, at), body = at < 0 ? '' : part.slice(at).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) { const m = /^([^:]+):\s*(.*)$/.exec(line); if (m) headers[m[1].toLowerCase()] = m[2]; }
  return {headers, body};
}
const htmlToText = html => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, ' $1 ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// The readable text of a raw message: text/plain when there is one, else the HTML as text (links kept).
export function textOf(raw, depth = 0) {
  const {headers, body} = splitHeaders(raw);
  const type = (headers['content-type'] || 'text/plain').toLowerCase();
  const boundary = /boundary="?([^";]+)"?/i.exec(headers['content-type'] || '')?.[1];
  if (type.startsWith('multipart/') && boundary && depth < 5) {
    const parts = body.split(`--${boundary}`).slice(1).filter(p => !p.startsWith('--')).map(p => textOf(p.replace(/^\r?\n/, ''), depth + 1));
    return parts.find(p => p.kind === 'plain') || parts.find(p => p.kind === 'html') || {text: '', kind: ''};
  }
  if (!type.startsWith('text/')) return {text: '', kind: ''};
  const text = decodeBytes(body, headers['content-transfer-encoding'] || '', /charset="?([\w-]+)"?/i.exec(type)?.[1]);
  return type.startsWith('text/html') ? {text: htmlToText(text), kind: 'html'} : {text, kind: 'plain'};
}
export const subjectOf = raw => {
  const value = splitHeaders(raw).headers.subject || '';
  return value.replace(/=\?([\w-]+)\?([bq])\?([^?]*)\?=/gi, (_, charset, enc, data) =>
    decodeBytes(/b/i.test(enc) ? data : data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, '=$1'), /b/i.test(enc) ? 'base64' : 'quoted-printable', charset)).replace(/\s+/g, ' ').trim();
};
export const linksIn = text => [...new Set((text.match(/https?:\/\/[^\s<>"')\]]+/g) || []).map(u => u.replace(/[.,;]+$/, '')))].slice(0, 30);
// A verification code: 4-8 digits standing alone (not inside a longer number, a link or a date).
export const codesIn = text => [...new Set((text.replace(/https?:\/\/\S+/g, ' ').match(/(?<![\w.-])\d{4,8}(?![\w.-])/g) || []))].slice(0, 10);

// Email Worker entry: only test-account-* is kept; anything else is rejected at SMTP time.
export async function receive(message, env, now = new Date()) {
  const to = String(message.to || '').trim().toLowerCase();
  if (!isTestAddress(to)) { message.setReject('Unknown recipient'); return false; }
  const raw = await new Response(message.raw).text();
  const subject = subjectOf(raw), {text} = textOf(raw), body = text.slice(0, BODY_MAX);
  await env.STATS.prepare('INSERT INTO test_mail (received_at, to_addr, from_addr, subject, body, links, codes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(now.toISOString(), to, String(message.from || '').slice(0, 200), subject.slice(0, 300), body, JSON.stringify(linksIn(body)), JSON.stringify(codesIn(body))).run();
  return true;
}

export async function purge(env, now = new Date()) {
  await env.STATS.prepare('DELETE FROM test_mail WHERE received_at < ?').bind(new Date(now - KEEP_DAYS * 86400000).toISOString()).run();
}

// GET /admin/test-mail?to=test-account-x@jobpilotto.top&since=<ISO time>: newest first. Bearer only; anything else is a 404.
export async function view(request, env) {
  const notFound = () => new Response('Not found', {status: 404});
  if (!(await isOwner(request, env)) || !(request.headers.get('Authorization') || '').startsWith('Bearer ')) return notFound();
  const url = new URL(request.url), to = (url.searchParams.get('to') || '').trim().toLowerCase(), since = url.searchParams.get('since') || '';
  if (!isTestAddress(to)) return new Response(JSON.stringify({error: 'to must be a test-account-*@jobpilotto.top address'}), {status: 400, headers: {'Content-Type': 'application/json'}});
  const sinceTime = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : '';
  const {results} = await env.STATS.prepare('SELECT received_at, to_addr, from_addr, subject, body, links, codes FROM test_mail WHERE to_addr = ? AND received_at >= ? ORDER BY received_at DESC LIMIT 20')
    .bind(to, sinceTime).all();
  const mails = results.map(r => ({received_at: r.received_at, to: r.to_addr, from: r.from_addr, subject: r.subject, body: r.body, links: JSON.parse(r.links), codes: JSON.parse(r.codes)}));
  return new Response(JSON.stringify({mails}), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
}
