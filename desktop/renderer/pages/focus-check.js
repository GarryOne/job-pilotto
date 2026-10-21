// The captcha line on Focus (owner, 21 Oct 2026: tabs stay hidden, "informed only when there is a captcha, then a button to deliberately focus the window"): while the extension holds a captcha in its
// hidden incognito window, one line above Up next says which site and offers "Show the check"; only that press brings the window forward, and the page is read once it is solved.
// A strip of its own (focus.js is near its size limit). The app keeps the list (lib/refused-reads.js refusedCheckWaiting). Guard: test/focus-check.test.js.
import {el} from '../components.js';
import {$} from './core.js';
import {checksOf, checkLine} from './check-rows.js';

let strip = null;
async function paint() {
  const hosts = checksOf((await window.pilot.state().catch(() => null))?.settings), anchor = $('focus-up-title')?.closest('section');
  if (!hosts.length || !anchor) { strip?.remove(); strip = null; return; }
  strip?.remove();
  strip = el('section', 'card ready-focus');
  const show = el('button', 'secondary', 'Show the check');
  show.addEventListener('click', async () => { await window.pilot.saveSettings({refusedShowCheck: true}); show.textContent = 'Opening in a moment…'; show.disabled = true; });
  const words = el('span', '', '');
  words.append(el('b', '', checkLine(hosts)), ' · ', el('span', 'muted', 'Solve it in the window; the page is read after.'));
  strip.append(words, show);
  anchor.before(strip);
}
export function initFocusCheck() { paint(); window.addEventListener('activity-updated', paint); setInterval(paint, 30000); }
