// A Ready to send row while the night works on it (owner, 18 Oct 2026: "2 rows, 2 progress bars", "a stop button once a row started", "a line with live updates"):
// its badge, its Stop (words, a secondary action), and under it a bar with the live line and a clock. The words come from ready-rows.js liveOf. Guard: test/ready-card.test.js.
import {el, pill} from '../components.js';
import {tick} from './ready-progress.js';

// live: liveOf(...). -> {badge, line}: the row's badge, and the full-width line under the row.
export function liveParts(live) {
  const badge = pill(live.badge, live.tone, {dot: live.badge !== 'waiting'});
  const line = el('div', 'ready-row-live'), bar = el('div', 'ready-bar'), fill = el('i', ''), text = el('div', 'ready-live-text muted');
  fill.style.width = `${live.percent}%`;
  bar.append(fill); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', String(live.percent));
  text.append(el('span', '', live.line));
  if (live.since) { text.append(el('span', 'ready-clock', '')); line.dataset.readySince = String(live.since); }
  line.append(bar, text);
  tick(line);   // the clock shows at once; the card's timer moves it
  return {badge, line};
}
