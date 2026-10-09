"""JSON schemas across providers: a small validator, a forgiving JSON reader, and each provider's accepted form of one schema.

Callers write one schema per AI step. `without_limits` is what the Anthropic API accepts (no maxItems/minItems), `strict` is what
OpenAI's strict structured output accepts (every property required, optional ones nullable, no extra keys). `problems` checks an
answer against the original schema (CLI engines repair once on a mismatch). Guarded by tests/test_ai_providers.py.
"""
import json
import re

TYPES = {'object': dict, 'array': list, 'string': str, 'boolean': bool, 'null': type(None)}
LIMITS = ('maxItems', 'minItems')
# Keywords OpenAI's strict mode refuses; the answer is still checked against them by `problems` where it can.
STRICT_UNSUPPORTED = LIMITS + ('maxLength', 'minLength', 'pattern', 'format', 'minimum', 'maximum', 'default')


def without_limits(schema):
    """The schema without `maxItems`/`minItems`: the API rejects them in structured output (400, 3 Oct 2026), so callers cap the lists themselves."""
    if isinstance(schema, dict):
        return {k: without_limits(v) for k, v in schema.items() if k not in LIMITS}
    if isinstance(schema, list):
        return [without_limits(v) for v in schema]
    return schema


def _nullable(schema):
    kinds = schema.get('type')
    if isinstance(kinds, list):
        return schema if 'null' in kinds else dict(schema, type=kinds + ['null'])
    if kinds:
        return dict(schema, type=[kinds, 'null'], **({'enum': schema['enum'] + [None]} if 'enum' in schema and None not in schema['enum'] else {}))
    if 'anyOf' in schema:
        return dict(schema, anyOf=schema['anyOf'] + [{'type': 'null'}])
    return schema


def strict(schema):
    """The schema in the form OpenAI's strict structured output requires: every object lists all its properties as required
    and allows no others; a property the original did not require becomes nullable (the model answers null for "not given",
    which `drop_nulls` removes again so callers see the same answer as from Claude)."""
    if isinstance(schema, list):
        return [strict(item) for item in schema]
    if not isinstance(schema, dict):
        return schema
    out = {k: strict(v) for k, v in schema.items() if k not in STRICT_UNSUPPORTED}
    if out.get('type') == 'object' or 'properties' in out:
        props = out.get('properties') or {}
        required = set(schema.get('required') or [])
        out['properties'] = {k: (v if k in required else _nullable(v)) for k, v in props.items()}
        out['required'] = list(props)
        out['additionalProperties'] = False
    return out


def drop_nulls(value, schema):
    """An answer to a `strict` schema back in the original's shape: a null the original did not allow is removed (it meant "not given")."""
    if not isinstance(schema, dict):
        return value
    if isinstance(value, dict):
        props, required = schema.get('properties') or {}, set(schema.get('required') or [])
        return {k: drop_nulls(v, props.get(k)) for k, v in value.items() if not (v is None and k not in required and k in props)}
    if isinstance(value, list) and isinstance(schema.get('items'), dict):
        return [drop_nulls(item, schema['items']) for item in value]
    return value


def problems(value, schema, where='$'):
    """What makes value not match schema (empty: it matches). Enough for our schemas: types, required keys, enums."""
    if not isinstance(schema, dict):
        return []
    if 'anyOf' in schema:
        return [] if any(not problems(value, s, where) for s in schema['anyOf']) else [f'{where}: matches no option']
    kinds = schema.get('type')
    kinds = kinds if isinstance(kinds, list) else [kinds] if kinds else []
    if kinds and not any(_is(value, kind) for kind in kinds):
        return [f'{where}: expected {"/".join(kinds)}']
    if 'enum' in schema and value not in schema['enum']:
        return [f'{where}: {value!r} is not one of {schema["enum"]}']
    found = []
    if isinstance(value, dict):
        for key in schema.get('required', []):
            if key not in value:
                found.append(f'{where}.{key}: missing')
        for key, sub in (schema.get('properties') or {}).items():
            if key in value:
                found += problems(value[key], sub, f'{where}.{key}')
    if isinstance(value, list) and isinstance(schema.get('items'), dict):
        for i, item in enumerate(value[:200]):
            found += problems(item, schema['items'], f'{where}[{i}]')
    return found


def _is(value, kind):
    if kind == 'integer':
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == 'number':
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, TYPES.get(kind, object))


def parse_json(text):
    """The JSON in an answer: all of it, else a fenced block, else the outermost {...}."""
    text = (text or '').strip()
    for candidate in (text, *re.findall(r'```(?:json)?\s*(.*?)```', text, re.S),
                      text[text.find('{'):text.rfind('}') + 1] if '{' in text else ''):
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            continue
    raise ValueError('not JSON')
