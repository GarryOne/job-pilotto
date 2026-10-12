// Store = Notion but Notion not connected (#410): the window and the app agree it is not tracking, and no page behind the Notion gate reads in the background.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {check} from '../lib/notion-gate.js';
import {storeState} from '../lib/store-handlers.js';
import {LOCKED_VIEWS} from '../renderer/notion-benefits.js';

const pages = path.join(import.meta.dirname, '..', 'renderer', 'pages');
const read = name => fs.readFileSync(path.join(pages, name), 'utf8');
const make = (settings = {}, token = '') => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-gw-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings(settings);
  if (token) storage.setSecret('NOTION_TOKEN', token);
  return storage;
};
const connected = {notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}};

test('the window is told the gate\'s own answer: tracking only when nothing would ask for Notion', () => {
  const states = {
    'trying (no store, no Notion)': make(),
    'Notion chosen, not connected': make({store: 'notion'}),
    'Notion chosen, token but no Profile page': make({store: 'notion'}, 't'),
    'Notion connected': make({store: 'notion', ...connected}, 't'),
    'this Mac': make({store: 'sqlite'}),
  };
  for (const [name, storage] of Object.entries(states)) {
    assert.equal(storeState(storage).tracking, check(storage, 'focus') === null, name);
  }
  assert.equal(storeState(make({store: 'notion'})).tracking, false);
});

test('the window\'s tracking() is the app\'s, not "a store was chosen"', () => {
  const gate = read('notion-connect.js');
  assert.match(gate, /export const tracking = \(\) => notionConnected\(\) \|\| shared\.state\?\.store\?\.tracking === true;/);
});

// Pages nav.js loads with "!locked": each loader returns at once while its page is behind the gate, so a background caller
// (a finished check, a saved answer, a dialog's Done) never reads it and never opens the connect prompt uninvited.
const NO_GATED_READ = {sessions: 'paints the sessions the app already has; reads nothing behind the gate'};
test('every page behind the Notion gate keeps its loader quiet while gated', () => {
  const nav = read('nav.js');
  const loaders = Object.fromEntries([...nav.matchAll(/if \(name === '(\w+)' && !locked[^)]*\) (\w+)\(/g)].map(match => [match[1], match[2]]));
  const files = fs.readdirSync(pages).filter(file => file.endsWith('.js'));
  for (const view of Object.keys(LOCKED_VIEWS)) {
    if (NO_GATED_READ[view]) continue;
    const loader = loaders[view];
    assert.ok(loader, `nav.js loads no page for "${view}" behind the gate: add its loader, or say why in NO_GATED_READ`);
    const file = files.find(each => new RegExp(`export (async )?function ${loader}\\(`).test(read(each)));
    assert.ok(file, `${loader} is not exported by a page`);
    const body = read(file).split(new RegExp(`export (?:async )?function ${loader}\\([^)]*\\) \\{\\n`))[1];
    assert.match(body.split('\n')[0], new RegExp(`^  if \\(gatedOut\\('${view}'\\)\\) return`), `${file} ${loader} reads "${view}" while it is behind the gate`);
  }
});
