// Is this candidate looking for IT / engineering work? The same rule as src/coverage.py looks_technical (a table of cases in tests/fixtures/audience_cases.json holds both to it).
// Pure, no DOM: main.js answers the window's question with it, and the tips use it to keep IT examples away from everyone else.
const TECH_WORDS = /(?<![a-z])(software|developer|devops|sre|site reliability|cloud|backend|back-end|frontend|front-end|full.?stack|data|analytics|machine learning|ml|infrastructure|platform|sysadmin|sysop|systems?|syst[eè]mes?|programmer|sdet|qa|security|network|database|kubernetes|it|entwickler|informatiker|d[eé]veloppeur|sviluppatore|desarrollador|ontwikkelaar|programista|sistemista)(?![a-z])/i;
// Compound words (German "Softwareentwickler") have no word boundary to match on: these stems count anywhere.
const STEMS = ['software', 'entwickler', 'informatik', 'devops', 'kubernetes', 'programmier', 'sysadmin', 'systemadmin'];
const words = fragment => String(fragment).replace(/\\[bwsd]|[\\^$()|?*+[\]{}.]/g, ' ');

// Role keywords (regex fragments or plain words) -> true when any names IT/engineering work. An empty list is unknown, not non-technical (as in Python).
export const looksTechnical = (keywords = []) => !keywords.length || keywords.map(words).some(word => TECH_WORDS.test(word) || STEMS.some(stem => word.toLowerCase().includes(stem)));

// What to show: IT-only guidance only to someone who is clearly technical: with no roles known yet, the general version is the safe one.
export const clearlyTechnical = (keywords = []) => keywords.length > 0 && looksTechnical(keywords);

// ---- where the candidate is: examples and fields written for another market stay out of their way ----
// A place fragment as plain words: "\\bz[u\u00fc]rich\\b" -> "Z\u00fcrich", "manchester" -> "Manchester".
export const plainPlace = fragment => String(fragment).replace(/\[(\p{L})(\p{L})\]/gu, (all, a, b) => (b.charCodeAt(0) > 127 ? b : a)).replace(/\\[bwsd]|[\\^$()|?*+[\]{}.]/g, ' ')
  .replace(/\s+/g, ' ').trim().replace(/(^|[\s-])(\p{L})/gu, (all, lead, letter) => lead + letter.toUpperCase());

// The same rule as src/sources/boards.py swiss_places (a table of cases in tests/fixtures/swiss_cases.json holds both to it): any place that is Swiss, or a Swiss region word.
const SWISS_PLACE = /switzerland|swiss|schweiz|suisse|svizzera|z[u\u00fc]e?rich|gen[e\u00e8]v|basel|b[a\u00e2]le|bern|lausanne|\bzug\b|lugano|winterthur|luzern|lucerne|st\.? ?gallen/i;
const SWISS_REGION = /^(romandie|suisse romande|deutschschweiz|ticino|tessin|greater zurich|zurich area|basel region|lake geneva|central switzerland|eastern switzerland|mittelland|nordwestschweiz|zentralschweiz|ostschweiz|westschweiz)$/i;
export const swissPlaces = (places = []) => places.some(place => SWISS_PLACE.test(String(place)) || SWISS_PLACE.test(plainPlace(place)) || SWISS_REGION.test(plainPlace(place)));

// What the "Your details" form shows this candidate: an example city of their own (never a fixed one), an unambiguous date example, and the Swiss "place of origin"
// only for someone with Swiss places (or who already filled it in).
export function contactHints({places = []} = {}, contact = {}) {
  const own = places.map(plainPlace).find(Boolean);
  return {locationExample: own ? `e.g. ${own}` : 'e.g. your town or city', dateExample: 'e.g. 31 Dec 1990', showOrigin: swissPlaces(places) || Boolean(String(contact.place_of_origin || '').trim())};
}
