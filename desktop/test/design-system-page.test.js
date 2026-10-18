// The design-system page and its snapshot (tools/design-system/build.mjs): built from the repository, the same bytes for the same inputs, every gallery section and rules heading
// classified approved / legacy / proposed (a new one cannot slip in as "approved"), the snapshot zip complete, and the deploy rebuilding the page whenever a source changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import zlib from 'node:zlib';
import {ROOT, SOURCES, build, closure, gallerySections, tokensOf} from '../../tools/design-system/build.mjs';
import {headingParts, inline, sections} from '../../tools/design-system/rules-html.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'design-system-'));
const tree = dir => Object.fromEntries(fs.readdirSync(dir, {recursive: true, withFileTypes: true}).filter(e => e.isFile()).map(e => {
  const file = path.join(e.parentPath ?? e.path, e.name);
  return [path.relative(dir, file).split(path.sep).join('/'), fs.readFileSync(file)];
}));
const status = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/renderer/design-status.json'), 'utf8'));
const VALID = ['approved', 'legacy', 'proposed'];

test('the same commit and date give the same bytes; another date changes only the lines that show it', () => {
  const a = tmp(), b = tmp(), c = tmp();
  build({out: a, commit: 'abc1234def', date: '2026-10-18'}); build({out: b, commit: 'abc1234def', date: '2026-10-18'}); build({out: c, commit: 'abc1234def', date: '2026-10-19'});
  const [x, y, z] = [tree(a), tree(b), tree(c)];
  assert.deepEqual(Object.keys(x), Object.keys(y));
  for (const name of Object.keys(x)) assert.ok(x[name].equals(y[name]), `${name} differs between two builds`);
  const changed = Object.keys(x).filter(name => !x[name].equals(z[name]));
  assert.deepEqual(changed.sort(), ['index.html', 'snapshot.zip']);
  for (const dir of [a, b, c]) fs.rmSync(dir, {recursive: true, force: true});
});

test('the header shows the source commit and the generation date; the page runs the real gallery, not a copy', () => {
  const out = tmp();
  build({out, commit: 'abc1234def', date: '2026-10-18'});
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /source commit <a [^>]*>abc1234<\/a> · generated 2026-10-18/);
  assert.match(html, /<script src="gallery\.js" type="module">/);
  assert.match(html, /beforeunload', event => event\.stopImmediatePropagation\(\), true/, 'the demo drafts must not hold the page');
  for (const file of ['r/gallery.js', 'r/components.js', 'r/tokens.css', 'r/components.css', 'r/card-shell.js', 'r/save-bar.js']) assert.ok(fs.existsSync(path.join(out, file)), file);
  assert.deepEqual(fs.readFileSync(path.join(out, 'r/components.js')), fs.readFileSync(path.join(ROOT, 'desktop/renderer/components.js')), 'the component file is the app\'s own, byte for byte');
  fs.rmSync(out, {recursive: true, force: true});
});

test('every gallery section is classified, and nothing classified is gone (a new section needs its status in the same change)', () => {
  const titles = gallerySections().map(item => item.title);
  assert.equal(new Set(titles).size, titles.length, 'two sections share a title');
  assert.deepEqual(titles.filter(title => !status.sections[title]), [], 'add the section to desktop/renderer/design-status.json with approved, legacy or proposed');
  assert.deepEqual(Object.keys(status.sections).filter(title => !titles.includes(title)), [], 'a section left the gallery: take it off the list');
  for (const [title, value] of Object.entries(status.sections)) assert.ok(VALID.includes(value), `${title}: ${value}`);
});

test('every rules heading carries [approved|legacy|proposed], or is listed as on main since 18 Oct 2026', () => {
  const parts = sections(fs.readFileSync(path.join(ROOT, 'docs/rules/desktop-ui.md'), 'utf8')).filter(part => part.title !== 'Overview');
  assert.deepEqual(parts.filter(part => !part.status && !status.rules[part.title]).map(part => part.title), [], 'tag the heading, e.g. "## Page blocks [proposed]"');
  for (const [title, value] of Object.entries(status.rules)) assert.ok(VALID.includes(value), `${title}: ${value}`);
});

test('the heading marker and the small markdown are read as written', () => {
  assert.deepEqual(headingParts('Page blocks [proposed]'), {title: 'Page blocks', status: 'proposed'});
  assert.deepEqual(headingParts('Cards: read → Edit'), {title: 'Cards: read → Edit', status: ''});
  assert.equal(inline('use `chip()` and **never** <b>'), 'use <code>chip()</code> and <b>never</b> &lt;b&gt;');
  const out = sections('# T\nlead\n\n## A [legacy]\n- one\n  more\n- two\n');
  assert.equal(out[1].status, 'legacy');
  assert.match(out[1].html, /<li>one more<\/li><li>two<\/li>/);
});

test('every file the run imports is shipped, and tokens.json has both themes', () => {
  const out = tmp();
  build({out});
  for (const file of closure()) {
    const target = file.includes('/browser/') ? `b/${path.basename(file)}` : `r/${file.replace('desktop/renderer/', '')}`;
    assert.ok(fs.existsSync(path.join(out, target)), `${file} is not in the output`);
  }
  const tokens = tokensOf(fs.readFileSync(path.join(ROOT, 'desktop/renderer/tokens.css'), 'utf8'));
  assert.ok(tokens.light['--signal'] && tokens.light['--bg']);
  assert.ok(Object.keys(tokens.dark).length > 0, 'no dark values read');
  fs.rmSync(out, {recursive: true, force: true});
});

// A stored zip: read it back with the central directory.
function entries(zipBytes) {
  const end = zipBytes.length - 22;
  assert.equal(zipBytes.readUInt32LE(end), 0x06054b50);
  const count = zipBytes.readUInt16LE(end + 10);
  let at = zipBytes.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const size = zipBytes.readUInt32LE(at + 24), nameLength = zipBytes.readUInt16LE(at + 28), offset = zipBytes.readUInt32LE(at + 42), crc = zipBytes.readUInt32LE(at + 16);
    const name = zipBytes.subarray(at + 46, at + 46 + nameLength).toString();
    const start = offset + 30 + zipBytes.readUInt16LE(offset + 26) + zipBytes.readUInt16LE(offset + 28);
    const data = zipBytes.subarray(start, start + size);
    assert.equal(zlib.crc32(data), crc, `${name} crc`);
    out[name] = data;
    at += 46 + nameLength;
  }
  return out;
}
test('the snapshot holds the rules, tokens, components, shots and the source commit', () => {
  const out = tmp();
  build({out, commit: 'abc1234def', date: '2026-10-18'});
  const files = entries(fs.readFileSync(path.join(out, 'snapshot.zip')));
  for (const name of ['README.md', 'RULES.md', 'SKILL-ui-look-and-feel.md', 'tokens.css', 'tokens.json', 'components.md', 'SOURCE.txt']) assert.ok(files[name], name);
  assert.match(files['SOURCE.txt'].toString(), /commit: abc1234def\ngenerated: 2026-10-18/);
  assert.ok(Object.keys(files).filter(name => name.startsWith('shots/')).length >= 5);
  assert.ok(files['RULES.md'].equals(fs.readFileSync(path.join(ROOT, 'docs/rules/desktop-ui.md'))));
  assert.match(files['components.md'].toString(), /\*\*Card shell\*\* \[approved\]/);
  assert.ok(JSON.parse(files['tokens.json']).light['--bg']);
  fs.rmSync(out, {recursive: true, force: true});
});

test('the site deploy rebuilds the page when any source changes, and serves it only through the Worker', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/site.yml'), 'utf8');
  for (const source of SOURCES) assert.ok(workflow.includes(`'${source}'`), `site.yml does not start on ${source}`);
  assert.match(workflow, /node tools\/design-system\/build\.mjs/);
  assert.ok(workflow.indexOf('tools/design-system/build.mjs') < workflow.indexOf('wrangler@4 deploy'), 'the build runs before the deploy');
  assert.match(fs.readFileSync(path.join(ROOT, 'site/wrangler.toml'), 'utf8'), /run_worker_first = \[[^\]]*"\/admin\/design\/\*"/);
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^site\/public\/admin\/design\/$/m);
});
