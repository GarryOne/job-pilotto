// An interview review's message as the parts the owner reads. src/ai/interviews.py writes it as:
//
//   🎤 Interview · Recruiter screen
//   Huxley — Principal SRE
//
//   <what happened, in a paragraph>
//
//   ✅ Strong
//   • Clear work authorisation: …
//   ⚠️ Weak answers (1 of 4)
//   • Salary expectations: …
//   🏋️ Practise
//   • Prepare a principal-level architecture narrative…
//   ➡️ Next: …
//   📈 Stage → Interview scheduled
//
// The card wears the insight card's shape (as the weekly report does), so the one place a review is read looks like
// every other run's card instead of a block of preformatted text (1 Oct 2026). Nothing here re-words a line: the
// review's own words are placed, and an unrecognisable message returns null so its plain text still shows.

const HEAD = /^🎤\s*Interview\s*·\s*(.*)$/;
const SECTION = /^(✅|⚠️|🏋️)\s*(.*)$/;
const NEXT = /^➡️\s*Next:\s*(.*)$/;
const STAGE = /^📈\s*(.*)$/;
const BULLET = /^[•·]\s*(.*)$/;

// Since the plain layout (src/tgcard.py; interviews.message()):
//
//   🎤 Interview review / Recruiter screen / Huxley · Principal SRE / <summary> / Strong / • … / Weak answers (1 of 4) / • … /
//   Practise / • … / Next step / <what> / Stage → Interview scheduled / [Changes / …] / Full analysis and transcript (url) · $0.01
const HEAD_PLAIN = /^🎤\s*Interview review\s*$/;
const SECTION_PLAIN = /^(Strong|Weak answers.*|Practise|Changes)$/;
const ICONS = {Strong: '✅', Weak: '⚠️', Practise: '🏋️', Changes: '🔁'};
function parsePlain(lines, head) {
  const review = {round: lines[head + 1] || 'Interview', title: '', summary: '', sections: [], next: '', stage: ''};
  let section = null, summary = [], expectNext = false, done = false;
  for (const line of lines.slice(head + 2)) {
    if (!line) continue;
    if (/^Full analysis and transcript\b/.test(line)) break;
    const stage = /^Stage\s*→\s*(.*)$/.exec(line);
    if (stage) { review.stage = stage[1]; section = null; done = true; continue; }
    if (/^Next step$/.test(line)) { expectNext = true; section = null; continue; }
    if (expectNext) { review.next = line; expectNext = false; continue; }
    if (SECTION_PLAIN.test(line)) { section = {icon: ICONS[line.split(/\s/)[0]] || '', label: line, items: []}; review.sections.push(section); continue; }
    const bullet = BULLET.exec(line);
    if (section) { section.items.push(bullet ? bullet[1] : line); continue; }
    if (done) continue;   // the notes after the stage ("Link it to its application…") are for Telegram
    if (!review.title) review.title = line; else summary.push(line);
  }
  review.summary = summary.join(' ');
  return review.summary || review.sections.length ? review : null;
}

export function parseInterviewReview(message) {
  const lines = String(message || '').split('\n').map(line => line.trim());
  const plainHead = lines.findIndex(line => HEAD_PLAIN.test(line));
  if (plainHead >= 0) return parsePlain(lines, plainHead);
  const head = lines.findIndex(line => HEAD.test(line));
  if (head < 0) return null;
  const round = HEAD.exec(lines[head])[1] || 'Interview';
  const review = {round, title: '', summary: '', sections: [], next: '', stage: ''};
  let section = null, summary = [], started = false;
  for (const line of lines.slice(head + 1)) {
    if (!line) continue;
    const header = SECTION.exec(line);
    if (header) {
      section = {icon: header[1], label: header[2], items: []};
      review.sections.push(section);
      continue;
    }
    const next = NEXT.exec(line);
    if (next) { review.next = next[1]; section = null; continue; }
    const stage = STAGE.exec(line);
    if (stage) { review.stage = stage[1]; section = null; continue; }
    const bullet = BULLET.exec(line);
    if (bullet && section) { section.items.push(bullet[1]); continue; }
    if (section) { section.items.push(line); continue; }   // an unbulleted line inside a section
    if (!started) { review.title = line; started = true; continue; }  // the job line, under the header
    summary.push(line);
  }
  review.summary = summary.join(' ');
  // A message with only a header and a title is not a review we can draw: leave it to the plain-text path.
  if (!review.summary && !review.sections.length) return null;
  return review;
}
