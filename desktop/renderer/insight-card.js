// A daily insight's message as its card reads it, kept free of the DOM, like run-cards.js and mail-report.js, so the
// tests can check it. The message is written by src/ai/insights.py (message()) and read back from the run's Notion
// page, which usually loses its blank lines on the way:
//
//   💡 Insight · Timing
//   6 of 7 replies arrived within 0-2 days; no reply by day 3 likely means silence
//   • Days to first reply across 6 replies: 0,1,1,1,1,2
//   • 7 of 10 applications got a human reply, all fast
//   👉 If no reply within 3 days of applying, treat it as a silent no…
//   Confidence low · applications data, 10 applications
//
// Only what the message holds is read out of it. Its subtitle, its strip of numbers and its evidence grouped under
// source labels are the richer card's optional parts, and they come from `structured` — which nothing passes yet,
// because the insight's own schema has no such fields. They are never guessed from this text: a bullet that mentions
// a number is not a measured figure, and its wording is not a source. Absent, the card simply does not draw them.
const HEAD = /^💡\s*Insight(?:\s*·\s*(.+?))?\s*$/;   // the plain layout (src/tgcard.py) has the category on the next line
const NEXT_HEAD = /^Next step\s*$/;                    // plain layout: a heading, the action on the next line
const LEVEL = /^Confidence:\s*(\w+)\s*$/i;              // plain layout: the level, then "Based on jobs data, 12 jobs."
const BASED = /^Based on\s+(\w+)\s+data,\s*(\d+)\s+(applications?|jobs?)\.?\s*$/i;
const BULLET = /^[•·]\s+(.+)$/;
const ACTION = /^👉\s*(.+)$/;
const CONFIDENCE = /^Confidence\s+(\w+)\s*·\s*(.*?)\s*data,\s*(\d+)\s+(applications|jobs)\s*$/i;
// The engine writes its message up for Telegram (<b>, <i>); Notion hands it back plain. An older insight's message
// may still carry them, and both should read the same.
const plain = line => line.replace(/<\/?[bi]>/g, '').trim();

export function parseInsight(text, structured = {}) {
  const lines = String(text ?? '').split('\n').map(plain).filter(Boolean);
  const head = lines[0]?.match(HEAD);
  if (!head) return null;  // not a daily insight: another card's message, or plain text
  const insight = {category: head[1] || '', headline: '', evidence: [], action: '', confidence: '', basis: '',
    sample: 0, sampleUnit: '', ...optional(structured)};
  let expectAction = false;
  for (const line of lines.slice(1)) {
    if (NEXT_HEAD.test(line)) { expectAction = true; continue; }
    if (expectAction) { insight.action = line; expectAction = false; continue; }
    const level = line.match(LEVEL);
    if (level) { insight.confidence = level[1].toLowerCase(); continue; }
    const based = line.match(BASED);
    if (based) {
      const unit = /^app/i.test(based[3]) ? 'applications' : 'jobs';
      Object.assign(insight, {basis: based[1].toLowerCase(), sample: Number(based[2]), sampleUnit: unit});
      continue;
    }
    if (!insight.category) { insight.category = line; continue; }   // plain layout: the line under the title
    const confidence = line.match(CONFIDENCE);
    if (confidence) {
      const [, level, basis, sample, unit] = confidence;
      Object.assign(insight, {confidence: level.toLowerCase(), basis: basis.toLowerCase(), sample: Number(sample), sampleUnit: unit});
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet) { insight.evidence.push(bullet[1].trim()); continue; }
    const action = line.match(ACTION);
    if (action) { insight.action = action[1].trim(); continue; }
    if (!insight.headline) insight.headline = line;  // the first plain line under the head is the headline
  }
  return insight.headline ? insight : null;  // a head with nothing under it is not a card
}

// The optional parts, only ever as given: a subtitle, the numbers behind the finding ({label, value} each) and
// evidence grouped under source labels ({title, items}). Anything incomplete is dropped rather than drawn half-empty.
function optional({subtitle, metrics, groups} = {}) {
  return {
    subtitle: subtitle || '',
    metrics: (Array.isArray(metrics) ? metrics : []).filter(metric => metric?.label && metric?.value),
    groups: (Array.isArray(groups) ? groups : []).filter(group => group?.title && group?.items?.length),
  };
}

// The pill's tone for a confidence level, and its words ("Low confidence", as the mockup has it — the message
// itself spells the level in lower case).
export const confidenceTone = level =>
  ({high: 'good', medium: 'neutral', low: 'warn'}[String(level || '').toLowerCase()] || 'neutral');

export const confidenceLabel = level =>
  `${String(level || '').charAt(0).toUpperCase()}${String(level || '').slice(1).toLowerCase()} confidence`;

// "1 application", never "1 applications": the message's own wording ("1 applications") is the message's problem.
export const sampleWords = (sample, unit = 'applications') =>
  `${sample} ${sample === 1 ? String(unit).replace(/s$/, '') : unit}`;

// The line under the card: where the finding's numbers came from, from the fields that carry them.
export function sourceLine({basis = '', sample = 0, sampleUnit = 'applications'} = {}) {
  const parts = [];
  if (basis) parts.push(`${basis} data`);
  if (sample) parts.push(sampleWords(sample, sampleUnit));
  return parts.length ? `Source: ${parts.join(' · ')}` : '';
}

// Two of the insight's evidence lines that break the same thing down the same way ("Eligible jobs by family: software 38, sre 19…" and
// "Good-fit hits by family: software 1 (2.6%), sre 7 (37%)…", src/ai/insights.py) read as one comparison: per key, hits of the total and
// the rate. Only when both lines are there with the same keys; otherwise null and the lines stay evidence (owner's fix #9, 6 Oct 2026).
const BREAKDOWN = /^(.+?) by ([a-z][\w ]*):\s*(.+)$/i;
const ITEM = /^([\w][\w ./+-]*?)\s+(\d+)(?:\s*\((\d+(?:\.\d+)?)%\))?$/;
const keyWords = key => (/^[a-z]{2,3}$/.test(key) ? key.toUpperCase() : key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));
function breakdown(line) {
  const m = BREAKDOWN.exec(line);
  if (!m) return null;
  const items = m[3].split(/,\s*/).map(part => ITEM.exec(part.trim()));
  if (!items.length || items.some(item => !item)) return null;
  return {line, label: m[1].trim(), by: m[2].trim(), items: new Map(items.map(([, key, n, rate]) => [key, {n: Number(n), rate}]))};
}
export function comparisonTable(evidence = []) {
  const found = evidence.map(breakdown).filter(Boolean);
  const rated = found.find(b => [...b.items.values()].every(item => item.rate));
  const totals = rated && found.find(b => b !== rated && b.by === rated.by && b.items.size === rated.items.size
    && [...rated.items.keys()].every(key => b.items.has(key)) && [...b.items.values()].every(item => !item.rate));
  if (!totals) return null;
  const rows = [...rated.items].map(([key, {n, rate}]) => ({key: keyWords(key), of: `${n} of ${totals.items.get(key).n}`, rate: `${Math.round(Number(rate))}%`, sort: Number(rate)}))
    .sort((a, b) => b.sort - a.sort);
  return {columns: [keyWords(rated.by), rated.label, 'Rate'], rows, used: [rated.line, totals.line]};
}
