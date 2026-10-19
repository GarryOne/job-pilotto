// Claude's reply checked once where it is read, and every error text a person sees turned into a plain sentence (the raw text goes to the log only). Guard: desktop/test/panel-plain-errors.test.js.
// Invariants: readReply never lets a reply without an answers list reach the fill; plainWhy never returns a JS error text.
export const UNREADABLE = "its answer couldn't be read";

// null stays null (the tab left the page: answersOrDropped). A reply that is no object with an answers list is unreadable; malformed entries are dropped, not guessed.
export function readReply(reply) {
  if (reply === null || reply === undefined) return null;
  if (typeof reply !== 'object' || !Array.isArray(reply.answers)) throw Object.assign(new Error(UNREADABLE), {unreadable: true});
  return {...reply, answers: reply.answers.filter(a => a && typeof a === 'object' && typeof a.field === 'string' && a.field)};
}

// What the JS engine, JSON.parse and a missing value say, in any browser: never for a person.
const RAW = /TypeError|ReferenceError|SyntaxError|RangeError|Cannot read propert|Cannot set propert|\bundefined\b|\bnull\b|is not (a function|iterable|defined|an object)|Unexpected (token|end|character)|JSON|\[object|\bNaN\b/i;
export function plainWhy(message, fallback = 'something unexpected went wrong (details are in the log)') {
  const text = String(message?.message ?? message ?? '').trim();
  return !text ? fallback : RAW.test(text) ? fallback : text;
}
