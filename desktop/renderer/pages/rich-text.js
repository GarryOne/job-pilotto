// Claude's messages as readable text.
import {el} from '../components.js';

// A link in Claude's message: its words (a bare Notion or web address gets a short name), opening Notion where you're
// signed in (⌘-click: the app's own Notion window), anything else in the browser.
function messageLink(words, url) {
  const notion = /(^|\.)notion\.(so|site|com)$/i.test((() => { try { return new URL(url).hostname; } catch { return ''; } })());
  const text = words || (notion ? 'Open in Notion' : url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40));
  const link = Object.assign(el('a', 'link', `${text} ↗`), {href: '#', title: url});
  link.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();  // a link inside a row that unfolds: open the link, don't fold the row
    if (notion) window.pilot.openNotion(url, event.metaKey); else window.pilot.openExternal(url);
  });
  return link;
}
// Claude's message, readable: paragraphs, bullet and numbered lists, **bold** and `code` (built as DOM, never HTML).
export function richText(text) {
  const inline = line => {
    const nodes = [];
    for (const part of String(line).split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/)) {
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/) || (/^https?:\/\//.test(part) ? [part, '', part] : null);
      if (link) { nodes.push(messageLink(link[1], link[2])); continue; }
      if (/^\*\*[^*]+\*\*$/.test(part)) nodes.push(el('b', '', part.slice(2, -2)));
      else if (/^`[^`]+`$/.test(part)) nodes.push(el('code', '', part.slice(1, -1)));
      else if (part) nodes.push(document.createTextNode(part));
    }
    return nodes;
  };
  const blocks = [];
  let list = null;
  for (const raw of String(text).split(/\n/)) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!list) { list = el(/^\d/.test(line) ? 'ol' : 'ul', 'rich-list'); blocks.push(list); }
      const li = el('li');
      li.append(...inline(item[1]));
      list.append(li);
      continue;
    }
    list = null;
    if (!line) continue;
    const p = el('p', 'rich-p');
    p.append(...inline(line.replace(/^#+\s*/, '')));
    blocks.push(p);
  }
  return blocks;
}
