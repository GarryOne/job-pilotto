// One switch for every way into Claude (claude-help.js; owner, 9 Oct 2026). The class, not the case: every renderer file that draws a Claude entry point
// (a button or menu item that starts, resumes or messages Claude) must ask claudeHelp(); a new one added without it fails here. Plus: off by default,
// the extension preset and recommended in the Apply dialog, the Sessions empty state in the extension's words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const RENDERER = new URL('../renderer/', import.meta.url);
const files = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
const ENTRY = /['"`](▶ )?(Resume Claude|Apply with Claude|Tell Claude…)['"`]/;

test('every renderer file that draws a Claude entry point asks the one switch', () => {
  const drawing = files(RENDERER.pathname).filter(file => ENTRY.test(fs.readFileSync(file, 'utf8')));
  assert.ok(drawing.length >= 3, `found ${drawing.length} files`);
  for (const file of drawing) assert.match(fs.readFileSync(file, 'utf8'), /claudeHelp\(\)/, `${path.basename(file)} draws a Claude button without claudeHelp()`);
  const sessions = fs.readFileSync(new URL('pages/sessions.js', RENDERER), 'utf8');
  assert.equal((sessions.match(/actions\.push\(resume\(\)\)/g) || []).length, 1);   // only inside pushResume, which asks the switch
  assert.match(sessions, /const pushResume = \(\) => \{ if \(claudeHelp\(\)\) actions\.push\(resume\(\)\); \};/);
});

test('the switch is the settings value, off on a new install; the Apply dialog presets and recommends the extension; the copy speaks of Apply', async () => {
  const help = fs.readFileSync(new URL('claude-help.js', RENDERER), 'utf8');
  assert.match(help, /export const claudeHelp = \(\) => !!shared\.state\?\.settings\?\.claudeConsent;/);
  const html = fs.readFileSync(new URL('index.html', RENDERER), 'utf8');
  assert.match(html, /<b>Fill in Chrome with the extension<\/b> <span class="badge-recommended">Recommended<\/span>/);
  assert.doesNotMatch(html, /<b>Apply with Claude<\/b> <span class="badge-recommended">/);
  assert.doesNotMatch(html, /press <b>Apply with Claude<\/b> to start one/);
  assert.match(fs.readFileSync(new URL('pages/jobs.js', RENDERER), 'utf8'), /value="chrome"\]'\)\.checked = true;/);
});
