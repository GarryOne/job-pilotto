// The two drawn CV look-alikes (pdf-lib's one-byte standard fonts, like Word and LaTeX exports): a justified Letter CV over two pages, and a
// page whose words are placed one by one with no space glyphs. All people are invented. Used by make.mjs; run alone with
//   node test/fixtures/cv-shapes/make-drawn.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';

const WORD = {
  name: 'Tomasz Wierzbicki', contact: 'Wroclaw, Poland  |  tomasz.w@example.net  |  +48 600 000 000',
  summary: 'Operations manager with twelve years in warehousing and road freight. I run sites where people know what is expected of them, stock is where the system says it is, and trucks leave on time. Comfortable with budgets, union talks and new warehouse software.',
  jobs: [
    {head: 'Site Manager, Baltyk Logistics', when: 'Jan 2019 - Present', bullets: [
      'Run a 40,000 square metre cross-dock with 180 staff over three shifts and a yearly budget of 9 million euros.',
      'Cut picking errors from 1.8% to 0.4% by re-slotting fast movers and retraining team leaders on scanner use.',
      'Led the move to a new warehouse management system without stopping outbound shipments for a single day.',
      'Agreed a new shift pattern with the works council that lowered overtime by a quarter.',
      'Set up a weekly safety walk; lost-time incidents went from eleven to two a year.']},
    {head: 'Shift Lead, Odra Freight', when: 'Mar 2014 - Dec 2018', bullets: [
      'Planned daily loading for 60 trucks to Germany and Czechia, working with dispatch on late changes.',
      'Trained new forklift drivers and kept the training records ready for audits.',
      'Introduced a simple board for damaged goods that halved the time claims stayed open.',
      'Covered for the site manager during holidays, including customer calls and staffing.']},
    {head: 'Warehouse Operative, Nadwislanski Magazyn', when: 'Jun 2011 - Feb 2014', bullets: [
      'Picked and packed orders for retail customers, later promoted to team leader of eight people.',
      'Kept the returns area tidy and processed returns within two working days.']},
  ],
  skills: 'Warehouse management systems, budgeting, shift planning, labour relations, lean, forklift licence, Polish (native), English (fluent), German (basic)',
};

// Widths as the letters are drawn (pdf-lib's widthOfTextAtSize applies kerning that drawText does not; Word and TeX break by what they draw).
const wide = (font, text, size) => [...text].reduce((s, ch) => s + font.widthOfTextAtSize(ch, size), 0);

export async function wordLike() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const W = 612, H = 792, M = 90, size = 12.5, lead = 19;
  let page = pdf.addPage([W, H]), y = H - 72;
  const ensure = need => { if (y - need < 60) { page = pdf.addPage([W, H]); y = H - 72; } };
  const para = (text, x, width, {font = regular, justify = true} = {}) => {
    let line = [];
    const flush = last => {
      ensure(lead);
      if (justify && !last && line.length > 1) {
        const gap = (width - line.reduce((t, w) => t + wide(font, w, size), 0)) / (line.length - 1);
        let cx = x; for (const w of line) { page.drawText(w, {x: cx, y, size, font}); cx += wide(font, w, size) + gap; }
      } else page.drawText(line.join(' '), {x, y, size, font});
      y -= lead; line = [];
    };
    for (const w of text.split(' ')) { if (line.length && wide(font, [...line, w].join(' '), size) > width) flush(false); line.push(w); }
    if (line.length) flush(true);
  };
  page.drawText(WORD.name, {x: M, y, size: 20, font: bold}); y -= 22;
  page.drawText(WORD.contact, {x: M, y, size: 10.5, font: regular}); y -= 26;
  const heading = t => { ensure(40); page.drawText(t.toUpperCase(), {x: M, y, size: 12, font: bold}); page.drawLine({start: {x: M, y: y - 4}, end: {x: W - M, y: y - 4}, thickness: 0.6, color: rgb(0, 0, 0)}); y -= 20; };
  heading('Profile'); para(WORD.summary, M, W - 2 * M); y -= 8;
  heading('Experience');
  for (const job of WORD.jobs) {
    ensure(40);
    page.drawText(job.head, {x: M, y, size, font: bold});
    page.drawText(job.when, {x: W - M - wide(regular, job.when, size), y, size, font: regular}); y -= lead + 2;
    for (const b of job.bullets) { ensure(lead); page.drawText('•', {x: M + 8, y, size, font: regular}); para(b, M + 22, W - 2 * M - 22); y -= 2; }
    y -= 8;
  }
  heading('Skills'); para(WORD.skills, M, W - 2 * M);
  return pdf.save();
}

export async function latexLike() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold), italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const W = 612, H = 792, M = 50, size = 10.5, lead = 12.6;
  const page = pdf.addPage([W, H]); let y = H - 60;
  const words = (text, x, width, font = regular, justify = true) => {   // one word at a time, like TeX: no space glyph anywhere
    const sp = size * 0.33; let line = [];
    const flush = last => {
      const natural = line.reduce((t, w) => t + wide(font, w, size), 0);
      const gap = justify && !last && line.length > 1 ? (width - natural) / (line.length - 1) : sp;
      let cx = x; for (const w of line) { page.drawText(w, {x: cx, y, size, font}); cx += wide(font, w, size) + gap; }
      y -= lead; line = [];
    };
    for (const w of text.split(' ')) { const t = [...line, w]; if (line.length && t.reduce((s, v) => s + wide(font, v, size), 0) + sp * (t.length - 1) > width) flush(false); line.push(w); }
    if (line.length) flush(true);
  };
  const name = 'Ines Albuquerque';
  page.drawText(name, {x: (W - wide(bold, name, 18)) / 2, y, size: 18, font: bold}); y -= 18;
  words('Porto, Portugal  ines.albuquerque@example.com  github.com/ines-example', 150, 400, regular, false); y -= 6;
  const section = t => { words(t, M, 300, bold, false); page.drawLine({start: {x: M, y: y + lead - 3}, end: {x: W - M, y: y + lead - 3}, thickness: 0.4, color: rgb(0, 0, 0)}); y -= 3; };
  section('Summary');
  words('Data engineer who builds batch and streaming pipelines for retail analytics. Careful about data quality, tests and documentation; happiest when analysts stop asking where a number came from.', M, W - 2 * M); y -= 4;
  section('Experience');
  const jobs = [
    ['Data Engineer, Mercado Verde', 'Feb 2021 - Present', ['Built the nightly sales pipeline in Python and Spark that feeds 300 store dashboards before opening time.', 'Moved event ingestion from cron scripts to Kafka consumers with alerting on lag and schema changes.', 'Wrote the data contract template now used by four product teams.']],
    ['Analytics Developer, Tejo Seguros', 'Sep 2017 - Jan 2021', ['Maintained the claims warehouse in PostgreSQL and cut the monthly close report from six hours to forty minutes.', 'Added row-level tests that caught duplicate policies before they reached finance.']],
  ];
  for (const [head, when, bullets] of jobs) {
    words(head, M, 300, bold, false); y += lead; page.drawText(when, {x: W - M - wide(italic, when, size), y, size, font: italic}); y -= lead;
    for (const b of bullets) { page.drawText('•', {x: M + 6, y, size, font: regular}); words(b, M + 16, W - 2 * M - 16); }
    y -= 4;
  }
  section('Skills');
  words('Python, SQL, Spark, Kafka, Airflow, PostgreSQL, dbt, Docker, Portuguese (native), English (fluent), Spanish (good)', M, W - 2 * M, regular, false);
  return pdf.save();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  fs.writeFileSync(path.join(here, 'word-like.pdf'), await wordLike());
  fs.writeFileSync(path.join(here, 'latex-like.pdf'), await latexLike());
  console.log('made 2 drawn CV shapes');
}
