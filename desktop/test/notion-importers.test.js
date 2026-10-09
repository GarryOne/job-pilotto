// Notion optional (lib/store): a desktop/lib file that calls Notion directly is either about Notion itself (connecting, the workspace,
// the move, a Notion-only path behind "Notion is the store") and says so at its import, or it must go through lib/store. A new
// importer without a reason fails here, so the person's data never slips back to Notion-only code. Paired with
// store-one-copy.test.js (the guards behind those paths) and the store adapters' own tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const lib = path.join(import.meta.dirname, '..', 'lib');
// The Notion client and its parts, and the store's own Notion adapter: they are Notion.
const IS_NOTION = /^(notion(-[a-z]+)?\.js|store\/notion(-[a-z]+)?\.js)$/;
const NOTION_IMPORT = /^import [^\n]*from '\.\/notion(-(read|write|core|workspace|oauth|pace))?\.js';[^\n]*$/gm;
// Each importer, and why it may call Notion directly (one line at its import: "// Notion-only: <why>").
const NOTION_ONLY = {
  'files.js': 'CV uploads, only when Notion is the store', 'goals.js': "a goal's row on the Notion Profile",
  'migrate.js': "this Mac's data into a Notion that is the store", 'run-history.js': 'copyLocal into a connected Notion',
  'schema.js': 'workspace repair', 'server-env.js': "the extension's Notion calls when Notion is the store",
  'session-runs.js': 'the Agent Runs row when Notion is the store', 'settings-deps.js': 'the ⚙️ Search settings page writer',
  'setup-handlers.js': 'connecting Notion', 'store-move.js': "the move's Notion side", 'strategy-draft-handlers.js': 'the strategy into Notion pages',
  'strategy-settings.js': 'texts and settings page when Notion is the store', 'system-handlers.js': 'the workspace archive on a reset',
  'transcript.js': "the conversation toggle's format",
};

test('every desktop/lib file that imports the Notion client is on the Notion-only list and says why at its import', () => {
  const found = {};
  for (const name of fs.readdirSync(lib).filter(file => file.endsWith('.js') && !IS_NOTION.test(file))) {
    const imports = fs.readFileSync(path.join(lib, name), 'utf8').match(NOTION_IMPORT) || [];
    if (imports.length) found[name] = imports;
  }
  const unlisted = Object.keys(found).filter(name => !NOTION_ONLY[name]);
  assert.deepEqual(unlisted, [], 'a new Notion caller: go through lib/store (openStore pages/runs, the engine), or list it here with its reason');
  const unsaid = Object.entries(found).filter(([, imports]) => imports.some(line => !/\/\/ Notion-only: \S/.test(line))).map(([name]) => name);
  assert.deepEqual(unsaid, [], 'say why at the import: // Notion-only: <why>');
  const gone = Object.keys(NOTION_ONLY).filter(name => !found[name]);
  assert.deepEqual(gone, [], 'no longer a Notion caller: take it off the list');
});
