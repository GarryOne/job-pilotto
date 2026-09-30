// A weekly report's message as its card reads it, kept free of the DOM, like run-cards.js, mail-report.js and
// insight-card.js, so the tests can check it. The message is written by src/ai/insights.py (weekly_message()) and
// read back from the run's Notion page, which usually loses its blank lines on the way:
//
//   📊 Weekly report
//   Quiet week: 2 applications, no replies yet
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
const HEAD = /^📊\s*Weekly report\s*$/;
const WORKED = /^✅\s*Worked\s*$/;
const CHANGE = /^🔧\s*Change next week\s*$/;
const FOCUS = /^🎯\s*(.+)$/;
const BULLET = /^[•·]\s+(.+)$/;
const LINK = /^Full report in Notion$/;
// The engine writes its message up for Telegram (<b>, <i>, <a>); Notion hands it back plain.
const plain = line => line.replace(/<\/?[bia](?:\s[^>]*)?>/g, '').trim();

export function parseWeekly(text) {
  const lines = String(text ?? '').split('\n').map(plain).filter(Boolean);
  if (!HEAD.test(lines[0] || '')) return null;  // not a weekly report: another card's message, or plain text
  const weekly = {headline: '', summary: '', worked: [], change: [], focus: ''};
  let section = '';
  for (const line of lines.slice(1)) {
    if (WORKED.test(line)) { section = 'worked'; continue; }
    if (CHANGE.test(line)) { section = 'change'; continue; }
    const focus = line.match(FOCUS);
    if (focus) { section = 'focus'; weekly.focus = focus[1].trim(); continue; }
    if (LINK.test(line)) { section = ''; continue; }
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
