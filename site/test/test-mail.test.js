// Test inboxes (src/test-mail.js): only test-account-* is stored, links and codes are found, 7 days kept, read only with the Bearer key.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {codesIn, isTestAddress, linksIn, purge, receive, subjectOf, textOf, view} from '../src/test-mail.js';

function env() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0078_test_mail.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)})});
  return {db, STATS: {prepare: sql => statement(sql)}, STATS_KEY: 'k', STATS_API_KEY: 'api-key'};
}
const mail = (to, raw, from = 'noreply@workday.com') => ({to, from, raw: new Blob([raw]).stream(), rejected: null, setReject(reason) { this.rejected = reason; }});
const plain = 'From: a@b.c\r\nSubject: Verify your account\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nClick https://wd.example/verify?t=abc123. Your code is 483920 today.\r\n';
const ask = (e, query, key = 'api-key') => view(new Request(`https://x/admin/test-mail?${query}`, key ? {headers: {Authorization: `Bearer ${key}`}} : {}), e);

test('which addresses are test inboxes', () => {
  for (const ok of ['test-account-adnovum@jobpilotto.top', 'Test-Account-X@jobpilotto.top']) assert.ok(isTestAddress(ok), ok);
  for (const no of ['office@jobpilotto.top', 'hello@jobpilotto.top', 'test-account-@jobpilotto.top', 'test-account-x@evil.com', 'test-account-x@jobpilotto.top.evil.com', '']) assert.ok(!isTestAddress(no), no);
});

test('a test-account mail is stored with its link and code; any other address is rejected and never stored', async () => {
  const e = env(), ok = mail('test-account-richemont@jobpilotto.top', plain), no = mail('office@jobpilotto.top', plain);
  assert.equal(await receive(ok, e), true);
  assert.equal(await receive(no, e), false);
  assert.equal(no.rejected, 'Unknown recipient');
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM test_mail').get().n, 1);
  const {mails} = await (await ask(e, 'to=test-account-richemont@jobpilotto.top')).json();
  assert.deepEqual([mails[0].subject, mails[0].links, mails[0].codes], ['Verify your account', ['https://wd.example/verify?t=abc123'], ['483920']]);
});

test('multipart: plain wins, HTML falls back to text with links, encoded subjects and bodies decode', () => {
  const multi = 'Content-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/html\r\n\r\n<p>HTML <a href="https://h.example/x">go</a></p>\r\n--b1\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCaf=C3=A9 code 1234\r\n--b1--\r\n';
  assert.equal(textOf(multi).text.trim(), 'Café code 1234');
  const htmlOnly = 'Content-Type: text/html\r\n\r\n<p>Open <a href="https://h.example/x">here</a></p>';
  assert.deepEqual(linksIn(textOf(htmlOnly).text), ['https://h.example/x']);
  assert.equal(subjectOf('Subject: =?UTF-8?B?Q2Fmw6k=?= ok\r\n\r\n'), 'Café ok');
  assert.deepEqual(codesIn('Order 12 on 2026-10-16, code 5521, id A1234567, https://x/1234'), ['5521']);
});

test('mail older than 7 days is purged', async () => {
  const e = env();
  await receive(mail('test-account-a@jobpilotto.top', plain), e, new Date('2026-10-01T00:00:00Z'));
  await receive(mail('test-account-a@jobpilotto.top', plain), e, new Date('2026-10-15T00:00:00Z'));
  await purge(e, new Date('2026-10-16T00:00:00Z'));
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM test_mail').get().n, 1);
});

test('reading needs the Bearer key, a test address, and honours since', async () => {
  const e = env();
  await receive(mail('test-account-a@jobpilotto.top', plain), e, new Date('2026-10-15T00:00:00Z'));
  assert.equal((await ask(e, 'to=test-account-a@jobpilotto.top', '')).status, 404);
  assert.equal((await ask(e, 'to=test-account-a@jobpilotto.top', 'wrong')).status, 404);
  assert.equal((await ask(e, 'to=office@jobpilotto.top')).status, 400);
  assert.equal((await (await ask(e, 'to=test-account-a@jobpilotto.top&since=2026-10-16T00:00:00Z')).json()).mails.length, 0);
  assert.equal((await (await ask(e, 'to=test-account-a@jobpilotto.top&since=2026-10-14T00:00:00Z')).json()).mails.length, 1);
});
