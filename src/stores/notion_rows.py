"""Notion rows ↔ store records: which column holds each field, and plain values ↔ Notion property values.

The notion adapter (src/stores/notion.py and the entity modules beside it) reads and writes every row through
`to_record` / `to_properties`, so the column names live here once. Page bodies (Markdown ↔ blocks) are
src/stores/notion_blocks.py. Guarded by tests/test_store_notion.py (the store contract against the Notion stand-in).
Column names and types: docs/notion-schema.md (config/notion_schema.json).
"""
import json

from .notion_blocks import plain_text

# A column: (field, Notion column, kind). Kinds are Notion property types, plus:
#   'relation1'  one linked page id ('' when none)
#   'created'    a settable date column holding the record's created_at; a row without it falls back to created_time
#   'json:<key>' one key of a JSON object kept in a text column (several fields may share the column)
#   'jsonrest:<key>,…'  the rest of that JSON object as a dict: every key but the listed ones (their json:<key> fields')
APPLICATION_COLUMNS = (
    ('url', 'Job URL', 'url'), ('title', 'Job', 'title'), ('company', 'Company', 'rich_text'),
    ('location', 'Location', 'rich_text'), ('work_mode', 'Work mode', 'select'), ('stage', 'Stage', 'select'),
    ('fit', 'Fit score', 'number'), ('next_step', 'Next step', 'rich_text'), ('next_interview', 'Next interview', 'date'),
    ('applied_on', 'Applied on', 'date'), ('via', 'Via', 'rich_text'), ('contact', 'Contact', 'rich_text'),
    ('origin', 'Origin', 'select'), ('source', 'Source', 'select'), ('notes', 'Notes', 'rich_text'),
    ('kit_inputs', 'Kit inputs', 'rich_text'), ('rejection', 'Rejection reason', 'select'),
    ('rejection_lesson', 'Rejection lesson', 'rich_text'), ('feedback_status', 'Feedback status', 'select'),
    ('employer_feedback', 'Employer feedback', 'rich_text'), ('salary', 'Salary', 'rich_text'),
    ('contract', 'Contract', 'select'), ('call_facts', 'Call facts', 'rich_text'), ('created_at', 'Created', 'created'),
    # The frozen record (src/notion/ledger_record.py) and what the engine stamps on a job.
    ('ats', 'ATS', 'select'), ('posted', 'Posted', 'date'), ('recorded', 'Recorded', 'date'), ('tier', 'Tier', 'select'),
    ('seniority', 'Seniority', 'select'), ('days_to_apply', 'Days to apply', 'number'),
    ('cover_letter', 'Cover letter', 'checkbox'), ('questions', 'Questions', 'number'),
    ('answers_captured', 'Answers captured', 'select'), ('cv_version', 'CV version', 'rich_text'),
    ('kit_variant', 'Kit variant', 'rich_text'), ('agent', 'Agent', 'select'), ('channel', 'Channel', 'select'),
    ('date_approximate', 'Date approximate', 'checkbox'), ('reached_via', 'Reached via', 'select'),
    ('recruiter', 'Recruiter', 'checkbox'), ('kit_cost', 'Kit cost (USD)', 'number'),
    ('fill_minutes', 'Form fill time (min)', 'number'), ('interview_prep', 'Interview prep', 'date'),
    ('confirmation_email', 'Confirmation email', 'checkbox'),
)
EVENT_COLUMNS = (
    ('app_id', 'Application', 'relation1'), ('kind', 'Kind', 'select'), ('at', 'At', 'date'),
    ('source', 'Source', 'select'), ('note', 'Note', 'rich_text'), ('source_id', 'Source ID', 'rich_text'),
    # The interview time sits in the Changes JSON, as src/notion/ledger.py has always written it.
    # What the item moved and which email it was ({fields, from, subject, feedback}) shares that JSON (src/ai/mail_record.py).
    ('changes', 'Changes', 'jsonrest:interview_at'), ('interview_at', 'Changes', 'json:interview_at'),
    # A question on no job ("Which job?"): Focus asks it, src/ai/reassign.py applies the answer.
    ('needs_you', 'Needs you', 'checkbox'), ('suggested_job', 'Suggested job', 'url'),
    ('created_at', 'Created', 'created'),
)
TEXT_LIMIT = 2000  # Notion's limit per rich-text part; a property's text is stored as written (no Markdown marks)


def _rich(value):
    text = '' if value is None else str(value)
    return [{'type': 'text', 'text': {'content': text[i:i + TEXT_LIMIT]}} for i in range(0, len(text), TEXT_LIMIT)][:100]


def _json_of(prop):
    try:
        found = json.loads(plain_text((prop or {}).get('rich_text')) or '{}')
    except ValueError:
        return {}
    return found if isinstance(found, dict) else {}


def read(prop, kind):
    """One Notion property value as a plain value ('' when empty; a number, a bool, a list where the type is)."""
    prop = prop or {}
    if kind.startswith('json:'):
        return _json_of(prop).get(kind[5:], '') or ''
    if kind.startswith('jsonrest:'):
        claimed = set(kind[9:].split(','))
        return {key: value for key, value in _json_of(prop).items() if key not in claimed} or ''
    if kind in ('title', 'rich_text'):
        return plain_text(prop.get(kind))
    if kind == 'select':
        return (prop.get('select') or {}).get('name') or ''
    if kind in ('date', 'created'):
        return (prop.get('date') or {}).get('start') or ''
    if kind == 'relation1':
        return ((prop.get('relation') or [{}])[0] or {}).get('id', '')
    if kind == 'relation':
        return [link['id'] for link in prop.get('relation') or []]
    if kind == 'multi_select':
        return [option['name'] for option in prop.get('multi_select') or []]
    if kind == 'number':
        return prop.get('number')
    if kind == 'checkbox':
        return bool(prop.get('checkbox'))
    if kind == 'url':
        return prop.get('url') or ''
    raise ValueError(f'unknown column kind {kind}')


def write(value, kind):
    """A plain value as the Notion property value that sets it (empty clears it)."""
    if kind in ('title', 'rich_text'):
        return {kind: _rich(value)}
    if kind == 'select':
        return {'select': {'name': str(value)} if value else None}
    if kind in ('date', 'created'):
        return {'date': {'start': str(value)} if value else None}
    if kind == 'relation1':
        return {'relation': [{'id': value}] if value else []}
    if kind == 'relation':
        return {'relation': [{'id': item} for item in value or []]}
    if kind == 'multi_select':
        return {'multi_select': [{'name': str(item)} for item in value or []]}
    if kind == 'number':
        return {'number': None if value in ('', None) else value}
    if kind == 'checkbox':
        return {'checkbox': bool(value)}
    if kind == 'url':
        return {'url': value or None}
    raise ValueError(f'unknown column kind {kind}')


def to_record(page, columns, fields):
    """A Notion page (a database row) as a record with exactly `fields`: id, the mapped columns, created_at."""
    props = page.get('properties') or {}
    values = {'id': page['id']}
    for field, column, kind in columns:
        values[field] = read(props.get(column), kind)
    if 'created_at' in fields and not values.get('created_at'):
        values['created_at'] = page.get('created_time', '')
    return {name: values.get(name, '') for name in fields}


def to_properties(values, columns, current=None):
    """The Notion properties that write `values` (fields not in `columns` are not written: the caller refuses
    unknown fields first). JSON columns merge into the row's current JSON (`current`: its properties)."""
    props, merged = {}, {}
    for field, column, kind in columns:
        if field not in values:
            continue
        if kind.startswith('json:') or kind.startswith('jsonrest:'):
            data = merged.setdefault(column, _json_of((current or {}).get(column)))
            if kind.startswith('jsonrest:'):
                claimed = set(kind[9:].split(','))
                for key in [key for key in data if key not in claimed]:
                    del data[key]
                data.update(values[field] or {})
            elif values[field]:
                data[kind[5:]] = values[field]
            else:
                data.pop(kind[5:], None)
            props[column] = {'rich_text': _rich(json.dumps(data, ensure_ascii=False)) if data else []}
        else:
            props[column] = write(values[field], kind)
    return props


def column_of(columns, field):
    return next((column, kind) for name, column, kind in columns if name == field)
