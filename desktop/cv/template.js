// CV template: the user's CV data (cv.json) -> print-ready HTML (A4). Chromium prints it to PDF (lib/cv.js).
// Units are pt, so a design made in Figma at 595 × 842 (A4) maps 1:1.
//
// Layout: without cv.layout.pages the CV flows over as many pages as it needs (the default look). A custom
// design (a user's own style.css, e.g. rebuilt from their Figma file) may place jobs on fixed pages instead:
// layout.pages = [{class, banner}] and job.page = index. Fixed pages never grow, so lib/cv.js checks overflow.
//
// Review mode marks what tailoring changed: reworded words (ins/del), moved and dropped bullets.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CSS = fs.readFileSync(path.join(here, 'default.css'), 'utf8');
const font = name => pathToFileURL(path.join(here, 'fonts', name)).href;
const FONTS = `@font-face { font-family: Inter; font-weight: 100 900; src: url(${font('inter-latin.woff2')}) format('woff2'); }
@font-face { font-family: Inter; font-weight: 100 900; src: url(${font('inter-latin-ext.woff2')}) format('woff2');
  unicode-range: U+0100-02AF, U+1E00-1EFF; }`;
// Always applied, whatever the style: page size, fixed pages (never grow: overflow is checked), list reset.
const CORE = `@page { size: A4; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Inter, sans-serif; -webkit-print-color-adjust: exact; }
ul { list-style: none; } b { font-weight: 700; }
.page.fixed { position: relative; width: 595pt; height: 841.5pt; overflow: hidden; break-after: page; }
.page.fixed:last-child { break-after: auto; }
.banner { position: absolute; left: 0; bottom: 0; width: 595pt; object-fit: cover; }`;
// Inter as a variable font on purpose: Chromium then draws it like Figma does (crisper in Preview), text still selectable.

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Inline markup in the data: **bold** and [text](url).
export const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
const asset = name => name ? `assets/${esc(name)}` : '';

// A bullet is a string, or in review mode {text, mark: 'reworded'|'moved'|'kept', diff: html, from: n}.
function bullet(item) {
  if (typeof item === 'string') return `<li>${md(item)}</li>`;
  const note = item.mark === 'moved' ? ` data-note="moved up from #${item.from + 1}"` : '';
  return `<li class="mark-${item.mark || 'kept'}"${note}>${item.diff || md(item.text)}</li>`;
}

function role(r, job) {
  const company = job.href ? `<a href="${esc(job.href)}">${esc(job.company)}</a>` : esc(job.company);
  const dropped = (r.dropped || []).map(text => `<li class="mark-dropped">${md(text)}</li>`).join('');
  return `<div class="role">
    <div class="row title"><span>${esc(r.title)}</span><span class="company">${company}</span></div>
    <div class="row when"><span>${esc(r.period)}</span><span>${esc(r.place)}</span></div>
    <div class="text">
      ${r.intro ? `<p class="intro">${md(r.intro)}</p>` : ''}
      <ul>${(r.bullets || []).map(bullet).join('')}${dropped}</ul>
      ${r.skills ? `<p class="skills${r.skillsMark ? ' mark-reworded' : ''}"><b>Skills:</b> ${r.skillsDiff || esc(r.skills)}</p>` : ''}
    </div></div>`;
}

const job = j => `<div class="job${j.class ? ` ${esc(j.class)}` : ''}">
  ${j.logo ? `<div class="logo"><img src="${asset(j.logo)}" alt=""></div>` : ''}
  <div class="body">${j.roles.map(r => role(r, j)).join('')}</div></div>`;

function header(cv) {
  const links = (cv.links || []).map(l => `<div class="link">${l.icon ? `<img src="${asset(l.icon)}" alt="">` : ''}<a href="${esc(l.href)}">${esc(l.text)}</a></div>`).join('');
  return `<div class="head">
    <div class="name-row"><div><div class="name">${esc(cv.name)}</div>${cv.location ? `<div class="loc">${esc(cv.location)}</div>` : ''}</div>
      ${cv.photo ? `<div class="photo"><img src="${asset(cv.photo)}" alt=""></div>` : ''}</div>
    ${links ? `<div class="links">${links}</div>` : ''}
    ${cv.summary ? `<div class="summary"><h2>Summary</h2><p${cv.summaryMark ? ' class="mark-reworded"' : ''}>${cv.summaryDiff || md(cv.summary)}</p></div>` : ''}
    <h2 class="experience">Experience</h2></div>`;
}

function tail(cv) {
  const education = (cv.education || []).map(e => `<div class="edu"><div class="row title"><span>${esc(e.school)}</span><span>${esc(e.period || '')}</span></div><div>${esc(e.degree || '')}</div></div>`).join('');
  return `${education ? `<div class="section education"><h2>Education</h2>${education}</div>` : ''}
    ${cv.skills ? `<div class="section skills-all"><h2>Skills</h2><p>${md(cv.skills)}</p></div>` : ''}
    ${cv.languages ? `<div class="section languages"><h2>Languages</h2><p>${md(cv.languages)}</p></div>` : ''}`;
}

export function pages(cv) {
  const layout = cv.layout?.pages;
  if (!layout?.length) return [{class: 'flow', jobs: cv.jobs, header: true, tail: true}];
  return layout.map((page, n) => ({...page, jobs: cv.jobs.filter(j => (j.page ?? 0) === n), header: n === 0, tail: n === layout.length - 1}));
}

// style: the user's own stylesheet (cv/style.css), replacing the default look. review: show the marks.
export function render(cv, {style = '', review = false, base = ''} = {}) {
  const fixed = !!cv.layout?.pages?.length;
  const body = pages(cv).map(page => `<section class="page ${fixed ? 'fixed' : ''} ${esc(page.class || '')}">
    ${page.header ? header(cv) : ''}
    <div class="jobs">${page.jobs.map(job).join('')}</div>
    ${page.tail ? tail(cv) : ''}
    ${page.banner ? `<img class="banner" src="${asset(page.banner)}" alt="">` : ''}
  </section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">${base ? `<base href="${esc(base)}">` : ''}<title>${esc(cv.name)} CV</title>
<style>${FONTS}\n${CORE}\n${fixed ? '@page { margin: 0; }' : ''}\n${style || DEFAULT_CSS}\n${review ? REVIEW_CSS : ''}</style></head><body class="${review ? 'review' : ''}">${body}</body></html>`;
}

// Highlights for the review page (never printed into the PDF).
const REVIEW_CSS = `
body.review .mark-reworded { background: #fff4c2; box-shadow: 0 0 0 1.5pt #fff4c2; }
body.review .mark-moved { box-shadow: -4pt 0 0 #7cb7ff; }
body.review .mark-moved::after { content: ' ↑ ' attr(data-note); color: #2a6fd6; font-size: 0.8em; }
body.review .mark-dropped { color: #b0b0b0; text-decoration: line-through; }
body.review ins { background: #c9f3d2; text-decoration: none; }
body.review del { color: #c0392b; background: #ffe0dc; }
body.review .before { display: block; color: #8a8a8a; font-size: 0.9em; margin-top: 3pt; }
body.review.clean .mark-reworded { background: none; box-shadow: none; }
body.review.clean .mark-moved { box-shadow: none; } body.review.clean .mark-moved::after { content: none; }
body.review.clean .mark-dropped, body.review.clean del, body.review.clean .before { display: none; }
body.review.clean ins { background: none; }
`;
