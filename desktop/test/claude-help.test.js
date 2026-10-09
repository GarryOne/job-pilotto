// One switch for every way into Claude (claude-help.js; owner, 9 Oct 2026). The class, not the case: every renderer file that draws a Claude entry point
// (a button or menu item that starts, resumes or messages Claude) must ask claudeHelp(); a new one added without it fails here. Plus: off by default,
// the extension preset and recommended in the Apply dialog, the Sessions empty state in the extension's words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const RENDERER = new URL('../renderer/', import.meta.url);
const files = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
const ENTRY = /['"`](▶ )?(Resume Claude|Apply with Claude|Tell Claude…|Change with Claude…|Read with Claude)['"`]|`Reply "\$\{/;   // buttons, a menu's option, a reply to Claude

test('every renderer file that draws a Claude entry point asks the one switch', () => {
  const drawing = files(fileURLToPath(RENDERER)).filter(file => ENTRY.test(fs.readFileSync(file, 'utf8')));
  assert.ok(drawing.length >= 3, `found ${drawing.length} files`);
  // Asks the switch itself, or is told by its caller through an explicit `claude` flag (answer-options.js: session-needs.js passes claudeHelp()).
  for (const file of drawing) assert.match(fs.readFileSync(file, 'utf8'), /claudeHelp\(\)|if \(claude\) /, `${path.basename(file)} draws a Claude button without claudeHelp()`);
  assert.match(fs.readFileSync(new URL('pages/session-needs.js', RENDERER), 'utf8'), /answerOptions\(need, knownAnswers, \{claude: claudeHelp\(\)\}\)/);
  const sessions = fs.readFileSync(new URL('pages/sessions.js', RENDERER), 'utf8');
  assert.equal((sessions.match(/actions\.push\(resume\(\)\)/g) || []).length, 1);   // only inside pushResume, which asks the switch
  assert.match(sessions, /const pushResume = \(\) => \{ if \(claudeHelp\(\)\) actions\.push\(resume\(\)\); \};/);
});

test('the switch is the settings value, off on a new install; the Apply dialog presets and recommends the extension; the copy speaks of Apply', async () => {
  const help = fs.readFileSync(new URL('claude-help.js', RENDERER), 'utf8');
  assert.match(help, /export const claudeHelp = \(\) => !!shared\.state\?\.settings\?\.claudeConsent && claudeFeatures\(\);/);   // and the Claude family only
  const html = fs.readFileSync(new URL('index.html', RENDERER), 'utf8');
  assert.match(html, /<b>Fill in Chrome with the extension<\/b> <span class="badge-recommended">Recommended<\/span>/);
  assert.doesNotMatch(html, /<b>Apply with Claude<\/b> <span class="badge-recommended">/);
  assert.doesNotMatch(html, /press <b>Apply with Claude<\/b> to start one/);
  assert.match(fs.readFileSync(new URL('pages/jobs.js', RENDERER), 'utf8'), /value="chrome"\]'\)\.checked = true;/);
});

test('the Claude install checklist is under the Settings switch too, shown only while it is on', () => {
  const html = fs.readFileSync(new URL('index.html', RENDERER), 'utf8');
  assert.match(html, /<ul class="prereqs" id="claude-prereqs-settings" hidden><\/ul>/);   // the same list style as the wizard's, hidden until the switch is on
  const prereqs = fs.readFileSync(new URL('pages/claude-prereqs.js', RENDERER), 'utf8');
  assert.match(prereqs, /inSettings\.hidden = !claudeHelp\(\);/);
  assert.match(prereqs, /for \(const list of \[\$\('claude-prereqs'\), inSettings\]/);   // one checklist, drawn in both places
  assert.match(prereqs, /window\.addEventListener\('claude-help', \(\) => showClaudePrereqs\(\)\);/);   // turned on: it shows at once
});
