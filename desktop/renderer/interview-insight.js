// Interviews → the Insights card: what the reviewed interviews say together (src/ai/interview_insights.py, one
// 💡 Insights row in Notion, updated after each review). Pure view code: insightView() decides what to show,
// insightCard() draws it; pages/interviews.js wires Refresh and the links to the library rows.
import {el, pill} from './components.js';
import {icon} from './icons.js';

const CONFIDENCE = {high: ['good', 'High confidence'], medium: ['info', 'Medium confidence'], low: ['neutral', 'Low confidence']};

export function ago(at, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60000));
  if (!at || Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

// null: no card (no reviewed interview). Otherwise what the card says. rows: the library rows (reviewed = overall set).
export function insightView(insight, rows = [], now = Date.now()) {
  // A row written by another version may lack a field or hold another type: read every list defensively, so the
  // card can't throw (it once took the library down with it: pages/interviews.js renders both apart now).
  const list = value => (Array.isArray(value) ? value : []);
  rows = list(rows);
  const reviewed = rows.filter(row => row?.overall);
  if (!reviewed.length) return null;
  const known = new Map(rows.map(row => [row.id, row.title]));
  for (const item of list(insight?.interviews)) if (!known.has(item?.id)) known.set(item?.id, item?.title);
  const link = id => ({id, title: known.get(id) || 'Interview', inLibrary: rows.some(row => row.id === id)});
  if (!insight) {
    return {empty: true, reviewed: reviewed.length, headline: 'No insights yet',
      basis: `${reviewed.length} reviewed interview${reviewed.length === 1 ? '' : 's'} · Refresh to read them together`};
  }
  const n = Number(insight.sample) || list(insight.interviews).length || 0;
  const pending = reviewed.filter(row => !list(insight.interviews).some(item => item?.id === row.id)).length;
  const when = ago(insight.updated, now);
  const basis = [`Based on ${n} interview${n === 1 ? '' : 's'}`, when && `updated ${when}`,
    pending && `${pending} new review${pending === 1 ? '' : 's'} not included yet`].filter(Boolean).join(' · ');
  const patterns = list(insight.patterns).map(p => ({text: String(p?.text || ''), round: p?.round_type, tentative: !!p?.tentative || n < 2,
    tag: p?.tentative || n < 2 ? 'Tentative' : `${list(p?.interviews).length} interviews`, links: list(p?.interviews).map(link)}))
    .filter(p => p.text);
  // A row written before its Data column existed: its text columns, as lines.
  const lines = text => String(text || '').split('\n').map(line => line.replace(/^\s*•\s*/, '').trim()).filter(Boolean);
  const steps = list(insight.next_steps).length
    ? list(insight.next_steps).map(s => ({text: String(s?.text || ''), links: list(s?.interviews).map(link)})).filter(s => s.text)
    : lines(insight.action).map(text => ({text, links: []}));
  const bullets = String(insight.evidence || '').split('\n').filter(line => /^\s*•/.test(line));  // not the quotes under them
  const fallback = !patterns.length && !insight.nothing_useful ? lines(bullets.join('\n')) : [];
  return {headline: String(insight.headline || 'Insights'), basis, pending, confidence: CONFIDENCE[insight.confidence] || CONFIDENCE.low,
    patterns: patterns.length ? patterns : fallback.map(text => ({text, tag: '', links: []})), steps,
    nothing: !!insight.nothing_useful, url: insight.url || ''};
}

// The card's body. open(id): show that interview in the library; refresh(): the Refresh button; busy: it's running.
export function insightCard(view, {open = () => {}, refresh = () => {}, busy = false, note = ''} = {}) {
  const head = el('div', 'iv-insight-head');
  const title = el('h2', 'with-glyph');
  title.append(icon('bulb'), 'Insights');
  const side = el('div', 'iv-insight-side');
  if (note) side.append(el('span', 'muted small', note));
  const button = Object.assign(el('button', 'secondary with-icon small-btn iv-insight-refresh'), {type: 'button', disabled: busy,
    title: 'Reads your reviewed interviews together. Claude is only asked when a review changed (about $0.05)'});
  button.append(busy ? el('span', 'spinner small') : icon('refresh'), el('span', '', busy ? 'Refreshing…' : 'Refresh insights'));
  button.addEventListener('click', () => refresh());
  side.append(button);
  head.append(title, side);

  const top = el('div', 'iv-insight-top');
  const words = el('div', 'iv-insight-words');
  words.append(el('div', 'focus-headline', view.headline), el('div', 'muted small iv-insight-basis', view.basis));
  top.append(words);
  if (view.confidence) top.append(pill(view.confidence[1], view.confidence[0], {dot: true}));

  const links = items => {
    const span = el('span', 'iv-insight-links');
    items.forEach((item, i) => {
      if (i) span.append(', ');
      const a = Object.assign(el('button', 'link small', item.title), {type: 'button', title: 'Show this interview in the library'});
      a.addEventListener('click', () => open(item.id));
      span.append(a);
    });
    return span;
  };
  const list = (label, items, withTag) => {
    const block = el('div', 'iv-insight-block');
    block.append(el('div', 'iv-insight-label', label));
    const ul = el('ul', 'iv-insight-list');
    for (const item of items) {
      const li = el('li', '');
      li.append(el('span', '', item.text));
      if (withTag && item.tag) li.append(' ', pill(item.tag, item.tentative ? 'neutral' : 'info'));
      if (item.links.length) li.append(el('span', 'muted small', ' · '), links(item.links));
      ul.append(li);
    }
    block.append(ul);
    return block;
  };
  const body = [head, top];
  if (!view.empty && view.patterns.length) body.push(list('Patterns', view.patterns, true));
  if (!view.empty && view.steps.length) body.push(list('What to do next', view.steps, false));
  return body;
}

// Loading, with nothing saved yet: the card's shape, shimmering.
export function insightSkeleton() {
  const bone = cls => el('span', `skeleton ${cls}`);
  const box = el('div', 'iv-insight-top is-loading');
  const words = el('div', 'iv-insight-words');
  words.append(bone('w-60 tall'), bone('w-40'), bone('w-80'), bone('w-80'));
  box.append(words);
  return [box];
}
