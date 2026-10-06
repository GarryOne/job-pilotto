// Recent activity: a run's message (the Telegram text) as a small card, for the two long ones: Today's list /
// a jobs check's digest, and Find new employers. The parsers are plain (tested in test/run-cards.test.js); a message
// they don't recognise stays text. Light on purpose: counts, then one line per item.
// A job line: "1. Title (https://…) · 🎯 78"; the link and the fit can be missing (a job not scored: an AI limit reached).
// A "New since last run" line instead carries a title-match percentage after the title: "1. Title - 100% (https://…)".
// Two different numbers: the percentage is not a fit score, and reading it as part of the title put "(Cloud + On-Prem,
// Windows + Linux) - 100%" beside a "Not scored" pill.
const DIGEST_ITEM = /^(\d+)\.\s+(?:⭐\s*)?(.+?)(?:\s+\((https?:\/\/[^)\s]+)\))?(?:\s+·\s+(?:🎯\s*(\d+)|(\d+)\/100))?\s*$/;   // the fit: "· 🎯 78" (older) or "· 78/100"
const TITLE_PERCENT = /\s+-\s+(\d+)%\s*$/;
const SCOUT_ITEM = /^(\d+)\.\s+(.+?)\s+·\s+(\w[\w ]*?)\s+·\s+quality\s+(\d+)(?:\s+·\s+⭐\s*(.+))?$/;
// Since the plain layout: "1. Acme · Source quality 82 · Tier 1", then "6 matching roles · 2 in preferred locations", "Platform: Greenhouse".
const SCOUT_ITEM_PLAIN = /^(\d+)\.\s+(.+?)\s+·\s+Source quality\s+(\d+)(?:\s+·\s+(Tier \d))?$/;
const num = (text, pattern) => { const m = String(text).match(pattern); return m ? Number(m[1]) : null; };

export function parseDigest(text) {
  const lines = String(text || '').trim().split('\n');
  if (!/^✈️.*(🆕|jobs \d|Job digest)/.test(lines[0] || '')) return null;  // with or without the brand name; "Job Pilotto · Job digest" since the plain layout
  const items = [];
  lines.forEach((line, i) => {
    const m = line.match(DIGEST_ITEM);
    // A job is its numbered line and the company line under it: indented in the older layout, a plain line since the card layout (src/tgcard.py). Its
    // score is on the heading ("· 78/100", older) or a "Fit: 78/100 · why" line before the next job.
    if (m && (lines[i + 1] || '').trim() && !DIGEST_ITEM.test(lines[i + 1])) {
      const percent = TITLE_PERCENT.exec(m[2]);
      let fit = m[4] || m[5] ? Number(m[4] || m[5]) : null;
      for (const next of lines.slice(i + 1)) {
        if (!next.trim() || DIGEST_ITEM.test(next)) break;
        const found = /^Fit:\s*(\d+)\/100/.exec(next.trim());
        if (found) { fit = Number(found[1]); break; }
      }
      items.push({title: (percent ? m[2].slice(0, percent.index) : m[2]).replace(/\s*\|.*$/, ''), url: m[3] || '',
        fit, percent: percent ? Number(percent[1]) : null,
        company: (lines[i + 1] || '').trim().split(' · ')[0]});
    }
  });
  // The counts: on the header lines ("🆕 3 new", "3 new · Top 3 of 50 ranked jobs") and in the "Your pipeline" block ("173 open · 4 pinned · 2 applied").
  const head = lines.slice(0, 2).join('\n'), counts = lines.filter(line => !/^\d+\./.test(line) && /^\d+ open\b/.test(line.trim())).join(' · ') || lines[1];
  return {kind: 'digest', fresh: num(head, /🆕\s*(\d+) new/) ?? num(lines[1], /^(\d+) new\b/), open: num(counts, /(\d+) open/),
    local: num(counts, /·\s*(\d+)\s*(?:🇨🇭|📍)/) ?? num(counts, /(\d+) pinned/), applied: num(counts, /(\d+) applied/), items};
}

export function parseScout(text) {
  const lines = String(text || '').split('\n');
  if (!/Source scout|New employer sources/.test(lines[0] || '')) return null;
  const items = [];
  lines.forEach((line, i) => {
    const m = line.match(SCOUT_ITEM);
    const plain = !m && line.match(SCOUT_ITEM_PLAIN);
    if (!m && !plain) return;
    const roles = (lines[i + 1] || '').trim();
    let ats = '';
    if (plain) for (const next of lines.slice(i + 1, i + 6)) { if (/^\d+\./.test(next.trim())) break; ats = ats || (/^Platform:\s*(.+)$/.exec(next.trim()) || [])[1] || ''; }
    items.push(m ? {company: m[2], ats: m[3], quality: Number(m[4]), tier: m[5] || '', roles: num(roles, /(\d+) (?:matching|SRE-type) roles?/), yours: num(roles, /(\d+) in your places/)}
      : {company: plain[2], ats, quality: Number(plain[3]), tier: plain[4] || '', roles: num(roles, /(\d+) matching roles?/), yours: num(roles, /(\d+) in (?:your|preferred) (?:places|locations)/)});
  });
  const head = lines.slice(0, 2).join('\n');
  const last = lines[lines.length - 1] || '';
  // The older message ended on a sentence; the plain one has a "Not added" block (what was left out, and why) before its footer.
  const notAdded = lines.findIndex(line => /^Not added$/.test(line.trim()));
  const note = notAdded >= 0 ? (lines[notAdded + 1] || '').trim() : /^\d+\./.test(last.trim()) || /^\s/.test(last) ? '' : last.trim();
  return {kind: 'scout', checked: num(head, /checked (\d+)/) ?? num(head, /(\d+) checked/), fresh: num(head, /(\d+) new sources?/),
    first: num(head, /(\d+) new to the search/), again: num(head, /(\d+) checked again/), items, note};
}

export const parseRunMessage = text => parseDigest(text) || parseScout(text);

// The text a finished run's card is drawn from: its own message (read from its Notion page), else the result the window
// kept when it watched the run end (renderer/pages/activity.js runResults). A search run recorded on this Mac carries a log
// but no message, so without the kept one its digest showed as raw Telegram text under a "Completed" pill (5 Oct 2026).
// The run kinds the window draws as a card. When one of them shows its message as plain text instead, a parser failed or was never
// reached: the screen still looks tidy, so the window says so on the element (data-fallback), and the e2e checks treat it as a
// finding (desktop/e2e/lib/uicheck.mjs 'card-fallback'). A one- or two-line note ("No new jobs since…") is a plain answer, not a fallback.
export const CARD_KINDS = new Set(['search', 'today', 'scout', 'mail', 'insight', 'weekly', 'interview', 'kits', 'prepare', 'tailor']);
export const isFallback = (kind, text) => CARD_KINDS.has(kind) && String(text || '').split('\n').filter(line => line.trim()).length >= 3;
// The run kinds that always leave a result to read (not a Jobs check, which may find nothing). A finished one whose pane drew no
// card, no text and no result is a finding too ("Search analysis" opened to an empty pane, 5 Oct 2026): data-empty-result on the
// panel, read by the e2e checks ('empty-result').
export const emptyResult = (kind, run, drew) => !!run && !run.live && !!run.ok && !!run.pageId && !drew && CARD_KINDS.has(kind) && kind !== 'search';
// Marks (or clears) a box that shows a run's message as plain text.
export function markFallback(node, kind, text) {
  if (!node) return;
  if (text && isFallback(kind, text)) node.dataset.fallback = kind;
  else delete node.dataset.fallback;
}

// A weekly report or an insight that kept only its one-line summary (its message never reached the app): the head its
// engine writes, then the whole summary, so the same card draws it instead of a cut line in the header (owner, 6 Oct 2026).
const sentence = text => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
export function summaryMessage(run) {
  const said = String(run?.summary || '').trim();
  if (!said || !run.ok || run.message) return null;
  if (run.kind === 'weekly') {
    const [first, ...rest] = said.split(/;\s*/);
    return ['📊 Search analysis', first, ...(rest.length ? [sentence(rest.join('; '))] : [])].join('\n');
  }
  const topic = run.kind === 'insight' && /^([^—]{2,40}?)\s+—\s+(.+)$/.exec(said);
  return topic ? `💡 Insight · ${topic[1]}\n${topic[2]}` : null;
}
export const cardText = (run, kept) => (!run || run.live ? null : run.message || kept || summaryMessage(run) || null);

// A run's message that is not a card is shown as text: written for Telegram, so its tags and the "Tap a job number…" hint
// (nothing in this pane can be tapped) are dropped (UI loop #265).
export const plainMessage = text => String(text || '').replace(/<\/?(?:b|i|u|s|a|code|pre)\b[^>]*>/gi, '')
  .split('\n').filter(line => !/^\s*Tap a job number\b/i.test(line)).join('\n').trim();
