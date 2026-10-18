// Turns docs/rules/desktop-ui.md into the page's rules sections: one per "## " heading, each with the [approved|legacy|proposed] marker its heading carries.
// A heading with no marker is "unmarked": the test (desktop/test/design-system-page.test.js) only lets that stand for headings listed as already on main.
export const STATUSES = ['approved', 'legacy', 'proposed'];
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// `code`, **bold** and [text](url) only; the rest is escaped text.
export function inline(text) {
  return esc(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+|[^)\s]+\.md[^)\s]*)\)/g, (_, label, url) => /^https?:/.test(url) ? `<a href="${url}" rel="noreferrer">${label}</a>` : label);
}
// "Cards: read → Edit [proposed]" -> {title: "Cards: read → Edit", status: "proposed"}; no marker -> status ''.
export function headingParts(line) {
  const match = /^(.*?)\s*\[(approved|legacy|proposed)\]\s*$/.exec(line.trim());
  return match ? {title: match[1], status: match[2]} : {title: line.trim(), status: ''};
}
// Markdown -> [{title, status, html}] ("# " title line and the lead paragraph go in the first section, named "Overview").
export function sections(markdown) {
  const out = [{title: 'Overview', status: '', lines: []}];
  for (const line of String(markdown).split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) out.push({...headingParts(heading[1]), lines: []});
    else out.at(-1).lines.push(line);
  }
  return out.map(({title, status, lines}) => ({title, status, html: body(lines)}));
}
function body(lines) {
  const html = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushList = () => { if (list) html.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`); list = null; };
  for (const raw of lines) {
    if (/^#\s/.test(raw)) continue;
    if (!raw.trim()) { flushPara(); flushList(); continue; }
    const bullet = /^\s{0,2}[-*]\s+(.*)$/.exec(raw);
    if (bullet) { flushPara(); (list ||= []).push(bullet[1]); continue; }
    if (list && /^\s+\S/.test(raw)) { list[list.length - 1] += ' ' + raw.trim(); continue; }
    flushList(); para.push(raw.trim());
  }
  flushPara(); flushList();
  return html.join('\n');
}
