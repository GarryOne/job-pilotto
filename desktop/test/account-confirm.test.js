// The confirmation step after an account was made (lib/account-confirm.js): the mail is found by the address, its https link opened and the account marked
// confirmed; no mail, or only a code, leaves the person in charge; nothing private reaches the log.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmAccount, parseVerify} from '../lib/account-confirm.js';

const run = stdout => async args => { run.args = args; return {code: 0, stdout}; };
const deps = (stdout, extra = {}) => { const calls = {opened: [], marked: 0, logs: []}; return {calls, args: {host: 'career2.successfactors.eu', email: 'me+x@example.com', run: run(stdout), open: url => calls.opened.push(url), mark: () => { calls.marked++; }, log: (area, message, fields) => calls.logs.push([message, JSON.stringify(fields)]), ...extra}}; };

test('a mail with a confirm link: found by the address, the https link opened, the account marked confirmed', async () => {
  const {calls, args} = deps(JSON.stringify({code: '', links: ['https://career2.successfactors.eu/verify?t=SECRET']}));
  assert.equal(await confirmAccount(args), 'confirmed');
  assert.deepEqual(calls.opened, ['https://career2.successfactors.eu/verify?t=SECRET']);
  assert.equal(calls.marked, 1);
  assert.deepEqual(run.args.slice(0, 4), ['src.sources.google', 'verify', '--to', 'me+x@example.com']);
  assert.ok(!calls.logs.some(([message, fields]) => /SECRET|me\+x/.test(message + fields)), 'the link and the address never reach the log');
});

test('only a code, a non-https link, no mail or a failure: nothing is opened or marked', async () => {
  for (const stdout of [JSON.stringify({code: '483920', links: []}), JSON.stringify({code: '', links: ['http://insecure.example/x']}), JSON.stringify({error: 'no confirmation email yet'}), 'not json']) {
    const {calls, args} = deps(stdout);
    assert.notEqual(await confirmAccount(args), 'confirmed');
    assert.deepEqual([calls.opened.length, calls.marked], [0, 0]);
  }
  assert.equal(parseVerify('x\n{"code":"1","links":[]}').code, '1');
  assert.equal(await confirmAccount({host: '', email: '', run: async () => ({code: 1})}), 'none');
});
