// The session card's account record (renderer/session-state.js accountRecordLine; owner, 10 Oct 2026): "Account created on X · terms accepted: '…' · code from your email".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountRecordLine} from '../renderer/session-state.js';

const item = extra => ({kind: 'form', accountHost: 'careers.example.com', accountState: 'created', accountTerms: [], accountCode: false, ...extra});

test('the record says where the account was made, which terms were accepted and whether a code came from the mail', () => {
  assert.equal(accountRecordLine(item({})), 'Account created on careers.example.com');
  assert.equal(accountRecordLine(item({accountTerms: ['I accept the terms']})), 'Account created on careers.example.com · terms accepted: ‘I accept the terms’');
  assert.equal(accountRecordLine(item({accountTerms: ['Terms', 'Privacy'], accountCode: true})),
    'Account created on careers.example.com · terms accepted: ‘Terms’, ‘Privacy’ · code from your email');
  assert.equal(accountRecordLine(item({accountState: 'confirm'})), 'Account created on careers.example.com');
});

test('no record for an existing account, a refused sign-in, or no account at all', () => {
  for (const accountState of ['exists', 'refused', '']) assert.equal(accountRecordLine(item({accountState})), '');
  assert.equal(accountRecordLine(item({accountHost: ''})), '');
  assert.equal(accountRecordLine(null), '');
});
