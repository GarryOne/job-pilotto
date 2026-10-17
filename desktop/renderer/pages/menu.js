// The sidebar's progressive pages: Interviews, Reports and Employers appear when they have something, a "More" row lists the others with when they unlock, and a one-time tour points at the menu. Rules in renderer/menu-reveal.js and menu-tour.js; guarded by test/menu-reveal.test.js.
import {icon} from '../icons.js';
import {$, show} from './core.js';
import {shared} from './shared.js';
import {lastActivity} from './activity.js';
import {openView} from './nav.js';
import * as reveal from '../menu-reveal.js';
import {STEP_MS, markSeen, seen, stopsFor} from '../menu-tour.js';

let menu = reveal.load(window.localStorage);
let employerCount = null, employersCheckedAt = 0;
const MORE_KEY = 'jp.menu.more';
const moreOpen = () => { try { return window.localStorage.getItem(MORE_KEY) === 'open'; } catch { return false; } };

// Signals from what the app already holds: an application exists (or an interview is booked), a weekly report was made, an employer is listed.
const signals = () => ({
  applied: (shared.allJobs || []).some(job => job.status === 'applied' || job.next_interview),
  weeklyReport: (Array.isArray(lastActivity) ? lastActivity : lastActivity?.runs || []).some(run => run?.kind === 'weekly' && !/fail/i.test(run.status || '')),
  employers: employerCount > 0,
});

// Employers is a store read: at most one every five minutes, and none once the page is in the menu.
async function checkEmployers() {
  if (menu.revealed.includes('employers') || Date.now() - employersCheckedAt < 300000) return;
  employersCheckedAt = Date.now();
  const answer = await window.pilot.employers?.().catch(() => null);
  if (Array.isArray(answer?.employers)) { employerCount = answer.employers.length; refreshMenu(); }
}

function drawMore() {
  const locked = reveal.stillLocked(menu);
  show($('nav-more'), locked.length > 0);
  $('nav-more-title').textContent = `More · ${locked.length}`;
  const open = moreOpen();
  $('nav-more-head').setAttribute('aria-expanded', String(open));
  show($('nav-more-list'), open);
  $('nav-more-list').replaceChildren(...locked.map(page => {
    const row = Object.assign(document.createElement('button'), {className: 'nav-locked', type: 'button', title: `${page.label}: opens ${page.when}`});
    const words = Object.assign(document.createElement('span'), {className: 'nav-locked-words'});
    words.append(page.label, Object.assign(document.createElement('small'), {textContent: page.when}));
    row.append(icon(page.icon), words);
    row.dataset.locked = page.name;
    row.addEventListener('click', () => openView(page.view));   // the page opens (and joins the menu); its own empty state explains it
    return row;
  }));
}

export function refreshMenu(opened = null) {
  menu = reveal.nextState(menu, signals(), opened);
  reveal.save(window.localStorage, menu);
  for (const name of Object.keys(reveal.PROGRESSIVE)) {
    const {shown, dot} = reveal.looks(menu, name);
    $(`nav-${name}`).hidden = !shown;
    $(`nav-${name}`).querySelector('.nav-dot').hidden = !dot;
  }
  drawMore();
}

// The tour: a small card by each stop, five stops, moving on by itself every few seconds; Skip (or Esc) ends it, and it is never shown again.
function tour() {
  if (seen(window.localStorage) || $('app').hidden) return;
  const present = selector => { const node = document.querySelector(selector); return !!node && !node.closest('[hidden]') && node.offsetParent !== null; };
  const stops = stopsFor(present);
  if (!stops.length) return;
  const card = document.createElement('div');
  card.className = 'menu-tour'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Menu tour');
  const title = document.createElement('b'), text = document.createElement('span'), count = document.createElement('small');
  const next = Object.assign(document.createElement('button'), {className: 'primary', textContent: 'Next'});
  const skip = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Skip'});
  const row = document.createElement('div'); row.className = 'menu-tour-row'; row.append(count, skip, next);
  card.append(title, text, row);
  document.body.append(card);
  let at = -1, timer = null;
  const end = () => { clearTimeout(timer); card.remove(); document.querySelectorAll('.menu-tour-lit').forEach(node => node.classList.remove('menu-tour-lit')); document.removeEventListener('keydown', onKey); markSeen(window.localStorage); };
  const onKey = event => { if (event.key === 'Escape') end(); };
  const go = () => {
    clearTimeout(timer);
    at += 1;
    if (at >= stops.length) return end();
    const stop = stops[at], rect = document.querySelector(stop.target).getBoundingClientRect();
    title.textContent = stop.title; text.textContent = stop.text; count.textContent = `${at + 1} of ${stops.length}`;
    next.textContent = at === stops.length - 1 ? 'Done' : 'Next';
    card.style.top = `${Math.max(8, Math.round(rect.top + rect.height / 2 - 40))}px`;
    card.style.left = `${Math.round(rect.right + 12)}px`;
    document.querySelectorAll('.menu-tour-lit').forEach(node => node.classList.remove('menu-tour-lit'));
    document.querySelector(stop.target).classList.add('menu-tour-lit');
    timer = setTimeout(go, STEP_MS);
  };
  next.addEventListener('click', go);
  skip.addEventListener('click', end);
  document.addEventListener('keydown', onKey);
  go();
}

export function initMenu() {
  document.addEventListener('menu:refresh', () => { refreshMenu(); checkEmployers(); });
  window.addEventListener('activity-updated', () => { refreshMenu(); checkEmployers(); });   // a weekly report was made; a search may have added employers
  $('nav-more-head').addEventListener('click', () => {
    try { window.localStorage.setItem(MORE_KEY, moreOpen() ? 'closed' : 'open'); } catch { /* not remembered */ }
    drawMore();
  });
  refreshMenu();
  checkEmployers();
  setTimeout(tour, 2500);   // after the first screen has settled
}
