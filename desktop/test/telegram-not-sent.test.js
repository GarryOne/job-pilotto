// A blocked Telegram must not read as "Sent" or "connected": the run's telegram field says which (#1393, #1663).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fromRecord} from '../lib/run-rows.js';
import {telegramHealth} from '../renderer/run-status.js';

// Every value src/daily_search.py stores in run['telegram'] and whether it is a send.
const ENGINE_VALUES = [['sent 2 message(s), 5 new', true], ['nothing new; not sent', false], ['not sent: Telegram refused it', false], ['not sent: the e-mail was refused', false]];

test('only a real send is "Sent to Telegram"', () => {
  for (const [said, sent] of ENGINE_VALUES) {
    const run = fromRecord({id: 'r1', started_at: '2026-10-22T08:00:00Z', finished_at: '2026-10-22T08:01:00Z', status: 'Completed', mode: 'scheduled', stats: {telegram: said}});
    assert.equal(run.telegram, sent, said);
    assert.equal(run.telegramNote, said);
  }
});

test('the Actions bar: refused is blocked, a send is ok, no attempt says nothing', () => {
  const refused = {ok: true, telegram: false, telegramNote: 'not sent: Telegram refused it'};
  const sent = {ok: true, telegram: true, telegramNote: 'sent 1 message(s), 1 new'};
  assert.equal(telegramHealth([refused, sent]), 'blocked');   // newest first
  assert.equal(telegramHealth([sent, refused]), 'ok');
  assert.equal(telegramHealth([{ok: true, telegram: false, telegramNote: 'nothing new; not sent'}, refused]), 'blocked');
  assert.equal(telegramHealth([{ok: true, telegram: false, telegramNote: ''}]), null);
  assert.equal(telegramHealth([{ok: true, log: ['Warning: Telegram refused the digest: the bot was blocked by the user.']}]), 'blocked');
});
