// A run is asked to send to Telegram (--send) only when Telegram is set up; the engine exits with an error otherwise (Sentry APP-3: the Focus reminder asked every user, 3 times a day).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {dailyArgs, mailArgs, deliveryReady, telegramReady} from '../lib/pipeline-args.js';

const storage = ({token = '', chat = ''} = {}) => ({secret: name => (name === 'TELEGRAM_BOT_TOKEN' ? token : ''), settings: () => ({telegramChatId: chat})});

test('telegramReady needs the token and the chat; the daily and Gmail commands follow it', () => {
  assert.equal(telegramReady(storage()), false);
  assert.equal(telegramReady(storage({token: 't'})), false);
  assert.equal(telegramReady(storage({token: 't', chat: '1'})), true);
  assert.ok(!dailyArgs(storage()).includes('--send') && dailyArgs(storage({token: 't', chat: '1'})).includes('--send'));
  assert.ok(!mailArgs(storage(), 3).includes('--send') && mailArgs(storage({token: 't', chat: '1'}), 3).includes('--send'));
});

test('every file that builds a --send command asks deliveryReady (a new one without it fails here)', () => {
  const lib = path.dirname(fileURLToPath(new URL('../lib/pipeline-args.js', import.meta.url)));
  const OWN = new Set(['background-handlers.js']);   // src.contribute --send posts to our site, not Telegram
  for (const name of fs.readdirSync(lib).filter(file => file.endsWith('.js') && !OWN.has(file))) {
    const source = fs.readFileSync(path.join(lib, name), 'utf8');
    if (!source.includes("'--send'")) continue;
    assert.match(source, /deliveryReady\(/, `${name} builds a --send command without checking that a channel (Telegram or e-mail) is set up`);
  }
});
