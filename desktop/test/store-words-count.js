// Counts a window file's hard-coded "Notion" sentences (test/store-words.test.js). Sentences about Notion itself (connecting it,
// opening a Notion page, its benefits) don't count.
import fs from 'node:fs';
import path from 'node:path';

const ABOUT_NOTION = /connect notion|connect with notion|in notion ↗|open .*in notion|notion ↗|notion's own|notion workspace|notion page links|notion \(|notion:|move (my|your) data to notion|moving your data to notion|moved to notion|your notion already had|needs notion/i;
export function count(source) {
  let n = 0;
  for (const line of source.split('\n')) {
    if (/^\s*\/\//.test(line) || /byStore\(/.test(line)) continue;   // byStore(notion, mac): the Notion sentence is said only with Notion
    for (const quoted of line.match(/'[^']*Notion[^']*'|`[^`]*Notion[^`]*`|"[^"]*Notion[^"]*"/g) || []) {
      if (!ABOUT_NOTION.test(quoted) && !/NOTION_|notion_url|openNotion|notion\.so/.test(quoted)) n++;
    }
  }
  return n;
}
// Every window file and its count (the connect prompt and the helper itself are about Notion).
export function counts(desktop) {
  const out = {};
  for (const dir of ['renderer', 'renderer/pages']) {
    for (const name of fs.readdirSync(path.join(desktop, dir)).filter(each => each.endsWith('.js'))) {
      const file = `${dir}/${name}`;
      if (/notion-(connect|benefits|connect-rules)\.js$|store-words\.js$/.test(file)) continue;
      const n = count(fs.readFileSync(path.join(desktop, file), 'utf8'));
      if (n) out[file] = n;
    }
  }
  return out;
}
