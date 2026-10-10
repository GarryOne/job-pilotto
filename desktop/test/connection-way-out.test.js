// Owner, 7 Oct 2026: "there is no way for me to disconnect from Gmail", then Telegram. Every connection that signs in to a service you can
// leave has a red way-out button, drawn the same way. Notion is left out on purpose for now (it holds your data: its own decision).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../renderer/pages/connections.js', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');
const WAYS_OUT = {google: 'Disconnect Gmail', telegram: 'Disconnect Telegram', cloud: 'Turn off Always on', 'tg-cloud': 'Turn off Telegram buttons'};

test('each connection has its slot and a red way-out button in it', () => {
  for (const [id, label] of Object.entries(WAYS_OUT)) {
    assert.match(html, new RegExp(`id="${id}-more" hidden`), id);
    assert.match(js, new RegExp(`\\$\\('${id}-more'\\)\\.replaceChildren\\([^\\n]*wayOut\\('${label}'`), id);
  }
});

test('the disconnects reach the main process', () => {
  for (const name of ['googleDisconnect', 'telegramDisconnect', 'cloudOff', 'telegramCloudOff']) assert.match(preload, new RegExp(`${name}: call\\('${name}'\\)`), name);
});
