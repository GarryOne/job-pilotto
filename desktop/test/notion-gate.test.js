// Notion later: "connected" has one definition, and every gate answers with one result shape and a sentence per reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as gate from '../lib/notion-gate.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const make = ({token = false, profile = false} = {}) => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  if (token) storage.setSecret('NOTION_TOKEN', 'ntn_x');
  if (profile) storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
  return storage;
};

test('connected needs both the token and the Profile page', () => {
  assert.equal(gate.connected(make()), false);
  assert.equal(gate.connected(make({token: true})), false);
  assert.equal(gate.connected(make({profile: true})), false);
  assert.equal(gate.connected(make({token: true, profile: true})), true);
});

test('needs() has one shape and a sentence for every reason', () => {
  for (const reason of Object.keys(gate.REASONS)) {
    const result = gate.needs(reason);
    assert.equal(result.ok, false);
    assert.equal(result.needsNotion, true);
    assert.equal(result.reason, reason);
    assert.equal(result.text, `Connect Notion ${gate.REASONS[reason]}.`);
    assert.equal(result.error, result.text);  // callers that read .error show the same sentence
  }
  for (const key of ['save', 'dismiss', 'prepare', 'apply', 'applied', 'add', 'lead', 'log', 'interviews', 'focus', 'cloud', 'telegram', 'gmail', 'profile']) {
    assert.ok(gate.REASONS[key], key);
  }
});

test('statusReason maps a job status to the reason shown', () => {
  assert.equal(gate.statusReason('saved'), 'save');
  assert.equal(gate.statusReason('dismissed'), 'dismiss');
  assert.equal(gate.statusReason('applied'), 'applied');
  assert.equal(gate.statusReason('new'), null);  // not a Notion stage: no gate
});

test('check() gives null when connected or in demo mode, else the result', () => {
  assert.equal(gate.check(make({token: true, profile: true}), 'save'), null);
  assert.equal(gate.check(make(), 'save', {demo: true}), null);
  assert.deepEqual(gate.check(make(), 'save'), gate.needs('save'));
});

test('gateEvent keeps only values from fixed lists, and why only with not_now', () => {
  const ok = gate.gateEvent({reason: 'save', where: 'dialog', outcome: 'not_now', why: 'privacy'}, {firstRunAt: '2026-10-03T10:00:00Z', shown: 2, now: Date.parse('2026-10-03T10:30:00Z')});
  assert.deepEqual(ok, {step: 'notion_gate', reason: 'save', where: 'dialog', outcome: 'not_now', why: 'privacy', minutes: 30, shown: 3});
  // why is dropped unless the outcome is not_now
  assert.equal(gate.gateEvent({reason: 'save', where: 'dialog', outcome: 'connected', why: 'privacy'}).why, undefined);
  // unknown values are dropped (the whole event when reason/where/outcome are unknown), and free text never passes
  assert.equal(gate.gateEvent({reason: 'my job at Acme', where: 'dialog', outcome: 'closed'}), null);
  assert.equal(gate.gateEvent({reason: 'save', where: 'elsewhere', outcome: 'closed'}), null);
  assert.equal(gate.gateEvent({reason: 'save', where: 'dialog', outcome: 'refused'}), null);
  assert.equal(gate.gateEvent({reason: 'save', where: 'dialog', outcome: 'not_now', why: 'Acme is evil'}).why, undefined);
  assert.equal(gate.gateEvent({reason: 'toString', where: 'dialog', outcome: 'closed'}), null);
  assert.equal(gate.gateEvent(null), null);
  // extras and settings have no action: reason none
  assert.equal(gate.gateEvent({reason: 'none', where: 'extras', outcome: 'connected'}).reason, 'none');
  assert.equal(gate.gateEvent({reason: 'save', where: 'dialog', outcome: 'closed'}).minutes, null);  // no first start known
});
