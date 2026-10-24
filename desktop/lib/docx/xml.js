// Reads a Word document's body (word/document.xml) as paragraphs of text, each character traced back to its place in the XML and the
// style of its run, so lib/docx/edit.js can replace a text in place and keep its look. One pass over the tags, no XML library:
// the text of w:t, w:tab, w:br and w:noBreakHyphen inside runs; text boxes' fallback copies (mc:Fallback) are skipped. Guards: test/docx-edit.test.js.

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
export const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? all);
export const encode = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Elements inside a run that are not text: a run holding one is never rewritten (a picture, a field, a symbol font character).
const OTHER = new Set(['w:drawing', 'w:pict', 'w:object', 'w:fldChar', 'w:instrText', 'w:sym', 'w:footnoteReference', 'w:endnoteReference', 'w:ruby']);

// -> [{start, end, text, numbered, nested, runs: [{start, end, rPr, other}], pieces: [{at, len, run, kind}]}] in document order.
// start/end: the paragraph's XML (from "<w:p" to after "</w:p>"); a run's rPr is its whole <w:rPr>…</w:rPr> ('' when none).
export function paragraphsOf(xml) {
  const tag = /<(\/?)([A-Za-z][\w.-]*:[\w.-]+)([^>]*?)(\/?)>/g, done = [], open = [];
  let run = null, fallback = 0, m;
  while ((m = tag.exec(xml))) {
    const [all, closing, name, , self] = m, at = m.index;
    if (name === 'mc:Fallback' && !self) { fallback += closing ? -1 : 1; continue; }
    if (fallback) continue;
    const para = open[open.length - 1];
    if (name === 'w:p') {
      if (self) { done.push({start: at, end: at + all.length, text: '', numbered: false, nested: open.length > 0, runs: [], pieces: []}); continue; }
      if (!closing) { open.push({start: at, text: '', numbered: false, nested: open.length > 0, runs: [], pieces: []}); continue; }
      const p = open.pop();
      if (p) { p.end = at + all.length; if (open.length) open[open.length - 1].hasNested = true; done.push(p); }
      continue;
    }
    if (!para) continue;
    if (name === 'w:numPr' && !closing) { para.numbered = true; continue; }
    if (name === 'w:r') {
      if (self) continue;
      if (!closing) run = {start: at, rPr: '', other: false};
      else if (run) { run.end = at + all.length; para.runs.push(run); run = null; }
      continue;
    }
    if (!run) continue;
    if (name === 'w:rPr' && !closing && !self) {
      const end = xml.indexOf('</w:rPr>', at) + '</w:rPr>'.length;
      run.rPr = xml.slice(at, end); tag.lastIndex = end; continue;
    }
    const piece = (text, kind) => { para.pieces.push({at: para.text.length, len: text.length, run: para.runs.length, kind}); para.text += text; };
    if (name === 'w:t' && !closing && !self) {
      const end = xml.indexOf('</w:t>', at);
      piece(decode(xml.slice(at + all.length, end)), 't'); tag.lastIndex = end + '</w:t>'.length; continue;
    }
    if (closing) continue;
    if (name === 'w:tab') piece('\t', 'tab');
    else if (name === 'w:br' || name === 'w:cr') piece('\n', 'br');
    else if (name === 'w:noBreakHyphen') piece('-', 't');
    else if (OTHER.has(name)) run.other = true;
  }
  return done.sort((a, b) => a.start - b.start);
}

// Whether a slice of XML closes only what it opens (a replaced span must not cut through a link or a field).
export function balanced(slice) {
  const tag = /<(\/?)([A-Za-z][\w.-]*:[\w.-]+)[^>]*?(\/?)>/g, stack = [];
  let m;
  while ((m = tag.exec(slice))) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}
