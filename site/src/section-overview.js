// The Overview tab of an admin section (owner, 18 Oct 2026): each page of the section declares its 2-4 headline numbers in src/headlines.js, this file draws them as tiles
// (a number, what it counts, a weekly bar chart when there is one, a status dot, a link to the page). Same weekly series and bars as the /admin Overview (src/admin.js).
// A number that cannot be judged says so (few: true -> "Too few", with its counts underneath). No AI; each loader reads rows or one snapshot the page already has. Guard: test/section-overview.test.js.
import {PAGES, spark} from './admin.js';
import {esc, remember} from './stats.js';
import {viewer} from './auth.js';
import {HEADLINES} from './headlines.js';

export const STATUS = {good: 'g', warn: 'w', bad: 'b', none: 'n'};
// The pages of a section that must declare headline numbers: every page of the group but its Overview and the super-admin Access page.
export const groupOf = path => PAGES.find(page => page.path === path)?.group;
export const headlinePages = group => PAGES.filter(page => page.group === group && !page.superadmin && !page.overview);

// {label, value, sub, status: good|warn|bad|none, series?: weekly numbers, format?, few?, placeholder?, href}
const draw = tile => {
  const known = (tile.series || []).filter(v => v != null);
  return `<div class="tile${tile.few ? ' few' : ''}${tile.placeholder ? ' dash' : ''}"><div class="k"><span class="dot ${STATUS[tile.status] || 'n'}"></span>${esc(tile.label)}</div>
<div class="v">${esc(tile.value)}</div>${tile.sub ? `<div class="s">${esc(tile.sub)}</div>` : ''}
${known.length >= 2 ? `<div class="trend2">${spark(tile.series, {format: tile.format, higherIsBetter: tile.higherIsBetter !== false, width: 120, height: 26})}</div>` : ''}
<a href="${esc(tile.href)}">${esc(tile.page)} →</a></div>`;
};
export const SECTION_STYLE = `.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
.tile{background:#14181d;border:1px solid #262c33;border-radius:12px;padding:14px;display:grid;gap:4px;min-width:0;align-content:start}.tile.dash{border-style:dashed}
.tile .k{font-size:12px;color:#8d949c;display:flex;gap:6px;align-items:center}.tile .v{font-size:30px;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums}.tile.few .v{color:#8d949c}
.tile .s{font-size:12px;color:#8d949c}.tile .trend2{display:flex;align-items:center;gap:8px;font-size:12px;color:#8d949c}.tile .trend2 svg{flex:none}.tile .trend2 .up{color:#3fb68b}.tile .trend2 .down{color:#e5484d}
.tile a{font-size:12px;text-decoration:none}.dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}.dot.g{background:#3fb68b}.dot.w{background:#e0a43a}.dot.b{background:#e5484d}.dot.n{background:#8d949c}`;

// The tiles of every page of a section, in menu order; a loader that fails shows its page as a grey "not available" tile, never an error page.
export async function sectionTiles(env, group, now = new Date()) {
  const lists = await Promise.all(headlinePages(group).map(async page => {
    try { return (await HEADLINES[page.path](env, now)).map(tile => ({...tile, href: tile.href || page.path, page: page.name})); }
    catch { return [{label: page.name, value: '–', sub: 'not available right now', status: 'none', href: page.path, page: page.name}]; }
  }));
  return lists.flat();
}
export const tilesHtml = tiles => `<style>${SECTION_STYLE}</style><div class="tiles">${tiles.map(draw).join('')}</div>`;

// The Overview page of a section that has no page of its own (Form filling, Growth, Intelligence): its tiles under the menu's title and question (src/admin.js adds the menu).
export const overviewPage = (tiles, {title, icon}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Admin</title>
<link rel="icon" href="/favicon-32.png"></head><body><main><header><h1>${icon} ${esc(title)}</h1><span class="muted">each tile is one page's headline number: open the page for the detail</span></header>${tilesHtml(tiles)}</main></body></html>`;
export const overviewView = (path, title) => async (request, env, now = new Date()) => {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const page = PAGES.find(item => item.path === path);
  return new Response(overviewPage(await sectionTiles(env, page.group, now), {title, icon: page.icon}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
};
