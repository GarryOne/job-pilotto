// Settings → Logs: the app's logs on this Mac, for the user (and whoever helps them) to see what happened. One day at a
// time, 100 lines a page, a search capped at 100 hits (lib/log-view.js reads the files; the window never holds a whole
// log). Live: while the page is on screen, today's newest lines are read again every few seconds.
import {$, show} from './core.js';

const LIVE_MS = 3000, PAGE = 100;
const DAY_LABEL = new Intl.DateTimeFormat([], {weekday: 'short', day: 'numeric', month: 'short'});
let log = 'app', day = 'today', shown = PAGE, query = '', timer = null, searchTimer = null, reading = 0;

const onScreen = () => !$('setting-logs').closest('[hidden]') && document.visibilityState === 'visible';
const dayLabel = d => (d === 'today' ? 'Today' : DAY_LABEL.format(new Date(`${d}T12:00:00`)));
const size = bytes => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

async function loadDays() {
  const list = await window.pilot.logs.days(log).catch(() => []);
  if (!list.some(d => d.day === day)) day = list[0]?.day || 'today';
  $('logs-day').replaceChildren(...(list.length ? list : [{day: 'today', bytes: 0}]).map(d => {
    const option = new Option(`${dayLabel(d.day)}${d.bytes ? ` · ${size(d.bytes)}` : ''}`, d.day);
    option.selected = d.day === day;
    return option;
  }), new Option('Every day (search)', ''));
}

// Today's page, an older page ("Show older lines"), or the search's hits; the newest line at the bottom.
async function read({keepScroll = false} = {}) {
  const ticket = ++reading;
  const box = $('logs-lines');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  let result, stats;
  if (query) {
    result = await window.pilot.logs.search(log, query, {day}).catch(error => ({lines: [], error}));
    const where = !day ? 'in the last 30 days' : day === 'today' ? 'today' : `on ${dayLabel(day)}`;
    stats = result.lines.length ? `${result.lines.length}${result.more ? ' newest' : ''} line${result.lines.length === 1 ? '' : 's'} with "${query}" ${where}${result.more ? ' (more are older: narrow the search)' : ''}`
      : `No line with "${query}" ${where}.`;
  } else {
    result = await pages(shown).catch(error => ({lines: [], more: false, error}));
    const when = (day || 'today') === 'today' ? 'today' : dayLabel(day);
    stats = result.lines.length ? `The newest ${result.lines.length} line${result.lines.length === 1 ? '' : 's'} of ${when}` : `Nothing written ${when === 'today' ? 'today' : 'that day'} yet.`;
  }
  if (ticket !== reading) return;   // a newer read (another tab, day or search) already answered
  if (result.error) stats = `Couldn't read this log: ${result.error.message || result.error}`;
  $('logs-stats').textContent = stats;
  show($('logs-more'), !query && !!result.more);
  box.textContent = result.lines.join('\n');
  if (!keepScroll || atBottom) box.scrollTop = box.scrollHeight;
}
// The newest `count` lines, read a page of 100 at a time (the main process never sends more than a page).
async function pages(count) {
  const lines = [];
  let more = false;
  for (let skip = 0; skip < count; skip += PAGE) {
    const page = await window.pilot.logs.tail(log, {day: day || 'today', skip});
    lines.unshift(...page.lines);
    more = page.more;
    if (!more) break;
  }
  return {lines, more};
}

function live() {
  clearInterval(timer);
  timer = null;
  if (!$('logs-live').checked) return;
  timer = setInterval(() => {
    if (!onScreen()) { clearInterval(timer); timer = null; return; }   // started again when the page is opened
    if (!query && shown === PAGE && (day === 'today' || !day)) read({keepScroll: true});
  }, LIVE_MS);
}

// Settings → Logs opened (settings.js settingsPage): fresh days and lines, and live reading while it stays open.
export async function openLogs() {
  await loadDays();
  await read();
  live();
}

export function init() {
  document.querySelectorAll('[data-log]').forEach(tab => tab.addEventListener('click', async () => {
    log = tab.dataset.log;
    document.querySelectorAll('[data-log]').forEach(other => {
      other.classList.toggle('is-active', other === tab);
      other.setAttribute('aria-selected', String(other === tab));
    });
    day = 'today'; shown = PAGE;
    await loadDays();
    read();
  }));
  $('logs-day').addEventListener('change', () => { day = $('logs-day').value; shown = PAGE; read(); });
  $('logs-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = $('logs-search').value.trim(); shown = PAGE; read(); }, 300);
  });
  $('logs-more').addEventListener('click', () => { shown += PAGE; read({keepScroll: true}); });
  $('logs-live').addEventListener('change', live);
  $('logs-show').addEventListener('click', () => window.pilot.logs.show(log, day || 'today'));
}
