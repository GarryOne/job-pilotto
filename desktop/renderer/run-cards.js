// Recent activity: a run's message (the Telegram text) as a small card, for the two long ones: Today's list /
// a jobs check's digest, and Find new employers. The parsers are plain (tested in test/run-cards.test.js); a message
// they don't recognise stays text. Light on purpose: counts, then one line per item.
// A job line: "1. Title (https://…) · 🎯 78"; the link and the fit can be missing (a job not scored: an AI limit reached).
// A "New since last run" line instead carries a title-match percentage after the title: "1. Title - 100% (https://…)".
// Two different numbers: the percentage is not a fit score, and reading it as part of the title put "(Cloud + On-Prem,
// Windows + Linux) - 100%" beside a "Not scored" pill.
const DIGEST_ITEM = /^(\d+)\.\s+(?:⭐\s*)?(.+?)(?:\s+\((https?:\/\/[^)\s]+)\))?(?:\s+·\s+🎯\s*(\d+))?\s*$/;
const TITLE_PERCENT = /\s+-\s+(\d+)%\s*$/;
const SCOUT_ITEM = /^(\d+)\.\s+(.+?)\s+·\s+(\w[\w ]*?)\s+·\s+quality\s+(\d+)(?:\s+·\s+⭐\s*(.+))?$/;
const num = (text, pattern) => { const m = String(text).match(pattern); return m ? Number(m[1]) : null; };

export function parseDigest(text) {
  const lines = String(text || '').split('\n');
  if (!/^✈️.*(🆕|jobs \d)/.test(lines[0] || '')) return null;  // with or without the brand name
  const items = [];
  lines.forEach((line, i) => {
    const m = line.match(DIGEST_ITEM);
    if (m && /^\s/.test(lines[i + 1] || '')) {
      const percent = TITLE_PERCENT.exec(m[2]);
      items.push({title: (percent ? m[2].slice(0, percent.index) : m[2]).replace(/\s*\|.*$/, ''), url: m[3] || '',
        fit: m[4] ? Number(m[4]) : null, percent: percent ? Number(percent[1]) : null,
        company: (lines[i + 1] || '').trim().split(' · ')[0]});
    }
  });
  return {kind: 'digest', fresh: num(lines[0], /🆕\s*(\d+) new/), open: num(lines[1], /(\d+) open/),
    local: num(lines[1], /·\s*(\d+)\s*(?:🇨🇭|📍)/), applied: num(lines[1], /(\d+) applied/), items};
}

export function parseScout(text) {
  const lines = String(text || '').split('\n');
  if (!/Source scout/.test(lines[0] || '')) return null;
  const items = [];
  lines.forEach((line, i) => {
    const m = line.match(SCOUT_ITEM);
    if (!m) return;
    const roles = (lines[i + 1] || '').trim();
    items.push({company: m[2], ats: m[3], quality: Number(m[4]), tier: m[5] || '',
      roles: num(roles, /(\d+) SRE-type roles?/), yours: num(roles, /(\d+) in your places/)});
  });
  const last = lines[lines.length - 1] || '';
  return {kind: 'scout', checked: num(lines[0], /checked (\d+)/), fresh: num(lines[0], /(\d+) new sources?/), items,
    note: /^\d+\./.test(last.trim()) || /^\s/.test(last) ? '' : last.trim()};
}

export const parseRunMessage = text => parseDigest(text) || parseScout(text);
