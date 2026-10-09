// A page rewrite keeps the blocks its Markdown cannot say: the Profile's 📎 CV file, a child page (⚙️ Search settings), a linked database.
// A toggle is text (Markdown-ish, the engine's writer replaces it too) and is rewritten as before. The strategy save rewrites the Profile page with writePage; a delete of those blocks would lose the person's CV on Notion.
// Model: src/stores/notion_texts.py KEPT. Guards desktop/lib/notion-write.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {KEPT as KEPT_TYPES, rewriteTuning, writePage} from '../lib/notion-write.js';

// A page with text and non-text blocks; GET/PATCH/DELETE like Notion (append after a block or at the end).
function page(initial, {dropFirstAppend = false} = {}) {
  let next = 100;
  const blocks = initial.map((b, k) => ({id: `k${k}`, has_children: false, ...b}));
  const deleted = [];
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : {};
    let data = {};
    if (init.method === 'GET' && route.endsWith('/children')) data = {results: blocks.map(b => ({...b})), has_more: false};
    else if (init.method === 'PATCH' && route.endsWith('/children')) {
      if (dropFirstAppend) { dropFirstAppend = false; return {ok: true, json: async () => ({results: []})}; }   // the patch does not read back
      const added = body.children.map(child => ({id: `n${next++}`, has_children: false, ...child}));
      const at = body.after ? blocks.findIndex(b => b.id === body.after) + 1 : blocks.length;
      blocks.splice(at, 0, ...added);
      data = {results: added.map(b => ({id: b.id}))};
    } else if (init.method === 'DELETE') {
      const at = blocks.findIndex(b => `blocks/${b.id}` === route);
      if (at >= 0) deleted.push(blocks.splice(at, 1)[0].type);
    } else if (init.method === 'GET' && route.startsWith('blocks/')) data = {archived: false};
    return {ok: true, json: async () => data};
  };
  return {blocks, deleted, fetcher};
}
const text = (type, content) => ({type, [type]: {rich_text: [{type: 'text', text: {content}, plain_text: content, annotations: {}}]}});
const KEPT = [
  {type: 'file', file: {type: 'file', name: 'CV.pdf'}},
  {type: 'child_page', child_page: {title: '⚙️ Search settings'}},
  {type: 'child_database', child_database: {title: 'Jobs'}},
  {type: 'image', image: {type: 'external'}},
];

test('the kept block types are the engine\'s (src/stores/notion_texts.py KEPT)', () => {
  const python = fs.readFileSync(new URL('../../src/stores/notion_texts.py', import.meta.url), 'utf8');
  const listed = /KEPT = \(([^)]*)\)/.exec(python)[1].match(/'([a-z_]+)'/g).map(word => word.slice(1, -1));
  assert.deepEqual([...KEPT_TYPES].sort(), listed.sort());
});

for (const [label, markdown, options] of [
  ['a small change (patched)', '# Profile\n- Zurich\n- Senior SRE\n'],
  ['a new first block (rewritten whole)', '## New top\n# Profile\n- Basel\n'],
  ['a patch that does not read back (rewritten whole)', '# Profile\n- Zurich\n- Senior SRE\n', {dropFirstAppend: true}],
]) {
  test(`writePage keeps the file, child page, database and image: ${label}`, async () => {
    rewriteTuning.waitMs = 0;
    const p = page([text('heading_1', 'Profile'), KEPT[0], text('bulleted_list_item', 'Zurich'), KEPT[1], KEPT[2],
      text('bulleted_list_item', 'Engineer'), KEPT[3], text('toggle', 'Old notes')], options);
    await writePage('t', `page-${label}`, markdown, p.fetcher);
    assert.deepEqual(p.deleted.filter(type => KEPT.some(k => k.type === type)), [], `deleted: ${p.deleted.join(', ')}`);
    for (const kept of KEPT) assert.ok(p.blocks.some(b => b.type === kept.type), `${kept.type} is still on the page`);
    const said = p.blocks.filter(b => !KEPT.some(k => k.type === b.type)).map(b => b[b.type].rich_text[0].text.content);
    assert.deepEqual(said, markdown.trim().split('\n').map(line => line.replace(/^#+\s|^-\s/, '')));
  });
}
