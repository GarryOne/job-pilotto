/* global document */
// Capturing a page for the recorded pages (layer 2, spec docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): its STRUCTURE only. In the page
// (snapshotInPage): scripts, frames and event handlers dropped, every typed value, check and choice removed, URL queries and fragments cut, the extension's
// own elements left out. Here (scrub): any email but example.*, any phone number and the person's own values (personalValues: from the app's profile.md /
// answers.md) replaced by the fake applicant's. The result goes into a PUBLIC repo; desktop/test/recorded-privacy.test.js checks it again.
// Used by: twin-drive.mjs `capture`. Guard: e2e/test/capture-page.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
export const PHONE = /\+?\d[\d\s().-]{8,}\d/g;
export const FAKE = {email: 'test.candidate@example.com', name: 'Candidate', phone: '(phone)'};

// The person's own values from the app's files, as {value: kind}; never printed. Emails, phone digits, the words of any "name:" line.
export function personalValues(texts) {
  const own = texts.join('\n'), values = new Map();
  for (const email of own.match(EMAIL) || []) values.set(email.toLowerCase(), 'email');
  for (const phone of own.match(PHONE) || []) { const digits = phone.replace(/\D/g, ''); if (digits.length >= 9) values.set(digits, 'phone'); }
  for (const [, value] of own.matchAll(/^\W*(?:full\s*)?(?:first\s*|last\s*|family\s*)?name\W*:\s*(.+)$/gim)) for (const word of value.split(/\s+/)) if (word.replace(/\W/g, '').length >= 3) values.set(word.replace(/[^\p{L}\p{N}'-]/gu, '').toLowerCase(), 'name');
  return values;
}
export const appProfileTexts = (folders = [path.join(os.homedir(), 'Library/Application Support/Job Pilotto')]) =>
  folders.flatMap(folder => ['profile.md', 'answers.md'].map(name => { try { return fs.readFileSync(path.join(folder, name), 'utf8'); } catch { return ''; } }));

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function scrub(html, values = new Map()) {
  let out = html.replace(EMAIL, email => (/@example\.(com|org|net)$/i.test(email) ? email : FAKE.email)).replace(PHONE, number => (number.replace(/\D/g, '').length >= 9 ? FAKE.phone : number));
  for (const [value, kind] of values) {
    if (kind === 'name') out = out.replace(new RegExp(`\\b${escape(value)}\\b`, 'gi'), FAKE.name);
    if (kind === 'email') out = out.replace(new RegExp(escape(value), 'gi'), FAKE.email);
  }
  return out;
}

// Runs IN the page (passed to page.evaluate): the page's structure as one HTML string.
export function snapshotInPage() {
  const root = document.documentElement.cloneNode(true);
  for (const node of root.querySelectorAll('script, noscript, iframe, frame, object, embed, template, link[rel=preload], link[rel=prefetch], link[rel=modulepreload], meta[http-equiv]')) node.remove();
  for (const node of root.querySelectorAll('[id^="jobpilotto"], [class*="jobpilotto"], [data-jobpilotto-panel]')) node.remove();
  for (const node of root.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || /^data-jobpilotto/i.test(attr.name)) node.removeAttribute(attr.name);
      else if (['href', 'src', 'action', 'srcset'].includes(attr.name)) node.setAttribute(attr.name, attr.value.replace(/[?#][^\s,"]*/g, ''));
    }
    if (node.tagName === 'INPUT') { if (!['submit', 'button', 'reset', 'image'].includes((node.getAttribute('type') || '').toLowerCase())) node.removeAttribute('value'); node.removeAttribute('checked'); }
    if (node.tagName === 'TEXTAREA') node.textContent = '';
    if (node.tagName === 'OPTION') node.removeAttribute('selected');
  }
  return `<!doctype html>\n${root.outerHTML}`;
}

// Writes <out>/<caseName>/<pageName>.html and adds the page to its case.json (a skeleton the first time: shape, ai and expect are for the person to write).
export function writeCapture({out, caseName, pageName, url, html}) {
  const dir = path.join(out, caseName), file = `${pageName}.html`, casePath = path.join(dir, 'case.json');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, file), html);
  const item = fs.existsSync(casePath) ? JSON.parse(fs.readFileSync(casePath, 'utf8')) : {shape: 'TODO: the shape in words', why: 'TODO: the bug or fix', sample: '', pages: [], ai: {}, expect: {}};
  const address = String(url).replace(/[?#].*$/, '');
  item.pages = [...item.pages.filter(page => page.file !== file), {url: address, file}];
  if (!item.sample) item.sample = new URL(address).host;
  fs.writeFileSync(casePath, `${JSON.stringify(item, null, 1)}\n`);
  return {dir, file};
}
