// The redesigned site (owner, 20 Oct 2026: a landing 80% shorter, the detail spread over its own pages, reached from the menu or "More info"):
// every page shares one menu and footer, Mac and Windows downloads are equal wherever one is offered, old landing links still land, the frozen
// /old/ copy stays out of search, and the sitemap lists every public page. Loops over the files, so a page added later is checked too.
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../public/', import.meta.url);
const read = name => readFileSync(new URL(name, dir), 'utf8');
const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
const UNLISTED = ['friends.html', 'ready-live.html'];   // a page for early testers and the hand-off page the app opens: linked, never indexed
const NO_MENU = ['ready-live.html'];
const nav = html => (html.match(/<nav class="topnav[\s\S]*?<\/nav>/) || [''])[0].replace(/ aria-current="page"/g, '');
const foot = html => (html.match(/<footer class="site-foot"[\s\S]*?<\/footer>/) || [''])[0];
const pageOf = href => href.replace(/#.*$/, '').replace(/^\/$/, '/index').replace(/^\//, '') + '.html';

test('every page with a menu has the landing\'s menu, word for word, and marks where you are', () => {
  const menu = nav(read('index.html'));
  assert.match(menu, /href="\/download">Download<\/a>/);
  for (const name of pages.filter(page => !NO_MENU.includes(page))) {
    assert.equal(nav(read(name)), menu, `${name}: the menu differs from the landing's`);
    const here = `/${name.replace(/\.html$/, '')}`;
    if (menu.match(/<div class="links">[\s\S]*?<\/div>/)[0].includes(`href="${here}"`)) assert.match(read(name), new RegExp(`<a href="${here}" aria-current="page">`), `${name}: not marked`);
  }
});

test('every listed page has the landing\'s footer, and loads the shared script', () => {
  const footer = foot(read('index.html'));
  assert.ok(footer, 'the landing has a footer');
  for (const name of pages.filter(page => !UNLISTED.includes(page))) assert.equal(foot(read(name)), footer, `${name}: the footer differs`);
  for (const name of pages.filter(page => !NO_MENU.includes(page))) assert.match(read(name), /<script src="\/?site\.js"/, name);
});

test('Mac and Windows downloads are equally visible wherever a download is offered (owner, 20 Oct 2026)', () => {
  const link = /<a ([^>]*?)href="\/download\/(mac|windows)\?from=([\w-]+)"[^>]*>/g;
  for (const name of pages) {
    const seen = {};
    for (const [, before, os, from] of read(name).matchAll(link)) {
      const look = (before.match(/class="([^"]*)"/) || [, 'plain'])[1];
      (seen[`${from} ${look}`] ||= {mac: 0, windows: 0})[os]++;
    }
    for (const [where, count] of Object.entries(seen)) assert.equal(count.mac, count.windows, `${name}: ${where} offers Mac ${count.mac}x, Windows ${count.windows}x`);
  }
});

test('every section of the old landing still lands: its anchor sends the visitor to the page and section it moved to', () => {
  const script = read('site.js');
  const map = Object.fromEntries([...script.match(/const MOVED = \{([\s\S]*?)\};/)[1].matchAll(/'?([\w-]+)'?: '([^']+)'/g)].map(m => [m[1], m[2]]));
  const kept = [...read('index.html').matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  for (const [, id] of read('old/index.html').matchAll(/<section[^>]* id="([^"]+)"/g)) assert.ok(map[id] || kept.includes(id), `#${id} of the old landing goes nowhere`);
  for (const [id, to] of Object.entries(map)) {
    assert.ok(existsSync(new URL(pageOf(to), dir)), `#${id} -> ${to}: no such page`);
    const section = to.split('#')[1];
    if (section) assert.match(read(pageOf(to)), new RegExp(` id="${section}"`), `#${id} -> ${to}: no such section`);
  }
  assert.match(read('index.html'), /<body[^>]* data-page="home"/);
});

test('every picture and video a page shows exists (the media set is placed by file name, so a renamed file fails here)', () => {
  for (const name of pages) {
    for (const [, path] of read(name).matchAll(/(?:src|poster)="(\/?(?:media|images)\/[^"]+)"/g)) {
      assert.ok(existsSync(new URL(path.replace(/^\//, ''), dir)), `${name}: ${path} is missing`);
    }
  }
});

test('the frozen /old/ copy stays out of search: every page noindex, no canonical, and robots.txt says so', () => {
  const old = readdirSync(new URL('old/', dir)).filter(name => name.endsWith('.html'));
  assert.ok(old.includes('index.html'));
  for (const name of old) {
    const html = read(`old/${name}`);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/, `old/${name}`);
    assert.doesNotMatch(html, /rel="canonical"/, `old/${name}`);
  }
  const robots = read('robots.txt');
  assert.match(robots, /^Disallow: \/old\/$/m);
  assert.doesNotMatch(robots, /Disallow: \/intelligence/);   // a leftover from the owner's old private dashboard; the page is public
});

test('the sitemap lists every public page, and only pages that exist', () => {
  const listed = [...read('sitemap.xml').matchAll(/<loc>https:\/\/www\.jobadabra\.top(\/[^<]*)<\/loc>/g)].map(m => pageOf(m[1]));
  assert.deepEqual([...listed].sort(), pages.filter(page => !UNLISTED.includes(page)).sort());
});

test('the landing stays short: one hero, the numbers, three steps, control, one closing download', () => {
  const html = read('index.html');
  assert.equal((html.match(/<section\b/g) || []).length, 4, 'sections on the landing');   // numbers, steps, control, start; the hero is a header
  assert.equal((html.match(/More info →/g) || []).length, 3);
  for (const href of html.matchAll(/href="(\/[\w-]*)(?:#[\w-]+)?"/g)) {
    if (/^\/(download|install|api)\b/.test(href[1])) continue;
    assert.ok(existsSync(new URL(pageOf(href[1]), dir)), `link to missing page ${href[1]}`);
  }
});
