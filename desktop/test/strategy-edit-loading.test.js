// "Edit in Notion" on Strategy shows work while Notion opens (source-level check of the page wiring).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(here, '..', 'renderer', 'pages', file), 'utf8');

test('openInNotion returns the app call so callers can wait for it', () => {
  assert.match(read('notion-connect.js'), /return window\.pilot\.openNotion\(shared\.state\.notion\[key\]/);
});

test('Strategy "Edit in Notion" is disabled and relabelled while it opens', () => {
  const src = read('strategy.js');
  const handler = src.slice(src.indexOf("$('strategy-edit').addEventListener"), src.indexOf("$('strategy-jobs')"));
  assert.match(handler, /await openInNotion/);
  assert.match(handler, /disabled = true/);
  assert.match(handler, /Opening/);
  assert.match(handler, /finally/);
});
