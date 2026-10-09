// Interviews → the Insights card: what the reviewed interviews say together (src/ai/interview_insights.py, one
// 💡 Insights row in Notion, updated after each review). Pure view code: insightView() decides what to show,
// insightCard() draws it; pages/interviews.js wires Refresh and the links to the library rows.
import {ai} from './ai-name.js';
import {el, pill} from './components.js';
import {icon} from './icons.js';
import {minutes} from './practice-session.js';
import {where} from './store-name.js';

const CONFIDENCE = {high: ['good', 'High confidence'], medium: ['info', 'Medium confidence'], low: ['neutral', 'Low confidence']};
const CONFIDENCE_TIP = {low: 'Based on a limited number of interviews: it may change as you add more.',
  medium: 'Consistent across several interviews, but still a small sample.', high: 'Consistent across many interviews.'};
const DISCLAIMER = 'These insights are suggestions based on a limited number of interviews and may not be definitive.';

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
  // "Patterns across 2 recruiter screens · Updated 2 h ago": the round type when they are all the same one.
  const rounds = list(insight.interviews).map(item => item?.round_type).filter(Boolean);
  const same = rounds.length && rounds.every(round => round === rounds[0]) ? rounds[0].toLowerCase() : 'interview';
  const subtitle = [`Patterns across ${n} ${same}${n === 1 ? '' : 's'}`, when && `Updated ${when}`,
    pending ? `${pending} new review${pending === 1 ? '' : 's'} not included yet` : insight.outdated ? 'A review changed since · Refresh to update'
      : olderFormat(insight) && 'Written by an older version · Refresh to update']
    .filter(Boolean).join(' · ');
  const company = id => String(link(id).title).split(' · ')[0].trim() || 'Interview';
  const patterns = list(insight.patterns).map(p => {
    const titled = !!String(p?.title || '').trim();
    const companies = [...new Map(list(p?.interviews).map(id => [company(id), {id, name: company(id)}])).values()];  // one chip per employer
    return {text: String(p?.text || ''), round: p?.round_type, tentative: !!p?.tentative || n < 2,
      kind: ['weakness', 'strength'].includes(p?.kind) ? p.kind : 'note', title: titled ? String(p.title).trim() : String(p?.text || ''),
      detail: titled ? String(p?.text || '') : '', tag: p?.tentative || n < 2 ? 'Tentative' : `${list(p?.interviews).length} interviews`,
      quotes: list(p?.evidence).filter(e => String(e?.quote || '').trim()).length, companies, links: list(p?.interviews).map(link)};
  }).filter(p => p.text);
  // A row written before its Data column existed: its text columns, as lines.
  const lines = text => String(text || '').split('\n').map(line => line.replace(/^\s*•\s*/, '').trim()).filter(Boolean);
  const steps = (list(insight.next_steps).length
    ? list(insight.next_steps).map(s => ({text: String(s?.text || ''), title: String(s?.title || '').trim(), focus: String(s?.focus || '').trim(), done: !!s?.done,
      links: list(s?.interviews).map(link)})).filter(s => s.text)
    : lines(insight.action).map(text => ({text, title: '', focus: '', done: false, links: []})))
    .map((s, i) => ({...s, n: i + 1, title: s.title || s.text, detail: s.title ? s.focus || s.text : ''}));
  const bullets = String(insight.evidence || '').split('\n').filter(line => /^\s*•/.test(line));  // not the quotes under them
  const fallback = !patterns.length && !insight.nothing_useful ? lines(bullets.join('\n')) : [];
  const confidence = CONFIDENCE[insight.confidence] || CONFIDENCE.low;
  const quotes = list(insight.patterns).reduce((sum, p) => sum + list(p?.evidence).length, 0);
  return {title: 'Interview insights', subtitle, headline: String(insight.headline || 'Insights'), basis, pending, confidence,
    chip: {text: `${confidence[1]} · ${n} interview${n === 1 ? '' : 's'}`, tone: confidence[0], level: CONFIDENCE[insight.confidence] ? insight.confidence : 'low', tip: CONFIDENCE_TIP[insight.confidence] || CONFIDENCE_TIP.low},
    primary: {headline: String(insight.headline || 'Insights'), detail: String(insight.headline_detail || ''), tag: n ? `Seen in ${n} interview${n === 1 ? '' : 's'}` : ''},
    patterns: patterns.length ? patterns : fallback.map(text => ({text, title: text, detail: '', kind: 'note', tag: '', companies: [], links: []})), steps,
    supporting: quotes && insight.url ? {count: quotes, url: insight.url} : null,
    // The quotes behind each pattern (View supporting moments), each with the employer of the interview it came from.
    moments: list(insight.patterns).map(p => ({title: String(p?.title || '').trim() || String(p?.text || ''),
      quotes: list(p?.evidence).filter(e => String(e?.quote || '').trim()).map(e => ({quote: String(e.quote).trim(), id: e.interview, name: company(e.interview), where: link(e.interview).title}))}))
      .filter(group => group.quotes.length),
    practice: {pending: steps.filter(s => !s.done).length, minutes: minutes(steps.filter(s => !s.done).length)},
    disclaimer: ['low', 'medium'].includes(insight.confidence) || !insight.confidence ? DISCLAIMER : '',
    nothing: !!insight.nothing_useful, url: insight.url || ''};
}

// An insight written by an older version of the prompt (src/ai/interview_insights.py DATA_VERSION, now 6): the card says
// so and you choose when to Refresh. Never refreshed by itself: that spent on its own and raced other refreshes.
export const olderFormat = insight => !!insight && (Number(insight.version) || 1) < 6;

// The card (the 30 Sep 2026 mockup). open(id): show that interview in the library; openUrl(url): the insight row in Notion;
// refresh(): the Refresh button; onTick(step, done): a "Practice next" tick box; onPractice(): Start practice session;
// onMoments(): View supporting moments; busy: it's running.
// collapsed: only the header (its arrow, onToggle(), folds and unfolds the rest). updating: this is this Mac's saved
// copy while Notion is read (a small spinner by the chip).
export function insightCard(view, {open = () => {}, onMoments = () => {}, onPractice = () => {}, refresh = () => {}, onTick = () => {}, onToggle = () => {},
  collapsed = false, busy = false, note = '', updating = false} = {}) {
  const head = el('div', 'iv-insight-head');
  const title = el('div', 'iv-insight-title');
  const h2 = el('h2', 'with-glyph');
  const toggle = Object.assign(el('button', 'ghost iv-insight-toggle'), {type: 'button', title: collapsed ? 'Show the insights' : 'Hide the insights'});
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', collapsed ? 'Show the insights' : 'Hide the insights');
  toggle.append(icon('chevron'));  // its click (or Enter) bubbles to the bar, which does the folding
  h2.append(icon('bulb'), view.title || 'Interview insights', toggle);  // the arrow sits right after the title
  title.append(h2, el('div', 'muted small iv-insight-basis', view.subtitle || view.basis));

  const side = el('div', 'iv-insight-side');
  if (note) side.append(el('span', 'muted small', note));
  if (updating) {  // this Mac's saved copy is on screen while Notion is read: a small spinner, explained on hover
    const sync = el('span', 'spinner small iv-insight-sync');
    sync.title = `Checking ${where()} for a newer version`;
    side.append(sync);
  }
  if (view.chip) {  // a ring that fills with the confidence, the words, and what the words mean on hover
    const chip = el('span', 'iv-confidence');
    chip.dataset.level = view.chip.level;
    chip.title = view.chip.tip;
    chip.append(el('span', 'iv-ring'), el('span', '', view.chip.text), icon('info'));
    chip.addEventListener('click', event => event?.stopPropagation());  // only text: clicking it never folds the card
    side.append(chip);
  }
  const button = Object.assign(el('button', 'secondary with-icon small-btn iv-insight-refresh'), {type: 'button', disabled: busy,
    title: ai('Reads your reviewed interviews together. {AI:big} is only asked when a review changed')});
  button.append(busy ? el('span', 'spinner small') : icon('refresh'), el('span', '', busy ? 'Refreshing…' : 'Refresh insights'));
  button.addEventListener('click', event => { event?.stopPropagation(); refresh(); });  // on the bar, but it only refreshes
  side.append(button);
  head.append(title, side);
  // Anywhere on the bar folds and unfolds the card, except when the click ends a text selection.
  head.addEventListener('click', () => { if (!String(globalThis.window?.getSelection?.() || '')) onToggle(); });
  head.classList.add('is-clickable');
  if (collapsed) return [head];

  const signal = el('div', 'iv-insight-top iv-signal');
  const words = el('div', 'iv-insight-words');
  if (!view.empty) words.append(el('div', 'iv-signal-label', 'Primary signal'));
  words.append(el('div', 'focus-headline', view.primary?.headline || view.headline));
  const detail = view.empty ? view.basis : view.primary?.detail;
  if (detail) words.append(el('div', 'muted small iv-insight-basis', detail));
  signal.append(words);
  if (view.primary?.tag && !view.empty) signal.append(pill(view.primary.tag, 'info'));

  const body = [head, signal];
  if (view.empty) return body;
  const columns = el('div', 'iv-insight-cols');
  if (view.patterns.length) {
    const block = el('div', 'iv-patterns');
    block.append(el('h3', '', 'Patterns observed'));
    for (const p of view.patterns) {
      const row = el('div', 'iv-pattern');
      const tile = el('span', `iv-tile is-${p.kind}`);
      tile.append(icon(p.kind === 'weakness' ? 'alert' : p.kind === 'strength' ? 'chart' : 'file'));
      const text = el('div', 'iv-row-words');
      text.append(el('b', '', p.title));
      if (p.detail) text.append(el('span', 'muted', p.detail));
      const chips = el('div', 'iv-chips');
      if (p.tag) chips.append(pill(p.tag, p.tentative ? 'neutral' : 'info'));
      if (p.quotes) {  // the evidence: opens the moments at this pattern
        const evidence = Object.assign(el('button', 'iv-chip iv-quotes', `${p.quotes} quote${p.quotes === 1 ? '' : 's'}`), {type: 'button', title: 'Show the quotes behind this pattern'});
        evidence.addEventListener('click', event => { event?.stopPropagation(); onMoments(p.title); });
        chips.append(evidence);
      }
      for (const c of p.companies || []) {
        const chip = Object.assign(el('button', 'iv-chip', c.name), {type: 'button', title: 'Show this interview in the library'});
        chip.addEventListener('click', () => open(c.id));
        chips.append(chip);
      }
      row.append(tile, text, chips);
      block.append(row);
    }
    columns.append(block);
  }
  if (view.steps.length) {
    const block = el('div', 'iv-practice');
    block.append(el('h3', '', 'Practice next'));
    for (const step of view.steps) {
      const row = el('div', `iv-step${step.done ? ' is-done' : ''}`);
      const text = el('div', 'iv-row-words');
      text.append(el('b', '', step.title));
      if (step.detail) text.append(el('span', 'muted', step.detail));
      const box = Object.assign(el('input', 'iv-step-box'), {type: 'checkbox', checked: !!step.done, title: 'Mark it done'});
      box.setAttribute('aria-label', `Done: ${step.title}`);
      box.addEventListener('change', () => onTick(step, !!box.checked));
      row.append(el('span', 'iv-step-n', String(step.n)), text, box);
      block.append(row);
    }
    if (view.practice?.pending) {
      const actions = el('div', 'iv-practice-foot');
      const start = Object.assign(el('button', 'secondary iv-practice-start', 'Start practice session'), {type: 'button'});
      start.addEventListener('click', () => onPractice());
      actions.append(start, el('span', 'muted small', `About ${view.practice.minutes} minutes`));
      block.append(actions);
    }
    columns.append(block);
  }
  if (columns.children.length) body.push(columns);
  if (view.disclaimer || view.supporting) {
    const foot = el('div', 'iv-insight-foot');
    const note = el('span', 'muted small with-glyph');
    if (view.disclaimer) note.append(icon('info'), view.disclaimer);
    foot.append(note);
    if (view.supporting) {
      const more = Object.assign(el('button', 'link iv-supporting', `View supporting moments (${view.supporting.count}) →`), {type: 'button'});
      more.addEventListener('click', () => onMoments());
      foot.append(more);
    }
    body.push(foot);
  }
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
