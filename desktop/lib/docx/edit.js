// A tailored CV made by editing the person's own Word file: each item of cv.json (summary paragraph, bullet, a role's skills line) is
// found in its paragraph and its words replaced, each new word in the style its own word had (bold numbers stay bold), the rest of the
// paragraph and file untouched; a role's bullets are reordered by moving their paragraphs. Word re-flows the lines, so nothing is laid
// out here. An item that is not found, or whose text crosses a link or a field, keeps its original wording (a warning says so).
// Pure: XML in, XML out; lib/docx/zip.js reads and writes the file. Guards: test/docx-edit.test.js.
import {summaryParts} from '../cv-inplace.js';
import {balanced, encode, paragraphsOf} from './xml.js';

const plain = s => String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const QUOTE1 = /[‘’‚‛′`]/, QUOTE2 = /[“”„‟″]/, DASH = /[‐‑‒–—―−]/, SPACE = /[\s  -​ ]/;
// A list marker typed at the start of a paragraph (the bullet itself, then a tab or a space).
const MARKER = /^[•·▪◦●○■□➢►\-–*o]\s+/u;

// Text folded for finding (quotes, dashes, spaces, ligatures, "*" set aside), with the index of each folded character in the original.
export function fold(text) {
  let s = '', map = [], space = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (SPACE.test(ch)) { space = s.length > 0; continue; }
    if (ch === '*' || ch === '­') continue;
    if (space) { s += ' '; map.push(i); space = false; }
    const out = QUOTE1.test(ch) ? "'" : QUOTE2.test(ch) ? '"' : DASH.test(ch) ? '-' : ch.normalize('NFKC');
    for (const c of out) { s += c; map.push(i); }
  }
  return {s, map};
}

// Where an item's text is: the paragraph and its character range. One item per paragraph; a whole paragraph (after a typed marker) first.
function locate(paras, text, claimed) {
  const want = fold(plain(text)).s;
  if (!want) return null;
  let partial = null;
  for (let k = 0; k < paras.length; k++) {
    const para = paras[k];
    if (claimed.has(k) || para.hasNested || !para.text) continue;
    const {s, map} = fold(para.text);
    const lead = s.match(MARKER)?.[0].length || 0;
    if (s.slice(lead) === want) return {k, from: map[lead], to: map[s.length - 1] + 1};
    const at = s.indexOf(want);
    if (at >= 0 && !partial && s.indexOf(want, at + 1) < 0) partial = {k, from: map[at], to: map[at + want.length - 1] + 1};
  }
  return partial;
}

// Every item of the CV that can be edited in the Word file. -> [{where, kind, j, r, i, n, text, at: {k, from, to} | null}]
export function itemsOfDocx(paras, base) {
  const claimed = new Set(), out = [];
  const take = (where, text, extra) => {
    if (!plain(text)) return;
    const at = locate(paras, text, claimed);
    if (at) claimed.add(at.k);
    out.push({where, text: plain(text), at, ...extra});
  };
  summaryParts(base.summary).forEach((text, n) => take('Summary', text, {kind: 'summary', n}));
  (base.jobs || []).forEach((job, j) => (job.roles || []).forEach((role, r) => {
    const where = `${job.company} · ${role.title}`;
    (role.bullets || []).forEach((text, i) => { if (!role.extra?.includes(i)) take(where, text, {kind: 'bullet', j, r, i}); });
    if (role.skills) take(where, role.skills, {kind: 'skills', j, r});
  }));
  return out;
}

const run = (rPr, text) => `<w:r>${rPr}${text.split('\t').map(t => (t ? `<w:t xml:space="preserve">${encode(t)}</w:t>` : '')).join('<w:tab/>')}</w:r>`;

// One paragraph's XML with the range [from, to) of its text replaced by text, each new word in the style of the same old word (or of the
// word before it). -> the new XML, or null when the range crosses something that must not be cut (a link's edge, a field, a picture).
export function rewrite(xml, para, from, to, text) {
  const touched = para.pieces.filter(p => p.at < to && p.at + p.len > from);
  if (!touched.length) return null;
  const first = touched[0].run, last = touched[touched.length - 1].run, runs = para.runs.slice(first, last + 1);
  if (runs.some(r => r.other) || !balanced(xml.slice(runs[0].start, runs[runs.length - 1].end))) return null;
  const styleAt = i => para.runs[para.pieces.find(p => p.at <= i && i < p.at + p.len)?.run ?? first].rPr;
  const runText = k => para.pieces.filter(p => p.run === k);
  const startOf = runText(first)[0].at, endOf = runText(last).at(-1).at + runText(last).at(-1).len;
  // The old words with their styles; each new word takes the style of an equal old word, else of the word before it.
  const old = [], re = /\S+/g;
  for (let m; (m = re.exec(para.text.slice(from, to)));) old.push({word: fold(m[0]).s, style: styleAt(from + m.index), used: false});
  const words = plain(text).split(' ');
  let style = styleAt(from);
  const styled = words.map(word => {
    const same = old.find(o => !o.used && o.word === fold(word).s);
    if (same) { same.used = true; style = same.style; }
    return {word, style};
  });
  let middle = '';
  for (let i = 0; i < styled.length;) {
    let j = i;
    while (j + 1 < styled.length && styled[j + 1].style === styled[i].style) j++;
    middle += run(styled[i].style, styled.slice(i, j + 1).map(s => s.word).join(' ') + (j + 1 < styled.length ? ' ' : ''));
    i = j + 1;
  }
  const before = para.text.slice(startOf, from), after = para.text.slice(to, endOf);
  return xml.slice(para.start, runs[0].start) + (before ? run(para.runs[first].rPr, before) : '') + middle
    + (after ? run(para.runs[last].rPr, after) : '') + xml.slice(runs[runs.length - 1].end, para.end);
}

// doc: {xml} of word/document.xml. base: cv.json. review: applyTailoring's review. -> {xml, warnings, changed, kept, edited: [{k, before, text}]}
export function tailorDocx(xml, base, review) {
  const paras = paragraphsOf(xml), items = itemsOfDocx(paras, base), out = new Map(), warnings = [], edited = [];
  let changed = 0, kept = 0;
  const keep = (where, why) => { kept++; warnings.push(`${where}: ${why}; kept your original wording`); };
  const set = (item, text) => {
    if (!item.at) return keep(item.where, 'not found in your Word file');
    const para = paras[item.at.k], got = rewrite(xml, para, item.at.from, item.at.to, text);
    if (got === null) return keep(item.where, 'its text crosses a link or a field');
    out.set(item.at.k, got); changed++; edited.push({k: item.at.k, before: item.text, text: plain(text)});
  };
  const summary = items.filter(i => i.kind === 'summary'), lines = summaryParts(review.summary);
  if (summary.length === 1 && plain(review.summary) !== summary[0].text) set(summary[0], review.summary);
  else if (summary.length > 1 && lines.length !== summary.length) { if (lines.join(' ') !== summary.map(i => i.text).join(' ')) keep('Summary', 'the new summary has another number of paragraphs'); }
  else if (summary.length > 1) summary.forEach((item, n) => { if (lines[n] !== item.text) set(item, lines[n]); });

  const moves = [];
  (base.jobs || []).forEach((job, j) => (job.roles || []).forEach((role, r) => {
    const tailored = review.jobs?.[j]?.roles?.[r];
    if (!tailored) return;
    const where = `${job.company} · ${role.title}`;
    const own = items.filter(i => i.kind === 'bullet' && i.j === j && i.r === r);
    const added = tailored.bullets.filter(b => role.extra?.includes(b.from));
    if (added.length) warnings.push(`${where}: ${added.length} added bullet${added.length > 1 ? 's' : ''} left out: your own CV design has no room for more lines`);
    const order = tailored.bullets.map(b => own.findIndex(i => i.i === b.from)).filter(x => x >= 0);
    own.forEach((_, x) => { if (!order.includes(x)) order.push(x); });   // no drops in your own design
    own.forEach((item, x) => { const text = plain(tailored.bullets.find(b => b.from === item.i)?.text ?? item.text); if (text !== item.text) set(item, text); });
    if (!order.some((x, pos) => x !== pos)) return;
    // Moving needs every bullet found, as paragraphs side by side (only spacing between them).
    const ks = own.map(i => i.at?.k);
    const side = ks.every(k => k !== undefined) && ks.every((k, x) => x === 0 || (k === ks[x - 1] + 1 && !xml.slice(paras[ks[x - 1]].end, paras[k].start).trim()));
    if (side) moves.push({ks, order}); else warnings.push(`${where}: kept the original order of the bullets (they are not side by side in your Word file)`);
  }));
  const skills = items.filter(i => i.kind === 'skills');
  for (const item of skills) { const t = review.jobs?.[item.j]?.roles?.[item.r]?.skills; if (t && plain(t) !== item.text) set(item, t); }

  // Write: each changed paragraph replaced; a moved block rewritten in its new order.
  const body = k => out.get(k) ?? xml.slice(paras[k].start, paras[k].end);
  const spans = [...moves.map(({ks, order}) => ({start: paras[ks[0]].start, end: paras[ks.at(-1)].end, text: order.map(x => body(ks[x])).join('')})),
    ...[...out.keys()].filter(k => !moves.some(m => m.ks.includes(k))).map(k => ({start: paras[k].start, end: paras[k].end, text: out.get(k)}))]
    .sort((a, b) => b.start - a.start);
  let result = xml;
  for (const span of spans) result = result.slice(0, span.start) + span.text + result.slice(span.end);
  return {xml: result, warnings, changed, kept, edited, moved: moves.length};
}
