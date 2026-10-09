// Counts a window file's hard-coded "Notion" sentences (test/store-words.test.js). Sentences about Notion itself (connecting it,
// opening a Notion page, its benefits) don't count.
import fs from 'node:fs';
import path from 'node:path';

const ABOUT_NOTION = /connect notion|edit in notion|transcript in notion|connect with notion|in notion ↗|open .*in notion|notion ↗|notion's own|notion workspace|notion page links|notion \(|notion:|move (my|your) data to notion|moving your data to notion|moved to notion|your notion already had|needs notion/i;
export function count(source) {
  let n = 0;
  for (const line of source.split('\n')) {
    if (/^\s*\/\//.test(line) || /byStore\(|byWhere\(|\/\/ about Notion/.test(line)) continue;   // byStore(notion, mac): the Notion sentence is said only with Notion
    for (const quoted of line.match(/'[^']*Notion[^']*'|`[^`]*Notion[^`]*`|"[^"]*Notion[^"]*"/g) || []) {
      // "Notion" as a word: a quote that only spans code between two strings (`inNotion ? '`, `openInNotion('`) is no sentence.
      if (/(^|[^A-Za-z])Notion/.test(quoted) && !ABOUT_NOTION.test(quoted) && !/NOTION_|notion_url|openNotion|notion\.so/.test(quoted)) n++;
    }
  }
  return n;
}
// index.html's static text: per line, the visible words and the title / placeholder / aria-label a person reads. A line the page
// already handles (data-notion-only: shown only with Notion; data-store-saved: its words set by the store) does not count.
export function countHtml(source) {
  let n = 0;
  for (const line of source.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    if (/data-notion-only|data-store-saved|data-about-notion/.test(line)) continue;
    const said = [...line.matchAll(/\b(?:title|placeholder|aria-label)="([^"]*)"/g)].map(match => match[1]);
    said.push(line.replace(/<[^>]*>/g, ' ').replace(/<[a-zA-Z\/][^>]*$/, ' '));
    if (said.some(text => /(^|[^A-Za-z])Notion/.test(text) && !ABOUT_NOTION.test(text))) n++;
  }
  return n;
}
// Every window file and its count (the connect prompt and the helper itself are about Notion).
export function counts(desktop) {
  const out = {};
  for (const dir of ['renderer', 'renderer/pages']) {
    for (const name of fs.readdirSync(path.join(desktop, dir)).filter(each => each.endsWith('.js'))) {
      const file = `${dir}/${name}`;
      if (/notion-(connect|benefits|connect-rules)\.js$|store-(words|name)\.js$/.test(file)) continue;
      const n = count(fs.readFileSync(path.join(desktop, file), 'utf8'));
      if (n) out[file] = n;
    }
  }
  const html = countHtml(fs.readFileSync(path.join(desktop, 'renderer', 'index.html'), 'utf8'));
  if (html) out['renderer/index.html'] = html;
  return out;
}
