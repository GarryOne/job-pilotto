// A ratchet against hard-coded page knowledge (owner, 8 Oct 2026: "universal: any website, any form, any language; AI decides, not regex or lists"). It counts, per file in
// extension/ and desktop/lib/ (every folder below them), the lines that carry (1) a captcha/bot-check vendor name or (2) a regex whose alternatives are three or more plain words (a word list in
// disguise). The counts of today are recorded in tools/hardcoded-page-words-allowed.json as debt and may only shrink: a new such line fails desktop/test/hardcoded-page-words.test.js.
// A line that is deliberately not page knowledge (a protocol word, our own message type) says `// words-ok: <why>` and is not counted. Fix instead: add a field to the AI's answer.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOP = ['extension', 'desktop/lib'];   // every folder under these, found by git: ladder/, ai/ and store/ were missed by a hand list (15 Oct 2026)
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
  const files = execFileSync('git', ['ls-files', '-z', ...TOP], {cwd: root}).toString().split('\0').filter(name => name.endsWith('.js') && !/[\\/](test|node_modules)[\\/]/.test(name));
  for (const file of files) {
    const count = countLines(fs.readFileSync(path.join(root, file), 'utf8'));
    if (count) found[file] = count;
  }
  return found;
}

export const ALLOWED = path.join(ROOT, 'tools/hardcoded-page-words-allowed.json');
if (process.argv[1] === import.meta.filename && process.argv.includes('--write')) {
  fs.writeFileSync(ALLOWED, JSON.stringify(scan(), null, 1) + '\n');
  console.log(`wrote ${ALLOWED}`);
}
