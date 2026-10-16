// The harness's test-inbox reader (lib/test-mail.mjs): only test-account-* inboxes, the key never in the URL, waits then returns the link and code.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isTestInbox, latestMail, siteKey} from '../lib/test-mail.mjs';

const answer = mails => async (url, init) => { answer.last = {url, init}; return {ok: true, status: 200, json: async () => ({mails})}; };
const mail = {received_at: '2026-10-16T10:00:00.000Z', links: ['https://a.example/x', 'https://a.example/verify?t=1'], codes: ['123456'], subject: 's', body: 'b', from: 'f'};

test('only test-account-* inboxes are asked for', async () => {
  assert.ok(isTestInbox('test-account-adnovum@jobpilotto.top'));
  for (const no of ['office@jobpilotto.top', 'igor.mardari96+jp@gmail.com', 'test-account-x@example.com']) {
    assert.ok(!isTestInbox(no), no);
    await assert.rejects(latestMail(no, {key: 'k', fetchImpl: answer([mail])}), /only test-account/);
  }
});

test('returns the first link and code, or the link a pattern picks; the key travels as a Bearer header only', async () => {
  const fetchImpl = answer([mail]);
  const found = await latestMail('test-account-adnovum@jobpilotto.top', {key: 'secret', fetchImpl, match: /verify/});
  assert.deepEqual([found.link, found.code], ['https://a.example/verify?t=1', '123456']);
  assert.equal((await latestMail('test-account-adnovum@jobpilotto.top', {key: 'secret', fetchImpl})).link, 'https://a.example/x');
  assert.ok(!answer.last.url.includes('secret'));
  assert.equal(answer.last.init.headers.Authorization, 'Bearer secret');
});

test('waits for the mail, and gives null when none arrives in time', async () => {
  let calls = 0;
  const fetchImpl = async () => ({ok: true, status: 200, json: async () => ({mails: ++calls < 3 ? [] : [mail]})});
  assert.ok(await latestMail('test-account-a@jobpilotto.top', {key: 'k', fetchImpl, waitMs: 60000, sleep: async () => {}}));
  assert.equal(calls, 3);
  assert.equal(await latestMail('test-account-a@jobpilotto.top', {key: 'k', fetchImpl: answer([]), waitMs: 0}), null);
});

test('the key comes from JP_SITE_API_KEY first, then the Keychain', () => {
  assert.equal(siteKey({JP_SITE_API_KEY: 'ci'}, () => { throw new Error('no'); }), 'ci');
  assert.equal(siteKey({}, () => 'kc\n'), 'kc');
  assert.equal(siteKey({}, () => { throw new Error('none'); }), '');
});
