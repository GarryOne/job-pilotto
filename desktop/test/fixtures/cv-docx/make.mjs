// Two made-up Word CVs (all people invented) written as raw WordprocessingML, with what real Word files carry: words split across runs,
// spell-check marks, a link, bold numbers, numbered bullets (classic) and typed "•" bullets in a two-column table (table).
// Run: node test/fixtures/cv-docx/make.mjs -> classic.docx, table.docx (their cv.json and tailorings are in shapes.json).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';

const here = path.dirname(fileURLToPath(import.meta.url));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A run: text with optional bold/italic/size (points)/colour/font. A tab is its own element.
const r = (text, {b, i, size, color, font} = {}) => {
  const props = [font && `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`, b && '<w:b/>', i && '<w:i/>', color && `<w:color w:val="${color}"/>`,
    size && `<w:sz w:val="${size * 2}"/>`].filter(Boolean).join('');
  const body = text.split('\t').map(part => part ? `<w:t xml:space="preserve">${esc(part)}</w:t>` : '').join('<w:tab/>');
  return `<w:r w:rsidRPr="00A1B2C3">${props ? `<w:rPr>${props}</w:rPr>` : ''}${body}</w:r>`;
};
// Word splits text where an edit or a spell check happened: the same look, several runs.
const split = (text, style, at) => { const out = []; let last = 0; for (const n of at) { out.push(r(text.slice(last, n), style)); last = n; } out.push(r(text.slice(last), style)); return out.join('<w:proofErr w:type="spellStart"/>'); };
const p = (runs, {numId, after = 80, tabs, shade} = {}) => `<w:p w:rsidR="00B4C5D6"><w:pPr>${numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : ''}${tabs ? `<w:tabs><w:tab w:val="right" w:pos="${tabs}"/></w:tabs>` : ''}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}<w:spacing w:after="${after}"/></w:pPr>${runs}</w:p>`;
const link = (text, style) => `<w:hyperlink r:id="rIdLink" w:history="1">${r(text, {...style, color: '1F5FAD'})}</w:hyperlink>`;

const styles = font => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const page = body => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>`;

function classic() {
  const head = text => p(r(text.toUpperCase(), {b: true, color: '2E5A88', size: 11}), {after: 60});
  const role = (title, when) => p(r(`${title}\t`, {b: true}) + r(when, {i: true, color: '555555'}), {tabs: 9900, after: 40});
  const bullet = runs => p(runs, {numId: 1, after: 40});
  return page([
    p(r('Henrik Aaltonen', {b: true, size: 20}), {after: 40}),
    p(r('Tampere, Finland · ') + link('henrik.a@example.org') + r(' · +358 40 000 0000', {color: '555555'}), {after: 200}),
    head('Summary'),
    p(r('Maintenance planner with ') + r('eleven years', {b: true}) + split(' in paper mills and food plants. I plan shutdowns that finish on time, keep spare parts honest and write work orders technicians can follow.', {}, [22, 61])),
    head('Experience'),
    role('Maintenance Planner, Kuusi Paper Oy', '2018 – Present'),
    bullet(split('Planned four annual shutdowns of 12 days each with 300 contractors on site.', {}, [8, 40])),
    bullet(r('Cut emergency work orders from ') + r('35% to 18%', {b: true}) + r(' by moving routine checks into the weekly plan.')),
    bullet(r('Set up the spare parts min/max levels in SAP PM with the stores team.')),
    bullet(split('Trained six new planners on the work order process.', {}, [12])),
    role('Maintenance Technician, Lahti Foods', '2012 – 2018'),
    bullet(r('Repaired filling and packing lines across two shifts.')),
    bullet(r('Wrote step-by-step lockout guides for every line.')),
    head('Skills'),
    p(r('SAP PM, shutdown planning, reliability-centred maintenance, Finnish (native), English (fluent), Swedish (good)')),
  ].join(''));
}

function table() {
  const cell = (width, body, fill) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>${body}</w:tc>`;
  const head = text => p(r(text, {b: true, color: 'A23B1E', size: 12}), {after: 60});
  const dot = text => p(r(`•\t${text}`), {after: 40});
  const left = [p(r('Lucía Ferrer Vidal', {b: true, size: 16, color: 'FFFFFF'})), p(r('Valencia, Spain', {color: 'FFFFFF'})), p(r('lucia.fv@example.es', {color: 'FFFFFF'}), {after: 240}),
    p(r('Skills', {b: true, color: 'FFFFFF'})), p(r('Menu planning, food cost, HACCP, team training, Spanish (native), English (good)', {color: 'FFFFFF'}))].join('');
  const right = [head('Profile'),
    p(r('Head chef with ') + split('twelve years in hotel and restaurant kitchens across Spain.', {}, [13])),
    p(r('I like calm services, clear prep lists and menus built around the season.')),
    dot('Food cost and supplier negotiations.'), dot('Training young cooks.'),
    head('Experience'),
    p(r('Head Chef — Casa Marina, Valencia', {b: true}) + r('  2020 – Present', {color: '777777'}), {after: 40}),
    dot('Run a kitchen of 14 cooks serving 220 covers a night in summer.'),
    dot('Rewrote the menu every season with local suppliers; food cost fell from 34% to 29%.'),
    dot('Trained two sous chefs who now run their own kitchens.'),
    p(r('Sous Chef — Hotel Alameda, Seville', {b: true}) + r('  2015 – 2020', {color: '777777'}), {after: 40}),
    dot('Ran the breakfast and banquet service for up to 400 guests.'),
    dot('Kept HACCP records ready for every inspection.')].join('');
  return page(`<w:tbl><w:tblPr><w:tblW w:w="9900" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6900"/></w:tblGrid><w:tr>${cell(3000, left, '3B4A5C')}${cell(6900, right)}</w:tr></w:tbl><w:p/>`);
}

async function docx(document, font) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:someone@example.org" TargetMode="External"/></Relationships>');
  zip.file('word/document.xml', document);
  zip.file('word/styles.xml', styles(font));
  zip.file('word/numbering.xml', numbering);
  // A fixed date, so the same input makes the same bytes.
  return zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE', date: new Date('2026-01-01T00:00:00Z')});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(here, 'classic.docx'), await docx(classic(), 'Calibri'));
  fs.writeFileSync(path.join(here, 'table.docx'), await docx(table(), 'Arial'));
  console.log('made classic.docx, table.docx');
}
