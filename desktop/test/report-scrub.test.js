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
const SCRIPT = 'const quill = 1; const boot = {"mail":"rosalind.quill@mailbox.test","who":"Rosalind Quill"};';
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
  assert.match(script, /const quill = 1/, 'a name word that is also an identifier is left in code');
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
