// The Notion store, desktop side: the user's text pages (Profile, standard answers, 🧠 Form knowledge) as pages of blocks, through
// today's lib/notion-* calls unchanged. lib/store/index.js opens it; screens and modules never import it. Spec:
// docs/superpowers/specs/2026-10-09-store-adapters.md. Guarded by desktop/test/store-contract.test.js (against test/fake-notion.js).
import * as learn from '../learn.js';
import * as notion from '../notion.js';
import {CLOUD, FILES, LINKS} from './caps.js';
import * as notionRuns from './notion-runs.js';

export const NAME = 'notion';
export const CAPS = new Set([LINKS, CLOUD, FILES]);

// Each text and its page id in settings.notionIds. Form knowledge is made beside the Profile on its first write (lib/knowledge.js did).
const PAGE_IDS = {profile: 'NOTION_PROFILE_PAGE_ID', answers: 'NOTION_ANSWERS_PAGE_ID', knowledge: 'NOTION_KNOWLEDGE_PAGE'};
const MISSING = {
  profile: 'Connect Notion first: your contact details live in your Profile page.',
  answers: 'Connect Notion first: your questions live in the standard answers page.',
  knowledge: 'Connect Notion first: form knowledge lives there.',
};
const KNOWLEDGE_INTRO = 'What Job Pilotto learned from your form fills, used by every later kit and fill. Fix or delete a line to change what it does.';

const plain = rich => (rich || []).map(t => t.plain_text || '').join('');
// A Notion block → the page item every adapter gives: {id, type, text} or a table {id, type: 'table', header, rows: [{id, cells, raw}]}.
function item(block) {
  if (block.type === 'table') {
    return {id: block.id, type: 'table', header: !!block.table?.has_column_header,
      rows: (block.children || []).filter(row => row.type === 'table_row').map(row => ({id: row.id, type: 'table_row', cells: (row.table_row?.cells || []).map(plain), raw: row}))};
  }
  const each = {id: block.id, type: block.type, text: plain(block[block.type]?.rich_text)};
  if (block.children && block.type !== 'table') each.children = block.children.map(item);
  return each;
}

export function open(storage, {fetcher} = {}) {
  const token = () => storage.secret('NOTION_TOKEN');
  const ids = () => storage.settings().notionIds || {};
  const target = name => {
    const t = token(), connected = !!ids().NOTION_PROFILE_PAGE_ID;
    if (!t || !connected) throw new Error(MISSING[name] || 'Connect Notion first.');
    return {token: t, page: ids()[PAGE_IDS[name]] || null};
  };
  // The knowledge page is made on the first write, beside the Profile, and remembered.
  const writable = async name => {
    const t = target(name);
    if (t.page || name !== 'knowledge') {
      if (!t.page) throw new Error(MISSING[name]);
      return t;
    }
    const page = await notion.ensurePage(t.token, ids().NOTION_PROFILE_PAGE_ID, learn.PAGE_TITLE, KNOWLEDGE_INTRO, fetcher);
    storage.saveSettings({notionIds: {...ids(), NOTION_KNOWLEDGE_PAGE: page}});
    return {token: t.token, page};
  };
  const readable = name => {
    const t = target(name);
    return t.page ? t : null;
  };

  const page = name => ({
    async blocks() {
      const t = readable(name);
      return t ? notion.textBlocks(t.token, t.page, fetcher) : [];
    },
    // Top-level items in order (tables with their rows, toggles with their children), read fresh: the ❓ lists must see an answer at once.
    async outline() {
      const t = readable(name);
      return t ? (await notion.pageTree(t.token, t.page, fetcher, {cache: false})).map(item) : [];
    },
    async text() {
      const t = readable(name);
      return t ? notion.pageText(t.token, t.page, fetcher) : '';
    },
    async write(markdown, onProgress) {
      const t = await writable(name);
      return notion.writePage(t.token, t.page, markdown, fetcher, onProgress);
    },
    async setText(block, value) {
      const t = await writable(name);
      return notion.setBlockText(t.token, block, value, fetcher);
    },
    async remove(block) {
      const t = await writable(name);
      return notion.deleteBlock(t.token, block.id, fetcher);
    },
    async append(values) {
      const t = await writable(name);
      return notion.appendBullets(t.token, t.page, values, fetcher);
    },
    async insertAfter(blockId, values) {
      const t = await writable(name);
      return notion.insertBulletsAfter(t.token, t.page, blockId, values, fetcher);
    },
    async appendHeading(value) {
      const t = await writable(name);
      return notion.appendHeading(t.token, t.page, value, fetcher);
    },
    async setCell(row, index, value) {
      const t = await writable(name);
      return notion.setRowCell(t.token, row.raw, index, value, fetcher);
    },
  });

  const runs = {
    list: ({size} = {}) => notionRuns.list(storage, {fetcher, size}),
    close: (link, reason) => notionRuns.closeStopped(storage, link, reason, {fetcher}),
    detail: id => notionRuns.detail(storage, id, {fetcher}),
  };

  return {
    name: NAME, caps: CAPS, page, runs,
    // Where the user can open a record or page in Notion.
    link: id => (id ? notion.pageUrl(id) : null),
    textLink: name => (ids()[PAGE_IDS[name]] ? notion.pageUrl(ids()[PAGE_IDS[name]]) : null),
  };
}
