// The Ready to send line on Focus (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md), only on the owner's install: "3 forms ready for you to submit" above Up next, with a button to the card on Actions.
// A strip of its own (focus.js is near its size limit); it reads the same readyState as the card and shows nothing when no form is waiting. Guard: test/ready-site.test.js (waitingOf).
import {el} from '../components.js';
import {$} from './core.js';
import {openView} from './nav.js';
import {waitingOf} from './ready-rows.js';

let strip = null, reading = false;
async function paint() {
  if (reading) return;   // an activity event while the last read runs: one at a time
  reading = true;
  try { await show(); } finally { reading = false; }
}
async function show() {
  const state = await window.pilot.readyState().catch(() => null), waiting = state?.owner ? waitingOf(state.site?.jobs || []) : null;
  if (!waiting) { strip?.remove(); strip = null; return; }
  const anchor = $('focus-up-title')?.closest('section');
  if (!anchor) return;
  strip?.remove();
  strip = el('section', 'card ready-focus');
  const open = el('button', 'secondary', 'Open'); open.addEventListener('click', () => openView('actions'));
  strip.append(el('b', '', `Ready to send: ${waiting.ready} form${waiting.ready === 1 ? '' : 's'} filled overnight${waiting.left ? `, ${waiting.left} need you` : ''}`), open);
  anchor.before(strip);
}
export function initFocusReady() { paint(); window.addEventListener('activity-updated', paint); }
