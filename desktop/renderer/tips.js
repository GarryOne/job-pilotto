// The tip ticker on the Application sessions page (owner, 2 Oct 2026): one line of fact or advice scrolls right to left
// through a fixed frame, like the information boards in trains and buses, while the user applies. The pool is tips-pool.js.
// Pure parts (atsOf, nextTip) are tested; the rest draws the frame and keeps which tips were shown (localStorage).
import {el} from './components.js';
import {TIPS} from './tips-pool.js';

const SEEN_KEY = 'jp.tips.seen', HIDDEN_KEY = 'jp.tips.hidden';
const PIXELS_PER_SECOND = 55, MIN_SECONDS = 10, STILL_MS = 14000;

// Which application system a form is on, from its address (only the ones we have system-specific tips for).
export function atsOf(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  if (/(^|\.)greenhouse\.io$/.test(host)) return 'greenhouse';
  if (/(^|\.)lever\.co$/.test(host)) return 'lever';
  if (/(^|\.)ashbyhq\.com$/.test(host)) return 'ashby';
  if (/(^|\.)(myworkdayjobs|workday)\.com$/.test(host)) return 'workday';
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return 'smartrecruiters';
  return '';
}

// The next tip: never one already shown until all have been, system-specific tips only on their own system and first.
// Returns {tip, seen}; once everything was shown the list starts over (without repeating the last tip straight away).
export function nextTip({pool = TIPS, seen = [], ats = '', random = Math.random} = {}) {
  const fits = pool.filter(tip => !tip.ats || tip.ats === ats);
  if (!fits.length) return {tip: null, seen};
  let fresh = fits.filter(tip => !seen.includes(tip.id));
  let kept = seen.filter(id => fits.some(tip => tip.id === id));
  if (!fresh.length) {
    const last = kept[kept.length - 1];
    fresh = fits.filter(tip => tip.id !== last || fits.length === 1);
    kept = [];
  }
  const own = fresh.filter(tip => tip.ats === ats && ats);   // this system's tips come first
  const from = own.length ? own : fresh;
  const tip = from[Math.min(from.length - 1, Math.floor(random() * from.length))];
  return {tip, seen: [...kept, tip.id]};
}

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const still = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let ats = '', ticking = null;

function advance(slot) {
  const picked = nextTip({seen: read(SEEN_KEY, []), ats});
  if (!picked.tip) return;
  write(SEEN_KEY, picked.seen);
  const chip = slot.querySelector('.ss-tip-chip'), text = slot.querySelector('.ss-tip-text');
  chip.textContent = {research: 'Fact', recruiters: 'Recruiters say'}[picked.tip.evidence] || 'Tip';
  text.textContent = picked.tip.text;
  slot.title = picked.tip.source ? `Source: ${picked.tip.source}` : picked.tip.evidence === 'recruiters' ? 'What recruiters report in Reddit threads (2025-26): firsthand, a few threads each, not a survey' : '';
  if (!still()) text.style.animationDuration = `${Math.max(MIN_SECONDS, text.scrollWidth / PIXELS_PER_SECOND)}s`;
}

function build(slot) {
  const frame = el('div', 'ss-tip-frame');
  const text = el('span', 'ss-tip-text');
  frame.append(text);
  const hide = el('button', 'ss-tip-hide', '×');
  hide.type = 'button';
  hide.title = 'Hide tips';
  hide.addEventListener('click', () => { write(HIDDEN_KEY, true); clearInterval(ticking); ticking = null; paint(slot); });
  slot.replaceChildren(el('span', 'ss-tip-chip'), frame, hide);
  // The next tip starts when the last one has left the frame (the animation ran once through).
  text.addEventListener('animationiteration', () => advance(slot));
  advance(slot);
  if (still()) ticking = setInterval(() => advance(slot), STILL_MS);   // no motion: swap the line instead
}

function paint(slot) {
  slot.classList.toggle('is-still', Boolean(still()));
  if (read(HIDDEN_KEY, false)) {
    const show = el('button', 'ss-tip-show link-button', 'Show tips');
    show.type = 'button';
    show.addEventListener('click', () => { write(HIDDEN_KEY, false); paint(slot); });
    slot.replaceChildren(show);
    slot.classList.add('is-hidden');
    return;
  }
  slot.classList.remove('is-hidden');
  build(slot);
}

// Called whenever the sessions page is drawn: shows the ticker while there is a session, otherwise hides the slot.
export function syncTips({active, url = ''}) {
  const slot = document.getElementById('ss-tips');
  if (!slot) return;
  slot.hidden = !active;
  if (!active) return;
  ats = atsOf(url);
  if (!slot.dataset.ready) { slot.dataset.ready = '1'; paint(slot); }
}
