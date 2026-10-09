// JSON schemas across AI engines: a small validator, a forgiving JSON reader, and each provider's accepted form of one schema.
// The app mirror of src/ai/providers/schema.py. Callers write one schema per AI step; `strict` is what OpenAI's strict structured
// output accepts (every property required, optional ones nullable, no extra keys), `dropNulls` turns its answer back into the
// original's shape, `problems` checks an answer (the CLI engines repair once on a mismatch). Guarded by test/ai-contract.test.js.

const LIMITS = ['maxItems', 'minItems'];
// Keywords OpenAI's strict mode refuses.
const STRICT_UNSUPPORTED = new Set([...LIMITS, 'maxLength', 'minLength', 'pattern', 'format', 'minimum', 'maximum', 'default']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// The schema without maxItems/minItems (the Anthropic API rejects them in structured output, 3 Oct 2026).
export function withoutLimits(schema) {
  if (Array.isArray(schema)) return schema.map(withoutLimits);
  if (!isObject(schema)) return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !LIMITS.includes(key)).map(([key, value]) => [key, withoutLimits(value)]));
}

function nullable(schema) {
  const kinds = schema.type;
  if (Array.isArray(kinds)) return kinds.includes('null') ? schema : {...schema, type: [...kinds, 'null']};
  if (kinds) return {...schema, type: [kinds, 'null'], ...(schema.enum && !schema.enum.includes(null) ? {enum: [...schema.enum, null]} : {})};
  if (schema.anyOf) return {...schema, anyOf: [...schema.anyOf, {type: 'null'}]};
  return schema;
}

// OpenAI's strict form: every object lists all its properties as required and allows no others; a property the original did not
// require becomes nullable (null means "not given", which dropNulls removes again).
export function strict(schema) {
  if (Array.isArray(schema)) return schema.map(strict);
  if (!isObject(schema)) return schema;
  const out = Object.fromEntries(Object.entries(schema).filter(([key]) => !STRICT_UNSUPPORTED.has(key)).map(([key, value]) => [key, strict(value)]));
  if (out.type === 'object' || out.properties) {
    const props = out.properties || {}, required = new Set(schema.required || []);
    out.properties = Object.fromEntries(Object.entries(props).map(([key, value]) => [key, required.has(key) ? value : nullable(value)]));
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

// An answer to a strict schema back in the original's shape: a null the original did not require is removed.
export function dropNulls(value, schema) {
  if (!isObject(schema)) return value;
  if (isObject(value)) {
    const props = schema.properties || {}, required = new Set(schema.required || []);
    return Object.fromEntries(Object.entries(value).filter(([key, item]) => !(item === null && !required.has(key) && key in props))
      .map(([key, item]) => [key, dropNulls(item, props[key])]));
  }
  if (Array.isArray(value) && isObject(schema.items)) return value.map(item => dropNulls(item, schema.items));
  return value;
}

const is = (value, kind) => ({
  object: isObject(value), array: Array.isArray(value), string: typeof value === 'string', boolean: typeof value === 'boolean',
  null: value === null, integer: Number.isInteger(value), number: typeof value === 'number',
}[kind] ?? true);

// What makes value not match schema (empty: it matches). Enough for our schemas: types, required keys, enums.
export function problems(value, schema, where = '$') {
  if (!isObject(schema)) return [];
  if (schema.anyOf) return schema.anyOf.some(option => !problems(value, option, where).length) ? [] : [`${where}: matches no option`];
  const kinds = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (kinds.length && !kinds.some(kind => is(value, kind))) return [`${where}: expected ${kinds.join('/')}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${where}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`];
  const found = [];
  if (isObject(value)) {
    for (const key of schema.required || []) if (!(key in value)) found.push(`${where}.${key}: missing`);
    for (const [key, sub] of Object.entries(schema.properties || {})) if (key in value) found.push(...problems(value[key], sub, `${where}.${key}`));
  }
  if (Array.isArray(value) && isObject(schema.items)) value.slice(0, 200).forEach((item, i) => found.push(...problems(item, schema.items, `${where}[${i}]`)));
  return found;
}

// The JSON in an answer: all of it, else a fenced block, else the outermost {...}.
export function parseJson(text) {
  const raw = String(text ?? '').trim();
  const tries = [raw, ...[...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(match => match[1]),
    raw.includes('{') ? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) : ''];
  for (const candidate of tries) { try { return JSON.parse(candidate); } catch {} }
  throw new Error('not JSON');
}
