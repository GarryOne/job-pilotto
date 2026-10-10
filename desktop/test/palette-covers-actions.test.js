// The ⌘K palette is how a person finds an action without knowing which page it is on. An Actions card whose Run button is neither a Telegram command (data-command)
// nor declared for the palette (data-palette) is invisible there (5 Oct 2026: "Tailor CVs for top matches" was missing from ⌘K).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {activitySource} from './activity-source.js';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'index.html'), 'utf8');

test('every Run button on an Actions card is in the command palette', () => {
  const cards = [...html.matchAll(/<div class="task-card">([\s\S]*?)<\/div>\s*<\/div>/g)].map(match => match[1]);
  assert.ok(cards.length >= 6, 'the Actions cards were not found');
  const missing = cards.filter(card => /class="[^"]*\baction\b/.test(card) && !/data-command="\w+"|data-palette="\w+"/.test(card)).map(card => card.match(/<b>([^<]+)<\/b>/)?.[1]);
  assert.deepEqual(missing, []);
});

// ⌘K right after Esc opens the palette again: the shortcut asks whether a palette is OPEN, not whether one is still in the page (6 Oct 2026: a closed one
// is removed a moment later, by its close event, and a ⌘K in between closed the closed one instead of opening it).
test('the ⌘K shortcut toggles on an open palette, not on a palette element', () => {
  const nav = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
  assert.match(nav, /if \(\$\('palette'\)\?\.open\) \$\('palette'\)\.close\(\); else openPalette/);
});

// One entry per task: a button elsewhere that starts what an Actions card starts (TASK_BUTTONS) is left out of ⌘K, in both the hand-listed buttons and the
// Settings sweep (6 Oct 2026: "Refresh jobs" and "Check for new jobs" were listed side by side and ran the same jobs check).
test('a button that starts a task an Actions card offers is not listed twice in ⌘K', async () => {
  const nav = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
  const activity = activitySource();
  const buttons = JSON.parse(activity.match(/export const TASK_BUTTONS = (\[.*\]);/)[1].replace(/'/g, '"'));
  const carded = new Set([...html.matchAll(/class="[^"]*\baction\b[^"]*" data-command="(\w+)"/g)].map(match => match[1]));
  assert.ok(carded.has('run') && carded.has('mail'), 'the Actions cards were not found');
  for (const [kind, ...selectors] of buttons) for (const selector of selectors) assert.ok(html.includes(`id="${selector.slice(1)}"`), `${kind}: ${selector} is not in the page`);
  assert.match(nav, /if \(node && !twins\.has\(node\)/);                         // button(view, id, …)
  assert.match(nav, /!node\.disabled && shown\(node\) && !twins\.has\(node\)/);   // the Settings sweep
  assert.match(nav, /if \(danger && buttons\.length === 1\) return;/);   // a section's sole danger button is its own entry ("Reset Job Pilotto" was listed twice)
});
