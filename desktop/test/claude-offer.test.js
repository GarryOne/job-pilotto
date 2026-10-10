// The session card's Claude offer (renderer/claude-offer.js; spec 2026-10-10-claude-finishes-stuck-pages.md part 3): the same three choices as the page's panel, through the same
// one-takeover-per-application guard. The view as a pure function, and the wiring (the card asks it, the press goes through lib/ladder/rung5-takeover.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {cardOffer} from '../renderer/claude-offer-view.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('the card offer: hidden without Claude ready or once dismissed; the consent line on the first press only', () => {
  assert.equal(cardOffer({help: false, dismissed: false, asking: false}), 'hidden');
  assert.equal(cardOffer({help: true, dismissed: true, asking: false}), 'hidden');
  assert.equal(cardOffer({help: true, dismissed: false, asking: false}), 'offer');
  assert.equal(cardOffer({help: true, dismissed: false, asking: true}), 'consent');
});

test('the stuck card draws the offer (not a lone "Apply with Claude") and the press goes through the guarded take-over', () => {
  const card = read('renderer/pages/sessions.js'), offer = read('renderer/claude-offer.js');
  assert.match(card, /offerParts\(item, \{rerender: \(\) => renderNextStep\(item\), after:/);
  assert.doesNotMatch(card.slice(card.indexOf('if (stuck) {'), card.indexOf('// Claude is the safety net')), /sessionButton\('Apply with Claude'/);
  assert.match(offer, /window\.pilot\.takeOverClaude\(/);
  assert.match(offer, /claudeHelp\(\)/);
  for (const words of ['Let Claude finish this page', 'I\'ll do it myself', 'Always let Claude finish when I\'m stuck', 'Claude works in this tab and stops before Submit']) assert.ok(offer.includes(words), words);
  assert.match(read('preload.cjs'), /takeOverClaude: call\('takeOverClaude'\)/);
  const handlers = read('lib/apply-handlers.js');
  assert.match(handlers, /ipcMain\.handle\('takeOverClaude', \(_, url, details, consent\) => takeOver\(/);
  assert.match(handlers, /server\.setTakeOverHandler\(takeOver\)/);   // the panel and the card: one guard
});
