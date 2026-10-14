// One rule for every number made from real users' fill cards: fewer than 3 distinct installs (the learned layer's k) in the period means "too few to judge",
// never a percentage or a ranking. Used by the page (src/formlearning.js) and the digest (src/digest.js, its .md). Guard: site/test/thin-data.test.js.
export const MIN_INSTALLS = 3;

// cards: the user fill cards of the period (rows with an `install`; '' = before the column, never counted).
export function sampleOf(cards) {
  const installs = new Set(cards.map(c => c.install).filter(Boolean)).size;
  return {forms: cards.length, installs, min: MIN_INSTALLS, enough: installs >= MIN_INSTALLS};
}

export const thinWords = sample => `Too few real fills to judge: ${sample.forms} form${sample.forms === 1 ? '' : 's'} from ${sample.installs} install${sample.installs === 1 ? '' : 's'} this week (needs ${sample.min}+ installs)`;

// A shown value: the formatted value when there is enough data, else a dash. A missing sample (the digest failed) never hides anything.
export const gate = (sample, value, format) => (sample && sample.enough === false ? '–' : format(value));
export const isThin = sample => Boolean(sample) && sample.enough === false;
