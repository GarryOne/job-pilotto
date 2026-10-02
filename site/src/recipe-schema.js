// A recipe: how to operate one kind of control, as DATA (never code), attached to the control's structural fingerprint
// (extension/page/skeleton.js). It only chooses among the generic operators' options (page/controls.js): which element counts
// as an option, which attribute says "selected", which date shape a field takes. One source of truth, imported by the site
// (what it accepts and serves), the app (what it passes on) and the extension (what it applies). Anything outside these
// limits is refused, whoever sent it. A recipe can never name a submit control or run script.
export const OPERATORS = ['toggle', 'select', 'date'];
export const ON_ATTRS = ['aria-pressed', 'aria-checked', 'aria-selected', 'data-state', 'data-selected'];
export const DATE_ORDERS = ['mdy', 'dmy', 'ymd'];
export const DATE_SEPS = ['/', '.', '-'];
const SELECTOR = /^[\w\s[\]="'.:#>,*()~+^$|-]{1,160}$/;
const FORBIDDEN = /submit|button\[type|input\[type=(?:submit|image)|\bform\b|<|>{2}|javascript:|expression\(/i;

const isSelector = value => typeof value === 'string' && SELECTOR.test(value) && !FORBIDDEN.test(value);
const fail = error => ({ok: false, error});

// -> {ok: true, recipe} with only the known fields, or {ok: false, error}.
export function validateRecipe(input) {
  if (!input || typeof input !== 'object') return fail('not an object');
  const fingerprint = String(input.fingerprint || '');
  if (!/^[a-z0-9]{6,16}$/.test(fingerprint)) return fail('bad fingerprint');
  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1 || version > 9999) return fail('bad version');
  if (!OPERATORS.includes(input.operator)) return fail('unknown operator');
  const given = input.params && typeof input.params === 'object' ? input.params : {};
  const params = {};
  if (input.operator === 'toggle') {
    if (given.option !== undefined) { if (!isSelector(given.option)) return fail('bad option selector'); params.option = given.option; }
    if (given.onAttr !== undefined) { if (!ON_ATTRS.includes(given.onAttr)) return fail('bad onAttr'); params.onAttr = given.onAttr; }
    if (given.onValue !== undefined) { if (!/^[\w-]{1,16}$/.test(String(given.onValue))) return fail('bad onValue'); params.onValue = String(given.onValue); }
  } else if (input.operator === 'select') {
    for (const name of ['trigger', 'option']) {
      if (given[name] !== undefined) { if (!isSelector(given[name])) return fail(`bad ${name} selector`); params[name] = given[name]; }
    }
  } else {
    if (given.order !== undefined) { if (!DATE_ORDERS.includes(given.order)) return fail('bad date order'); params.order = given.order; }
    if (given.sep !== undefined) { if (!DATE_SEPS.includes(given.sep)) return fail('bad date separator'); params.sep = given.sep; }
  }
  const candidates = [];
  for (const selector of Array.isArray(input.candidates) ? input.candidates.slice(0, 5) : []) {
    if (!isSelector(selector)) return fail('bad candidate selector');
    candidates.push(selector);
  }
  return {ok: true, recipe: {fingerprint, version, operator: input.operator, params, candidates}};
}

// A list of recipes: the valid ones, each once (highest version per fingerprint), at most `max`.
export function validateBundle(list, max = 500) {
  const best = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const result = validateRecipe(item);
    if (!result.ok) continue;
    const old = best.get(result.recipe.fingerprint);
    if (!old || old.version < result.recipe.version) best.set(result.recipe.fingerprint, {...result.recipe, ...(item.rollout !== undefined ? {rollout: Math.max(0, Math.min(100, Math.round(Number(item.rollout)) || 0))} : {})});
  }
  return [...best.values()].slice(0, max);
}

// Which of the 100 buckets an install falls in (0-99), stable for the install: a recipe at rollout N applies where bucket < N.
export function bucketOf(installId) {
  let hash = 2166136261;
  for (const ch of String(installId || '')) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return hash % 100;
}
export const appliesTo = (recipe, installId) => (recipe.rollout ?? 100) > bucketOf(installId);
