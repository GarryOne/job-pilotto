// A weekly report's message as its card reads it, kept free of the DOM, like run-cards.js, mail-report.js and
// insight-card.js, so the tests can check it. The message is written by src/ai/insights.py (weekly_message()) and
// read back from the run's Notion page, which usually loses its blank lines on the way:
//
//   📊 Search analysis · last 7 days        ("📊 Weekly report" before 5 Oct 2026)
//   Quiet week: 2 applications, no replies yet
//   💡 Replies came only from jobs posted under 3 days ago (4 of 4)   (the top finding; newer reports only)
//   You sent 2 applications. Six rejections came in…
//   ✅ Worked
//   • All 5 interview outcomes came through the Recruiter channel.
//   🔧 Change next week
//   • Send more of the 31 already-drafted kits.
//   🎯 Five applications in Zurich
//   Full report in Notion
//
// Only what the message holds is read out of it; the link line at the end belongs to Telegram, and the report's
// confidence and its "priorities from recurring evidence" live on the Notion page, not here, so the card omits them
// rather than inventing them.
const HEAD = /^📊\s*(?:Weekly report|Search analysis)(?:\s*·\s*last 7 days)?\s*:?$/;
const SUBTITLE = /^Last 7 days$/i;   // the plain layout (src/tgcard.py) puts it on its own line under the title
const FINDING = /^(?:💡\s*|Finding:\s*)(.+)$/;
const WORKED = /^(?:✅\s*)?Worked\s*$/;
const CHANGE = /^(?:🔧\s*)?Change next week\s*$/;
const FOCUS = /^🎯\s*(.+)$/;
const FOCUS_HEAD = /^Focus\s*$/;   // plain layout: a heading, the sentence on the next line
const BULLET = /^[•·]\s+(.+)$/;
const LINK = /^Full report in Notion(?:\s*\(https?:\/\/[^)\s]*\))?$/;
// The engine writes its message up for Telegram (<b>, <i>, <a>); Notion hands it back plain.
const plain = line => line.replace(/<\/?[bia](?:\s[^>]*)?>/g, '').trim();

export function parseWeekly(text) {
  const lines = String(text ?? '').split('\n').map(plain).filter(Boolean);
  if (!HEAD.test(lines[0] || '')) return null;  // not a weekly report: another card's message, or plain text
  const weekly = {headline: '', finding: '', summary: '', worked: [], change: [], focus: ''};
  let section = '';
  for (const line of lines.slice(1)) {
    if (SUBTITLE.test(line) && !weekly.headline) continue;
    if (FOCUS_HEAD.test(line)) { section = 'focus'; continue; }
    if (section === 'focus' && !weekly.focus && !LINK.test(line)) { weekly.focus = line; continue; }
    if (WORKED.test(line)) { section = 'worked'; continue; }
    if (CHANGE.test(line)) { section = 'change'; continue; }
    const focus = line.match(FOCUS);
    if (focus) { section = 'focus'; weekly.focus = focus[1].trim(); continue; }
    if (LINK.test(line)) { section = ''; continue; }
    const finding = !section && line.match(FINDING);
    if (finding) { weekly.finding = finding[1].trim(); continue; }
    const bullet = line.match(BULLET);
    if (bullet) {  // a section's item; a bullet before any section belongs to no list and is left out
      if (section === 'worked' || section === 'change') weekly[section].push(bullet[1].trim());
      continue;
    }
    if (section) continue;  // prose inside a section is not the summary
    if (!weekly.headline) weekly.headline = line;
    else weekly.summary = weekly.summary ? `${weekly.summary} ${line}` : line;  // a wrapped summary is one paragraph
  }
  return weekly.headline ? weekly : null;  // a head with nothing under it is not a card
}
