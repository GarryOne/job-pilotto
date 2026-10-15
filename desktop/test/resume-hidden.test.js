// "Resume Claude" is hidden everywhere while SHOW_RESUME_CLAUDE is off (owner, 15 Oct 2026). The class: every place that builds or offers it asks resumeOffered,
// and no text tells the person to press it. The places: the session card's button, its ⋯ menu entry, the log banner's button and the banner's wording.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const walk = dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

test('the flag is off, and resumeOffered follows it', async () => {
  globalThis.window = {pilot: {}, dispatchEvent() {}};
  const help = await import('../renderer/claude-help.js');
  assert.equal(help.SHOW_RESUME_CLAUDE, false);
  assert.equal(help.resumeOffered(), false);
});

test('every renderer line that builds or shows a Resume Claude entry is gated by resumeOffered', () => {
  const builders = [];
  for (const file of walk('renderer').filter(name => /\.js$/.test(name) && !name.endsWith('claude-help.js'))) {
    read(file).split('\n').forEach((line, index) => {
      if (/^\s*\/\//.test(line) || /const resume = \(\)/.test(line)) return;   // the builder itself: only pushResume offers it
      if (/['"`](?:▶ )?Resume Claude['"`]/.test(line) || /\bpushResume\(\)/.test(line) && !/const pushResume/.test(line) || /ss-offline-resume'\)\.hidden/.test(line)) builders.push([file, index + 1, line]);
    });
  }
  assert.ok(builders.length >= 3, 'the scan found the entries');
  for (const [file, number, line] of builders) {
    const gated = /resumeOffered\(\)/.test(line) || /pushResume = /.test(line) || /\bpushResume\(\)/.test(line);
    assert.ok(gated, `${file}:${number} offers Resume Claude without resumeOffered: ${line.trim().slice(0, 80)}`);
  }
  assert.match(read('renderer/pages/session-next-step.js'), /const pushResume = \(\) => \{ if \(resumeOffered\(\)\)/);
});

test('no text tells the person to press Resume Claude while it is hidden', () => {
  for (const file of [...walk('renderer').filter(name => /\.js$/.test(name)), 'lib/quit-dialog.js']) {
    read(file).split('\n').forEach((line, index) => {
      if (/^\s*\/\//.test(line) || /resumeOffered\(\)/.test(line) || /label: '▶ Resume Claude'/.test(line) || /sessionButton\('Resume Claude'/.test(line)) return;
      assert.doesNotMatch(line, /press Resume Claude|then Resume Claude|resume it to answer(?!.*resumeOffered)/, `${file}:${index + 1}`);
    });
  }
});
