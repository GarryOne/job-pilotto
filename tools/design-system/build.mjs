// Builds the design-system page and its snapshot zip from the repository, deterministically (no AI, no browser, no Electron): the same files and the same
// commit + date give the same bytes. The page runs the app's real gallery (renderer/gallery.js, components.js, tokens.css) in the viewer's browser; this file only
// copies the files that run needs, adds the rules (docs/rules/desktop-ui.md) and states (tools/design-system/browser), and zips the snapshot for Claude and ChatGPT.
//   node tools/design-system/build.mjs [--out site/public/admin/design] [--commit <sha>] [--date YYYY-MM-DD]
// Served by the site Worker behind the admin login (site/src/design.js); rebuilt by the site deploy (.github/workflows/site.yml). Guard: desktop/test/design-system-page.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inline, sections} from './rules-html.mjs';
import {zip} from './zip.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BASE = '/admin/design/';
const RENDERER = 'desktop/renderer', HERE = 'tools/design-system';
// What the page reads: the rules, the skill, the reference screenshots. A change to any of them must rebuild the page (the site deploy's paths list these, tested).
export const SOURCES = [`${RENDERER}/**`, 'docs/rules/desktop-ui.md', '.claude/skills/ui-look-and-feel/SKILL.md', 'desktop/docs/ui/**', `${HERE}/**`];
const ENTRIES = [`${RENDERER}/gallery.js`, `${HERE}/browser/design-states.js`];
const EXTRA = ['logo.png', 'design-status.json'];   // logo.png: drawn by gallery.js markup; design-status.json: the approved/legacy/proposed list

const read = (file, base = ROOT) => fs.readFileSync(path.join(base, file));
const text = file => read(file).toString('utf8');
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A module's static imports, resolved to repo paths; the browser files' "../r/x.js" is the renderer's x.js.
export function importsOf(file) {
  const source = text(file), found = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n;]*?from\s*'([^']+)'|(?:^|\n)\s*import\s*'([^']+)'/g)) {
    const spec = match[1] || match[2];
    if (!spec.startsWith('.')) continue;
    const mapped = spec.startsWith('../r/') ? `${RENDERER}/${spec.slice(5)}` : path.posix.join(path.posix.dirname(file), spec);
    found.push(mapped);
  }
  return found;
}
export function closure(entries = ENTRIES) {
  const seen = new Set(), todo = [...entries];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`import of a file that is not there: ${file}`);
    seen.add(file);
    todo.push(...importsOf(file));
  }
  return [...seen].sort();
}
// The stylesheets gallery.html loads, in its order, and the files their url(...) names.
export const stylesheets = () => [...text(`${RENDERER}/gallery.html`).matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
function cssAssets(css) {
  const dir = path.posix.dirname(css);
  return [...text(`${RENDERER}/${css}`).matchAll(/url\(\s*['"]?([^)'"]+)['"]?\s*\)/g)].map(match => match[1]).filter(url => !/^(data:|https?:|#)/.test(url)).map(url => path.posix.normalize(path.posix.join(dir, url)));
}

// Section titles and notes of the gallery: section('Title', 'note' ...). The gallery draws them; this reads them for components.md and the tests.
export function gallerySections() {
  const out = [];
  for (const file of [`${RENDERER}/gallery.js`, `${HERE}/browser/design-states.js`]) {
    for (const match of text(file).matchAll(/\bsection\(\s*'((?:[^'\\]|\\.)+)'\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) out.push({title: match[1].replace(/\\'/g, "'"), note: (match[2] ?? match[3] ?? '').replace(/\\'/g, "'"), states: file.includes('design-states')});
  }
  return out;
}

// tokens.css -> {light: {--name: value}, dark: {...}} (the first :root block, and the prefers-color-scheme dark one).
export function tokensOf(css) {
  const props = block => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
  const dark = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*)$/.exec(css);
  const light = css.slice(0, dark ? dark.index : undefined);
  return {light: props(light), dark: dark ? props(dark[1]) : {}};
}

export function sha() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(); } catch { return 'unknown'; }
}

function rulesSection(statusFile) {
  const known = statusFile.rules || {};
  return sections(text('docs/rules/desktop-ui.md')).filter(part => part.html).map(part => {
    const status = part.status || known[part.title] || (part.title === 'Overview' ? '' : 'unmarked');
    return `<section class="dp-rule ${status}" id="rule-${esc(part.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}"><h2>${inline(part.title)}${status ? `<span class="dp-badge ${status}">${status}</span>` : ''}</h2>${part.html}</section>`;
  }).join('\n');
}

function pageHtml({commit, date}) {
  const statusFile = JSON.parse(text(`${RENDERER}/design-status.json`));
  const links = stylesheets().map(href => `<link rel="stylesheet" href="${href}">`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Job Pilotto · design system</title>
<base href="${BASE}r/">
<script>/* the demo save bars hold example drafts: leaving this page must never ask "Leave site?" */addEventListener('beforeunload', event => event.stopImmediatePropagation(), true);</script>
${links}
<link rel="stylesheet" href="${BASE}b/design-page.css">
</head>
<!-- Generated by tools/design-system/build.mjs from commit ${commit}; do not edit. -->
<body class="gallery design-page">
<div class="dp-wrap">
  <header class="dp-head">
    <div><h1>Job Pilotto design system</h1>
      <div class="dp-source">source commit <a href="https://github.com/GarryOne/job-pilotto/commit/${esc(commit)}" rel="noreferrer">${esc(commit.slice(0, 7))}</a> · generated ${esc(date)}</div></div>
    <a class="dp-download" href="${BASE}snapshot.zip" download>Download snapshot (.zip) for Claude or ChatGPT</a>
  </header>
  <p class="dp-key"><span><span class="dp-badge approved">approved</span> the pattern to use</span><span><span class="dp-badge legacy">legacy</span> still in the app, don't copy</span><span><span class="dp-badge proposed">proposed</span> a design not yet approved</span></p>
  <div class="dp-layout">
    <nav class="dp-toc" aria-label="Sections"></nav>
    <div class="dp-body">
      <div data-group="Rules">${rulesSection(statusFile)}</div>
      <main id="gallery" data-group="Components"></main>
    </div>
  </div>
</div>
<script src="${BASE}b/design-states.js" type="module"></script>
<script src="gallery.js" type="module"></script>
<script src="${BASE}b/design-page.js" type="module"></script>
</body>
</html>
`;
}

function snapshot({commit, date, files}) {
  const sectionsList = gallerySections();
  const status = JSON.parse(text(`${RENDERER}/design-status.json`)).sections || {};
  const tokens = tokensOf(text(`${RENDERER}/tokens.css`));
  const shots = fs.readdirSync(path.join(ROOT, 'desktop/docs/ui')).filter(name => /\.(jpg|png)$/.test(name)).sort();
  const components = `# Components (${date}, commit ${commit.slice(0, 7)})\n\nEach line: gallery section, status, what it is. Source: desktop/renderer/gallery.js drawn by components.js, card-shell.js, save-bar.js. Statuses: approved = use it; legacy = still in the app, do not copy; proposed = not yet approved.\n\n`
    + sectionsList.map(item => `- **${item.title}** [${status[item.title] || 'approved'}]: ${item.note}`).join('\n') + '\n';
  const readme = `# Job Pilotto design system snapshot\n\nA read-only snapshot for an AI assistant (Claude, ChatGPT or any other). Generated from the repository at commit ${commit} on ${date}; the live page is ${BASE} on the admin site.\nIt is not a second source: the repository is. If this snapshot and the repository disagree, the repository wins.\n\n## Read in this order\n1. RULES.md: the written design rules. Headings tagged [approved], [legacy] or [proposed]; follow approved, never copy legacy, treat proposed as a draft.\n2. SKILL-ui-look-and-feel.md: the look and feel guide (which control for which kind of value).\n3. tokens.css and tokens.json: every colour, size, radius and shadow (light and dark). Use var(--name); never a raw value.\n4. components.md: the shared components and their status.\n5. shots/: reference screenshots of the real screens.\n\n## Rules of thumb\n- Build from the shared components and tokens. Do not invent a new style.\n- One primary (orange) button per card or screen. Cards read first, Edit opens an editor, one page save bar saves.\n- Use only fictional data in examples.\n`;
  const source = `commit: ${commit}\ngenerated: ${date}\nbuilt by: tools/design-system/build.mjs\nrepository: https://github.com/GarryOne/job-pilotto\n`;
  return zip([
    {name: 'README.md', data: readme}, {name: 'RULES.md', data: read('docs/rules/desktop-ui.md')},
    {name: 'SKILL-ui-look-and-feel.md', data: read('.claude/skills/ui-look-and-feel/SKILL.md')},
    {name: 'tokens.css', data: read(`${RENDERER}/tokens.css`)}, {name: 'tokens.json', data: JSON.stringify(tokens, null, 2) + '\n'},
    {name: 'components.md', data: components}, ...shots.map(name => ({name: `shots/${name}`, data: read(`desktop/docs/ui/${name}`)})),
    {name: 'SOURCE.txt', data: source},
  ]);
}

// Writes the whole output folder (emptied first) and returns the list of files written.
export function build({out = path.join(ROOT, 'site/public/admin/design'), commit = sha(), date = new Date().toISOString().slice(0, 10)} = {}) {
  fs.rmSync(out, {recursive: true, force: true});
  const written = [];
  const put = (rel, data) => { const target = path.join(out, rel); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, data); written.push(rel); };
  const css = stylesheets();
  for (const file of closure()) {
    if (file.startsWith(`${RENDERER}/`)) put(`r/${file.slice(RENDERER.length + 1)}`, read(file));
    else if (file.startsWith(`${HERE}/browser/`)) put(`b/${path.posix.basename(file)}`, read(file));
  }
  for (const sheet of css) { put(`r/${sheet}`, read(`${RENDERER}/${sheet}`)); for (const asset of cssAssets(sheet)) put(`r/${asset}`, read(`${RENDERER}/${asset}`)); }
  for (const name of EXTRA) put(`r/${name}`, read(`${RENDERER}/${name}`));
  put('b/design-page.css', read(`${HERE}/browser/design-page.css`));
  put('b/design-page.js', read(`${HERE}/browser/design-page.js`));
  put('index.html', pageHtml({commit, date}));
  put('snapshot.zip', snapshot({commit, date, files: written}));
  return written.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : undefined; };
  const out = arg('out') ? path.resolve(arg('out')) : undefined;
  const written = build({out, commit: arg('commit'), date: arg('date')});
  console.log(`design-system: ${written.length} files -> ${out || 'site/public/admin/design'}`);
}
