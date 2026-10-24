// The places the scorer was told, written for the quality judge's candidate text: a score text may say a place is preferred or acceptable only because the search says so (src/ai/locations.py).
const list = value => (Array.isArray(value) ? value : []).map(word => String(word).trim()).filter(Boolean);

// -> '' when the search sets no place, else a short block for the judge.
export function placesNote(locations = {}) {
  const lines = [['preferred', list(locations.top_tier)], ['acceptable', list(locations.country_wide)], ['relocation destinations', list(locations.abroad)]]
    .filter(([, words]) => words.length).map(([name, words]) => `${name}: ${words.join(', ')}`);
  return lines.length ? `\n\nTHE CANDIDATE'S PLACES (the scorer was told these, so they count as grounded)\n${lines.join('\n')}` : '';
}
