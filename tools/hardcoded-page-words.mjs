// A ratchet against hard-coded page knowledge (owner, 8 Oct 2026: "universal: any website, any form, any language; AI decides, not regex or lists"). It counts, per file in
// extension/ and desktop/lib/, the lines that carry (1) a captcha/bot-check vendor name or (2) a regex whose alternatives are three or more plain words (a word list in
// disguise). The counts of today are recorded in tools/hardcoded-page-words-allowed.json as debt and may only shrink: a new such line fails desktop/test/hardcoded-page-words.test.js.
// A line that is deliberately not page knowledge (a protocol word, our own message type) says `// words-ok: <why>` and is not counted. Fix instead: add a field to the AI's answer.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['extension', 'extension/page', 'desktop/lib'];
const VENDOR = /recaptcha|hcaptcha|turnstile|captcha/i;
const WORD_LIST = /[\/(]\??:?[a-zà-ÿ]{3,}(\|[a-zà-ÿ]{3,}){2,}[)\/]/i;   // /(foo|bar|baz)/ or (?:foo|bar|baz): three or more plain words

export function countLines(text) {
  let count = 0;
  for (const line of text.split('\n')) {
    if (/words-ok:/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    const code = line.replace(/\s\/\/ .*$/, '');
    if (VENDOR.test(code) || WORD_LIST.test(code)) count++;
  }
  return count;
}

export function scan(root = ROOT) {
  const found = {};
  for (const dir of DIRS) {
    const folder = path.join(root, dir);
    if (!fs.existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.js'))) {
      const count = countLines(fs.readFileSync(path.join(folder, file), 'utf8'));
      if (count) found[`${dir}/${file}`] = count;
    }
  }
  return found;
}

export const ALLOWED = path.join(ROOT, 'tools/hardcoded-page-words-allowed.json');
if (process.argv[1] === import.meta.filename && process.argv.includes('--write')) {
  fs.writeFileSync(ALLOWED, JSON.stringify(scan(), null, 1) + '\n');
  console.log(`wrote ${ALLOWED}`);
}
