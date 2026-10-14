// lib/report-scrub.js: a "Report this form" record after the scrub holds none of a fake person's own values, and the last gate stops what the scrub missed (spec 2026-10-15-report-this-form.md §2, §7).
// The person here is invented (Rosalind Quill); nothing real is read.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lastGate, scrubRecord, scrubUrl} from '../lib/report-scrub.js';
import {ownerValuesOf} from '../lib/owner-values.js';

const TEXTS = ['full name: Rosalind Quill\nemail: rosalind.quill@mailbox.test\nphone: +41 79 555 01 23\nLocation: Port Vale, Atlantis\n'];
const values = ownerValuesOf(TEXTS);
const entry = (over = {}) => ({method: 'GET', url: 'https://jobs.example.test/apply?token=abc123def456ghi789&lang=en', type: 'document', mode: 'navigate', startMs: 0, waitMs: 5, bodyKey: 'txt:aaaa', status: 200, failed: false,
  headers: {'content-type': 'text/html', 'set-cookie': 'x=1'}, hadCookie: true, hash: '', size: 0, ...over});
const HTML = '<h1>Welcome back, Rosalind</h1><form><input name="first" value="Rosalind"><input name="mail" type="email" value="rosalind.quill@mailbox.test"><input type="submit" value="Send application">'
  + '<textarea name="why">I live in Port Vale and love QUILL things</textarea><select><option>A</option><option selected>Port Vale</option></select></form><p>Call +41 79 555 01 23 or hr@company.test</p>';
const JSON_REPLY = JSON.stringify({user: {name: 'Rosalind Quill', cv: 'Quill_Rosalind_CV.pdf', city: 'Port Vale'}});
const SCRIPT = 'const q = 1; const boot = {"mail":"rosalind.quill@mailbox.test","who":"Rosalind Quill"};';
const record = () => {
  const bodies = new Map([['h', Buffer.from(HTML)], ['j', Buffer.from(JSON_REPLY)], ['s', Buffer.from(SCRIPT)]]);
  return {bodies, entries: [entry({hash: 'h', size: HTML.length}),
    entry({url: 'https://jobs.example.test/api/me?email=rosalind.quill@mailbox.test', type: 'fetch', headers: {'content-type': 'application/json'}, hash: 'j', size: JSON_REPLY.length}),
    entry({url: 'https://jobs.example.test/app.js', type: 'script', headers: {'content-type': 'application/javascript'}, hash: 's', size: SCRIPT.length})]};
};
const everything = ({entries, bodies}) => JSON.stringify(entries) + [...bodies.values()].map(body => body.toString('utf8')).join('\n');

test('a fake person\'s name, e-mail, phone, city, CV file name and typed values are not in the scrubbed record', () => {
  const out = scrubRecord(record(), values), text = everything(out);
  for (const own of [/rosalind/i, /Quill/, /QUILL/, /mailbox\.test/i, /555 01 23/, /port vale/i, /atlantis/i, /token=abc/, /hr@company/]) assert.ok(!own.test(text), `left in the record: ${own}`);
  assert.deepEqual(lastGate(out, values), [], 'the gate finds nothing after a good scrub');
  assert.ok(out.stats.removed.typed >= 3 && out.stats.removed.own > 0 && out.stats.removed.contacts > 0 && out.stats.removed.urls > 0, JSON.stringify(out.stats.removed));
});

test('the page keeps its shape: a button\'s own wording, a script\'s identifiers, host and path, the query keys', () => {
  const out = scrubRecord(record(), values), page = out.bodies.get(out.entries[0].hash).toString('utf8'), script = out.bodies.get(out.entries[2].hash).toString('utf8');
  assert.match(page, /value="Send application"/);
  assert.match(page, /<select><option>A<\/option><option>/);
  assert.match(script, /const q = 1/, 'a script\'s code is left as it was');
  assert.equal(out.entries[0].url, 'https://jobs.example.test/apply?token=<v>&lang=<v>');
  assert.ok(out.entries.every(one => one.bodyKey === '' && !('set-cookie' in one.headers)), 'no body key, no cookie');
});

test('the last gate: a record the scrub did not clean is stopped, by kind only', () => {
  const hits = lastGate(record(), values);
  assert.ok(hits.length >= 4, JSON.stringify(hits));
  assert.ok(hits.some(hit => hit.kind === 'name') && hits.some(hit => hit.kind === 'email') && hits.some(hit => hit.kind === 'location'));
  assert.ok(!JSON.stringify(hits).match(/rosalind|quill|port vale/i), 'a hit names its kind, never the value');
});

test('scrubUrl: query values and fragment gone, e-mail and id-like path parts named', () => {
  assert.equal(scrubUrl('https://a.example.test/u/jane.doe@mail.test/x?a=1&b=2#frag'), 'https://a.example.test/u/<id>/x?a=<v>&b=<v>');
  assert.equal(scrubUrl('https://a.example.test/o/9f8e7d6c5b4a3b2c1d/apply'), 'https://a.example.test/o/<id>/apply');
  assert.equal(scrubUrl('/relative/path?x=1'), '/relative/path?x=<v>');
});

// Review of #798 (job-pilotto-cc, 15 Oct 2026): the scrub fails closed.
const one = (type, body, over = {}) => ({bodies: new Map([['b', Buffer.isBuffer(body) ? body : Buffer.from(body)]]), entries: [entry({type: 'fetch', url: 'https://jobs.example.test/x', headers: type ? {'content-type': type} : {}, hash: 'b', size: 9, ...over})]});
const gone = out => out.entries.every(item => item.hash === '' && item.size === 0) && out.bodies.size === 0;

test('1. a body whose type the scrub does not understand is dropped, the entry kept with size 0', () => {
  const cv = Buffer.from('%PDF-1.4 Rosalind Quill CV');
  const b64 = Buffer.from('Rosalind Quill, Port Vale, my CV. '.repeat(2)).toString('base64');
  for (const type of ['', 'application/octet-stream', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
    const out = scrubRecord(one(type, cv), values);
    assert.ok(gone(out), `kept a ${type || 'typeless'} body`);
    assert.equal(out.stats.removed.binary, 1);
    assert.equal(out.entries.length, 1);
  }
  const wrapped = scrubRecord(one('application/json', JSON.stringify({file: b64})), values);
  assert.ok(lastGate(wrapped, values).length > 0, 'base64 inside JSON is decoded and searched; the record is refused');
  const fine = scrubRecord(one('font/woff2', Buffer.from([0, 1, 2, 3])), values);
  assert.equal(fine.entries[0].size, 4, 'a font stays');
});

test('2. encoded copies are replaced or refused: URL-encoded, + for a space, JSON-escaped, HTML entities', () => {
  const page = '<p>rosalind.quill&#64;mailbox.test and rosalind.quill%40mailbox.test and rosalind.quill\\u0040mailbox.test</p><a href="/x?n=Rosalind+Quill&amp;c=Port%20Vale">x</a>'
    + '<p>Rosalind &amp; co, Port&nbsp;Vale, call 41&nbsp;79&nbsp;555&nbsp;01&nbsp;23</p>';
  const out = scrubRecord(one('text/html', page), values), text = everything(out);
  assert.ok(!/rosalind|quill|mailbox|port.?vale|555/i.test(text), `left: ${text}`);
  assert.deepEqual(lastGate(out, values), []);
  const raw = one('font/woff2', 'x Quill%20Rosalind x rosalind.quill%40mailbox.test x &#82;osalind x Port+Vale');
  const kinds = lastGate(raw, values).map(hit => hit.kind);
  for (const kind of ['name', 'email', 'location']) assert.ok(kinds.includes(kind), `the gate missed ${kind} in an encoded form: ${kinds}`);
});

test('3. the gate searches every kept body, as UTF-8 and as latin1, whatever its type', () => {
  for (const type of ['', 'application/pdf', 'font/woff2', 'image/avif']) assert.ok(lastGate(one(type, Buffer.from('xx Rosalind xx', 'latin1')), values).length > 0, `a ${type || 'typeless'} body was not searched`);
  assert.ok(lastGate(one('font/woff2', Buffer.from('José Rosalind'.replace('José', 'Jos\xe9'), 'latin1')), values).length > 0);
});

test('4. a lone name word in code is left by the scrub but blocks the send as name-in-code', () => {
  const out = scrubRecord(one('application/javascript', 'const quill = 1;'), values);
  assert.match(out.bodies.get(out.entries[0].hash).toString(), /const quill = 1/);
  assert.deepEqual(lastGate(out, values).map(hit => hit.kind), ['name-in-code']);
});
