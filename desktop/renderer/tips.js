// The tip ticker on the Application sessions page (owner, 2 Oct 2026): one line of fact or advice scrolls right to left
// through a fixed frame, like the information boards in trains and buses, while the user applies. The pool is tips-pool.js.
// Pure parts (atsOf, nextTip) are tested; the rest draws the frame and keeps which tips were shown (localStorage).
import {el} from './components.js';
import {TIPS} from './tips-pool.js';

// A tip that carries an IT example is marked `for: 'it'` in the pool and shown only to a candidate who is looking for IT work (renderer/audience.js, asked of the app once).
let technical = false, audienceAt = 0;
function askAudience() {   // at most once a minute: a changed strategy reaches the tips without a restart
  if (Date.now() - audienceAt < 60000) return;
  audienceAt = Date.now();
  window.pilot?.audience?.().then(answer => { technical = Boolean(answer?.technical); }).catch(() => {});
}

const SEEN_KEY = 'jp.tips.seen', HIDDEN_KEY = 'jp.tips.hidden';
const PIXELS_PER_SECOND = 55, MIN_SECONDS = 10, STILL_MS = 14000;
const MIN_GAP_MS = MIN_SECONDS * 500;   // a real tip is on screen at least MIN_SECONDS: two advances closer than half of that are a burst

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
export function nextTip({pool = TIPS, seen = [], ats = '', categories = null, random = Math.random, technical: it = false} = {}) {
  const system = pool.filter(tip => (!tip.ats || tip.ats === ats) && (tip.for !== 'it' || it));
  const topical = categories?.length ? system.filter(tip => categories.includes(tip.category)) : [];
  const fits = topical.length ? topical : system;   // a page's own topics, else any tip
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

// One bar per page that shows tips: the Application sessions page (its address decides which system's tips come first) and, on the other stops, the topics
// of that stop. Hiding is global: one × hides the bars everywhere, "Show tips" brings them back.
const ATS = new WeakMap(), TICK = new WeakMap(), LAST = new WeakMap();

// Whether a tip may be swapped now. A window in the background throttles its animations and timers; on refocus the browser delivers every missed
// animationiteration at once, and each one used to swap the line, so the bar flashed through tips in a few milliseconds (owner, 9 Oct 2026).
// Never while the window is hidden, and never twice inside MIN_GAP_MS: the burst advances one tip, the rest are dropped.
export function mayAdvance({now, last = 0, hidden = false, minGap = MIN_GAP_MS} = {}) {
  return !hidden && now - last >= minGap;
}
// Back in view: the line starts again from its start, in step with the clock, instead of catching up on what it missed.
function restart(text) { text.style.animation = 'none'; void text.offsetWidth; text.style.animation = ''; }

function advance(slot, {force = false} = {}) {
  if (!force && !mayAdvance({now: Date.now(), last: LAST.get(slot), hidden: document.hidden})) return;
  LAST.set(slot, Date.now());
  askAudience();
  const picked = nextTip({seen: read(SEEN_KEY, []), ats: ATS.get(slot) || '', categories: slot.dataset.categories?.split(',') || null, technical});
  if (!picked.tip) return;
  write(SEEN_KEY, picked.seen);
  const chip = slot.querySelector('.ss-tip-chip'), text = slot.querySelector('.ss-tip-text');
  chip.textContent = {research: 'Fact', recruiters: 'Recruiters say', 'to-test': 'Worth trying'}[picked.tip.evidence] || 'Tip';
  text.textContent = picked.tip.text;
  slot.title = picked.tip.source ? `Source: ${picked.tip.source}` : picked.tip.evidence === 'recruiters' ? 'What recruiters report in Reddit threads (2025-26): firsthand, a few threads each, not a survey' : '';
  pace(text);
}

// The same speed on every bar and window width. A bar built while its page is hidden measures 0 wide, so it falls back to
// MIN_SECONDS for a strip later ~2,500px wide (Focus/Jobs/Interviews ran 3-5x too fast, 6 Oct 2026): build() measures again on resize.
export function secondsFor(width) { return Math.max(MIN_SECONDS, width / PIXELS_PER_SECOND); }
function pace(text) { if (!still() && text.scrollWidth) text.style.animationDuration = `${secondsFor(text.scrollWidth)}s`; }

function build(slot) {
  const frame = el('div', 'ss-tip-frame');
  const text = el('span', 'ss-tip-text');
  frame.append(text);
  const hide = el('button', 'ss-tip-hide', '×');
  hide.type = 'button';
  hide.title = 'Hide tips';
  hide.addEventListener('click', () => { write(HIDDEN_KEY, true); repaintAll(); });
  slot.dataset.guidance = 'tip';   // the UI Finder checks the words of guidance against who the candidate is (desktop/e2e/lib/uicheck.mjs)
  slot.replaceChildren(el('span', 'ss-tip-chip'), frame, hide);
  // The next tip starts when the last one has left the frame (the animation ran once through).
  text.addEventListener('animationiteration', () => advance(slot));
  advance(slot, {force: true});   // a bar just built always shows its first line
  globalThis.ResizeObserver && new ResizeObserver(() => pace(text)).observe(frame);   // shown for the first time, or the window resized
  clearInterval(TICK.get(slot));
  if (still()) TICK.set(slot, setInterval(() => advance(slot), STILL_MS));   // no motion: swap the line instead
}

function paint(slot) {
  slot.classList.toggle('is-still', Boolean(still()));
  if (read(HIDDEN_KEY, false)) {
    const show = el('button', 'ss-tip-show link-button', 'Show tips');
    show.type = 'button';
    show.addEventListener('click', () => { write(HIDDEN_KEY, false); repaintAll(); });
    clearInterval(TICK.get(slot));
    slot.replaceChildren(show);
    slot.classList.add('is-hidden');
    return;
  }
  slot.classList.remove('is-hidden');
  build(slot);
}

// Refocused: restart each line cleanly, never replay what the background held back.
globalThis.document?.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const slot of document.querySelectorAll('.ss-tips[data-ready]')) { const text = slot.querySelector('.ss-tip-text'); if (text) restart(text); }
});

const barsOnScreen = () => [...document.querySelectorAll('.ss-tips[data-ready]')];
function repaintAll() { for (const slot of barsOnScreen()) paint(slot); }

// A bar on another stop's page (Jobs, Focus, Interviews): shows the tips about that stop.
export function mountStageTips(id, categories) {
  const slot = document.getElementById(id);
  if (!slot || slot.dataset.ready) return;
  askAudience();
  slot.dataset.categories = categories.join(',');
  slot.dataset.ready = '1';
  paint(slot);
}

// Called whenever the sessions page is drawn: shows the ticker while there is a session, otherwise hides the slot.
export function syncTips({active, url = ''}) {
  const slot = document.getElementById('ss-tips');
  if (!slot) return;
  slot.hidden = !active;
  if (!active) return;
  ATS.set(slot, atsOf(url));
  askAudience();
  if (!slot.dataset.ready) { slot.dataset.ready = '1'; paint(slot); }
}
