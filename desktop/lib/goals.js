// The setup goals (level, work mode, minimum salary, languages), corrected on the Strategy page as the setup review does (owner, 7 Oct 2026:
// the page lacked them). Each one is its own place in the Profile: a table row ("Work mode | …") or a line ("Minimum acceptable: …"), the
// rows renderer/markdown-edit.js GOAL_ROWS names. Only that block is written; a Profile without it gets the value under "Confirmed during
// setup", as the review does. When Notion isn't the store (trying, or the data on this Mac: lib/store), the Profile is profile.md on
// this Mac, the store's own file there (lib/store/text-files.js).
import {GOAL_ROWS, applyGoal} from '../renderer/markdown-edit.js';
import * as notion from './notion.js';   // Notion-only: a goal's own table row or line on the Notion Profile page
import {notionInUse} from './notion-gate.js';
import {TEXT_FILES} from './store/text-files.js';

export const GOALS = Object.keys(GOAL_ROWS);
const HEADING = 'Confirmed during setup';
const plainOf = items => (items || []).map(item => item.plain_text || '').join('');
const label = text => text.replace(/\*\*/g, '').trim();

// The block that holds a goal in a page tree: {row, index} for a table row, {line, prefix} for a "Label: value" line, or null.
export function findGoal(blocks, key) {
  const row = GOAL_ROWS[key];
  let found = null;
  const walk = list => {
    for (const block of list || []) {
      if (found) return;
      if (block.type === 'table_row' && row.match.test(label(plainOf(block.table_row.cells[0])))) { found = {row: block, index: 1}; return; }
      const rich = block[block.type]?.rich_text;
      if (rich && row.line) {
        const m = plainOf(rich).match(/^(\s*\**[^:]*?\**)\s*:/);
        if (m && row.match.test(label(m[1]))) { found = {line: block, prefix: label(m[1])}; return; }
      }
      walk(block.children);
    }
  };
  walk(blocks);
  return found;
}

export async function setGoal(storage, key, value, {fetcher, lib = notion} = {}) {
  if (!GOAL_ROWS[key]) throw new Error('Not a goal the Strategy page edits');
  const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) throw new Error('Write a value first');
  const token = storage.secret('NOTION_TOKEN'), page = storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID;
  if (!notionInUse(storage) || !token || !page) {   // the Profile is kept on this Mac (trying, or the store there)
    storage.writeText(TEXT_FILES.profile, applyGoal(storage.readText(TEXT_FILES.profile) || '', key, text));
    return {ok: true, where: 'local'};
  }
  const tree = await lib.pageTree(token, page, fetcher, {cache: false});
  const at = findGoal(tree, key);
  if (at?.row) await lib.setRowCell(token, at.row, at.index, text, fetcher);
  else if (at?.line) await lib.setBlockText(token, at.line, `${at.prefix}: ${text}`, fetcher);
  else {
    const heading = tree.find(block => /^heading_/.test(block.type) && plainOf(block[block.type].rich_text).trim() === HEADING);
    const id = heading?.id || await lib.appendHeading(token, page, HEADING, fetcher);
    await lib.insertBulletsAfter(token, page, id, [`${GOAL_ROWS[key].label}: ${text}`], fetcher);
  }
  return {ok: true, where: at?.row ? 'row' : at?.line ? 'line' : 'added'};
}
