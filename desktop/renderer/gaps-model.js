// The Profile's "Possible CV gaps" as one line per gap with its state (owner, 17 Oct 2026, review M7: "one chip per gap with ✓ / ✕, kept in the same store"): to check, a confirmed skill
// (the CV and the fill read it as one), or not a gap (hidden from the checking list, kept so it is not asked again). "Prometheus (CV gap: to check)", the same text on every store; a line
// this app did not write is read as a note. Pure (no DOM): guarded by test/gaps-model.test.js.
export const STATES = {check: 'to check', skill: 'confirmed skill', dropped: 'not a gap'};
const LINE = new RegExp(`^(.*?)\\s*\\(CV gap: (${Object.values(STATES).join('|')})\\)\\s*$`);
const bare = text => String(text || '').replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').trim();

export const lineOf = (item, state) => `${String(item).trim()} (CV gap: ${STATES[state]})`;
export function readLine(text) {
  const found = bare(text).match(LINE);
  const state = found && Object.keys(STATES).find(key => STATES[key] === found[2]);
  return found && found[1] && state ? {item: found[1].trim(), state} : null;
}
// The part's lines -> {items: [{id, item, state}], other: [{id, text}]}.
export function readLines(lines) {
  const out = {items: [], other: []};
  for (const line of lines || []) {
    const read = readLine(line.text);
    if (read) out.items.push({id: line.id, ...read}); else out.other.push({id: line.id, text: bare(line.text)});
  }
  return out;
}
export const setState = (text, state) => lineOf(readLine(text)?.item ?? bare(text), state);
