// A page judged without a form is looked at again (extension/fill-flow.js watchForFields): when fields come (a late form), or when a frame
// appears on a page that had none (a bot check injected seconds after the load: SmartRecruiters, twin, 9 Oct 2026, judged "empty page" at 3 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');

test('the page shape counts visible frames, and a frame that appears later makes the page be judged again', () => {
  assert.match(flow, /frames: \[\.\.\.document\.querySelectorAll\('iframe'\)\]\.filter\(el => \{ const box = el\.getBoundingClientRect\(\); return box\.width > 40 && box\.height > 40; \}\)\.length/);
  assert.match(flow, /const hadFrames = !!\(await pageShape\(tab\.id\)\)\?\.frames;/);
  assert.match(flow, /const framed = !!shape\?\.frames && !hadFrames;/);
  assert.match(flow, /if \(!shape \|\| \(shape\.fields \+ shape\.textareas \+ shape\.files < 2 && !framed\)\) continue;/);
  const watch = flow.slice(flow.indexOf('async function watchForFields'), flow.indexOf('export async function consider'));
  assert.ok(watch.indexOf('const framed') < watch.indexOf('await consider(live, jobUrl)'), 'judged again after the frame');
});
