// The panel never shows a raw code error (19 Oct 2026: "Cannot read properties of undefined (reading 'filter')" reached the panel note). The AI reply's shape is checked where it is read
// (extension/ai-reply.js), and every text the extension shows a person from an error goes through plainWhy; the raw text goes to the log only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {plainWhy, readReply} from '../../extension/ai-reply.js';

const dir = new URL('../../extension/', import.meta.url);

test('a reply without an answers list is unreadable, never passed on', () => {
  for (const bad of [{}, {answers: null}, {answers: 'x'}, 'cut off {"answers": [{"fi', 7, []]) {
    assert.throws(() => readReply(bad), error => error.unreadable === true && !/Cannot read|undefined/.test(error.message), JSON.stringify(bad));
  }
  assert.equal(readReply(null), null, 'null stays the dropped-answer signal (answersOrDropped)');
  const ok = readReply({answers: [{field: 'a', value: 'x'}, null, {value: 'no field'}, 'junk'], eligible: true});
  assert.deepEqual(ok.answers, [{field: 'a', value: 'x'}], 'only well-formed answers are kept');
});

test('raw JS error texts become one plain sentence; plain ones stay', () => {
  for (const raw of ["Cannot read properties of undefined (reading 'filter')", 'x is not a function', 'undefined', 'Unexpected end of JSON input', 'TypeError: a.b is not iterable', '[object Object]']) {
    assert.doesNotMatch(plainWhy(raw), /Cannot read|undefined|TypeError|JSON|is not|\[object/i, raw);
  }
  assert.equal(plainWhy('Stopped by you'), 'Stopped by you');
  assert.equal(plainWhy('', 'try again'), 'try again');
});

// The class: every place that puts an error's text in front of a person. A new one that interpolates error.message raw fails here.
test('no note, todo or panel reason interpolates a raw error.message', () => {
  const shown = /(note\(|pairWords\(|why:|summary\.todo|state\(\{state: 'error'|aiError =|clickError =|return \{error:)/;
  const bad = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
    fs.readFileSync(new URL(file, dir), 'utf8').split('\n').forEach((line, i) => {
      if (/error\??\.message/.test(line) && shown.test(line) && !/decide\(|debug\.errors/.test(line.replace(/`[^`]*`/g, m => m.includes('plainWhy') ? '' : m)) && !/plainWhy\(error/.test(line)) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(bad, []);
});
