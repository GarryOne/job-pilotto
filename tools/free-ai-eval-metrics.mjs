// What the Free AI quality table measures (tools/free-ai-eval.mjs): is the answer valid JSON in the asked shape, and does it rank like the baseline.
// Pure functions, tested in desktop/test/free-ai-eval.test.js.

// A small JSON-schema check for the shapes the app asks for (type, enum, required, properties, items): -> [problems].
export function schemaProblems(value, schema, at = '$') {
  const types = [].concat(schema.type || []);
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const ok = !types.length || types.some(type => type === kind || (type === 'number' && kind === 'integer'));
  if (!ok) return [`${at}: ${kind}, wanted ${types.join('|')}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${at}: not one of ${schema.enum.join('/')}`];
  const found = [];
  if (kind === 'object') {
    for (const key of schema.required || []) if (!(key in value)) found.push(`${at}.${key}: missing`);
    for (const [key, sub] of Object.entries(schema.properties || {})) if (key in value) found.push(...schemaProblems(value[key], sub, `${at}.${key}`));
  }
  if (kind === 'array' && schema.items) value.forEach((item, i) => found.push(...schemaProblems(item, schema.items, `${at}[${i}]`)));
  return found;
}

// A form-answer reply against what each field should get: expect = {<field id>: {value?: [acceptable values], match?: regex text, empty?: true, category?}} -> [problems].
export function answerProblems(data, expect) {
  const answers = Array.isArray(data?.answers) ? data.answers : [], found = [];
  for (const [field, want] of Object.entries(expect)) {
    const got = answers.find(answer => answer.field === field);
    const given = got && String(got.value ?? '') !== '';
    if (want.empty) { if (given) found.push(`${field}: answered, wanted empty`); }
    else if (!got) { found.push(`${field}: no answer`); continue; }
    else if (want.value && !want.value.includes(got.value)) found.push(`${field}: "${got.value}", wanted ${want.value.join(' or ')}`);
    else if (want.match && !new RegExp(want.match, 'i').test(got.value)) found.push(`${field}: "${got.value}", wanted /${want.match}/`);
    if (want.category && got && got.category !== want.category) found.push(`${field}: category ${got.category}, wanted ${want.category}`);
  }
  return found;
}

const ranks = values => {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), out = Array(values.length);
  for (let i = 0; i < order.length;) {   // ties share their average rank
    let j = i; while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
};

// Spearman rank correlation of two lists of numbers (null when fewer than 3 pairs or no spread).
export function spearman(a, b) {
  if (a.length !== b.length || a.length < 3) return null;
  const x = ranks(a), y = ranks(b), mean = values => values.reduce((s, v) => s + v, 0) / values.length, mx = mean(x), my = mean(y);
  const cov = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0), sx = Math.hypot(...x.map(v => v - mx)), sy = Math.hypot(...y.map(v => v - my));
  return sx && sy ? cov / (sx * sy) : null;
}

// How many of the baseline's top-k ids the model's top-k also holds (0..1).
export function topOverlap(baseline, model, k) {
  const top = scores => new Set(Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id));
  const want = top(baseline), got = top(model);
  return want.size ? [...want].filter(id => got.has(id)).length / want.size : null;
}

// One model's results over the cases -> the table row. results: [{id, valid, schemaOk, score, baseline, usage, ms}].
export function summarize(model, results, {k = 5} = {}) {
  const n = results.length || 1, share = pick => Math.round(100 * results.filter(pick).length / n);
  const paired = results.filter(r => Number.isFinite(r.score) && Number.isFinite(r.baseline));
  const modelScores = Object.fromEntries(paired.map(r => [r.id, r.score])), baseScores = Object.fromEntries(paired.map(r => [r.id, r.baseline]));
  const rho = spearman(paired.map(r => r.score), paired.map(r => r.baseline));
  const ms = results.map(r => r.ms).filter(Number.isFinite).sort((a, b) => a - b);
  return {model, cases: results.length, validJsonPct: share(r => r.valid), schemaPct: share(r => r.schemaOk),
    spearman: rho == null ? null : Math.round(rho * 100) / 100, topOverlap: paired.length >= k ? Math.round(100 * topOverlap(baseScores, modelScores, k)) : null,
    rightPct: results.some(r => 'right' in r) ? share(r => r.right) : null,
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
    tokensIn: results.reduce((s, r) => s + (r.usage?.input_tokens || 0), 0), tokensOut: results.reduce((s, r) => s + (r.usage?.output_tokens || 0), 0)};
}

export const table = (rows, usdPerCall = {}) => {
  const answers = rows.some(r => r.rightPct != null);
  return [`| Model | Cases | Valid JSON | In schema | ${answers ? 'Right answers' : 'Rank vs baseline (Spearman) | Same top 5'} | Median ms | Cost |`, `|---|---|---|---|${answers ? '---|' : '---|---|'}---|---|`,
    ...rows.map(r => `| ${r.model} | ${r.cases} | ${r.validJsonPct}% | ${r.schemaPct}% | ${answers ? `${r.rightPct}%` : `${r.spearman ?? 'n/a'} | ${r.topOverlap == null ? 'n/a' : `${r.topOverlap}%`}`} | ${r.medianMs ?? 'n/a'} | $${(usdPerCall[r.model] ?? 0).toFixed(4)} |`)].join('\n');
};
