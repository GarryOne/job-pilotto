// Finds every place in desktop/renderer that opens Notion: an openNotion( call, an openExternal( of a Notion/page URL, an href built from
// a Notion URL, a link/button/menu labelled "… in Notion" (JS), and an <a>/<button> with an id labelled "… in Notion" (index.html).
// Wording that only mentions Notion ("Saved in Notion", a toast) is not an entry point. Each one is keyed by file + its top-level function
// (JS) or file#id (HTML), so moving lines keeps the key. Used by notion-parity.test.js against notion-parity.js.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../renderer/', import.meta.url));
const SKIP = new Set(['gallery.js']);   // the component gallery: sample content, never shown to a person
const JS_ENTRY = [
  /\bopenNotion\(/,
  /openExternal\([^)]*(pageUrl|notion)/i,
  /href[^\n]*(notion_url|notionPageUrl|pageUrl)/,
  /(label:\s*|el\('(a|button)',[^)]*?)[`'"][^`'"]*in Notion/,
];
const TOP = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)|^(?:export\s+)?(?:const|let)\s+(\w+)\s*=/;
const comment = line => /^\s*(\/\/|\*|\/\*)/.test(line);

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
    ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

// A Notion page's URL read into a value, then opened some lines later in the same function (`const url = m.job?.notion_url; …
// openExternal(url)`): the Calendar's meeting click was such a dead click on a store without pages (9 Oct 2026), unseen by the line rules.
const NOTION_URL = /notion_url|notionUrl|notionPageUrl|pageUrl|notion\.(so|com)\//;
const OPENS = /\b(openExternal|openNotion|openPath|openUrl)\(/;

export function scanJs(file, text) {
  const found = [];
  let owner = '(module)', readsUrl = -1;
  text.split('\n').forEach((line, index) => {
    const top = TOP.exec(line);
    if (top) { owner = top[1] || top[2]; readsUrl = -1; }
    if (comment(line)) return;
    if (JS_ENTRY.some(pattern => pattern.test(line))) { found.push({key: `${file} ${owner}`, line: index + 1}); return; }
    if (NOTION_URL.test(line)) readsUrl = index;
    if (readsUrl >= 0 && OPENS.test(line)) found.push({key: `${file} ${owner}`, line: index + 1});
  });
  return found;
}

export function scanHtml(file, text) {
  const found = [];
  const element = /<(a|button)\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  for (let match; (match = element.exec(text));) {
    if (/in Notion/.test(match[3].replace(/<[^>]+>/g, ''))) found.push({key: `${file}#${match[2]}`, line: text.slice(0, match.index).split('\n').length});
  }
  return found;
}

// [{key, line}] for every entry point, in file order.
export function notionEntryPoints(root = ROOT) {
  return walk(root).filter(full => !SKIP.has(path.basename(full))).flatMap(full => {
    const file = path.relative(root, full).split(path.sep).join('/'), text = fs.readFileSync(full, 'utf8');
    return full.endsWith('.js') ? scanJs(file, text) : full.endsWith('.html') ? scanHtml(file, text) : [];
  });
}
