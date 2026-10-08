// The ratchet against hard-coded page knowledge (tools/hardcoded-page-words.mjs): the debt of 8 Oct 2026 may only shrink; a new vendor name or a regex of plain words
// in extension/ or desktop/lib/ fails here. Fix by making the decision an AI field, or mark a line that is not page knowledge with `// words-ok: <why>`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {ALLOWED, countLines, scan} from '../../tools/hardcoded-page-words.mjs';

test('no file has more page words or vendor names than its recorded debt', () => {
  const allowed = JSON.parse(fs.readFileSync(ALLOWED, 'utf8')), found = scan();
  const worse = Object.entries(found).filter(([file, count]) => count > (allowed[file] || 0)).map(([file, count]) => `${file}: ${count} (allowed ${allowed[file] || 0})`);
  assert.deepEqual(worse, [], 'a new vendor list or word regex: make it an AI field (CLAUDE.md "Judgments about a page are the AI\'s"), or say `// words-ok: <why>`');
});

test('what the ratchet counts: vendor names and regexes of three plain words; not comments, not marked lines, not two alternatives', () => {
  assert.equal(countLines("const x = el.matches('.g-recaptcha, .h-captcha');"), 1);
  assert.equal(countLines("if (/(accept|agree|consent)/i.test(text)) return;"), 1);
  assert.equal(countLines("if (/(yes|no)/.test(text)) return;"), 0);
  assert.equal(countLines("// the captcha vendors: recaptcha, hcaptcha"), 0);
  assert.equal(countLines("const type = /(save|share|print)/.test(name);   // words-ok: our own message types"), 0);
});
