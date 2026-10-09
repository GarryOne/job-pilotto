"""The notion store's AgentRuns: 🤖 Agent Runs rows (form fills and Apply sessions) as store records.

`fields` holds base.AGENT_RUN_EXTRAS, each in its own column. Notion computes five of them itself (Age (days), Fresh,
Fill time, Waiting for you: formulas; Job stage: a rollup): they are read, and a write of them is left out. The
transcript is the page's "Transcript" toggle (Markdown through src/stores/notion_blocks.py). Guarded by
tests/test_store_notion.py (the store contract on the Notion stand-in).
"""
from datetime import datetime, timezone

from . import base
from . import notion_rows as rows
from .notion_blocks import to_blocks, to_markdown

COLUMNS = (('url', 'Job URL', 'url'), ('ats', 'ATS', 'select'), ('outcome', 'Outcome', 'select'),
           ('learnings', 'Learnings', 'rich_text'), ('created_at', 'Created', 'created'))
EXTRAS = {'job': ('Job', 'relation1'), 'company': ('Company', 'rich_text'), 'agent': ('Agent', 'select'),
          'status': ('Status', 'select'), 'reason': ('Reason', 'rich_text'), 'started': ('Started', 'date'),
          'ended': ('Ended', 'date'), 'minutes': ('Minutes', 'number'), 'field_count': ('Fields', 'number'),
          'unfilled_required': ('Unfilled required', 'number'), 'billed_to': ('Billed to', 'select'),
          'session_id': ('Session id', 'rich_text'), 'tokens_total': ('Tokens (total)', 'number'),
          'output_tokens': ('Output tokens', 'number'), 'working_min': ('Claude working (min)', 'number'),
          'waiting_min': ('Waiting for you (min)', 'number'), 'times_asked': ('Times asked', 'number'),
          'reply_median_s': ('Your reply (median s)', 'number'), 'ready_to_decided_min': ('Ready → decided (min)', 'number'),
          'turns': ('Turns', 'number'), 'tool_calls': ('Tool calls', 'number'), 'tools_used': ('Tools used', 'rich_text'),
          'tokens_in': ('Tokens in', 'number'), 'tokens_out': ('Tokens out', 'number'), 'cache_read': ('Cache read', 'number'),
          'model': ('Model', 'rich_text'), 'timeline': ('Session timeline', 'rich_text'), 'data': ('Data', 'json')}
COMPUTED = {'age_days': 'Age (days)', 'fresh': 'Fresh', 'fill_time': 'Fill time', 'waiting_for_you': 'Waiting for you',
            'job_stage': 'Job stage'}
TRANSCRIPT = 'Transcript'


def _computed(prop):
    """A formula's or a rollup's value, plain."""
    prop = prop or {}
    inner = prop.get(prop.get('type') or '') or {}
    value = inner.get(inner.get('type') or '') if isinstance(inner, dict) else None
    if isinstance(value, list):  # a rollup of selects or texts
        return ', '.join(filter(None, ((item.get('select') or {}).get('name') or rows.plain_text(item.get('rich_text') or item.get('title'))
                                       for item in value)))
    return value.get('start', '') if isinstance(value, dict) else value


def _read(prop, kind):
    if kind == 'json':
        import json
        text = rows.read(prop, 'rich_text')
        try:
            return json.loads(text) if text else None
        except ValueError:
            return text
    return rows.read(prop, kind)


def _write(value, kind):
    if kind == 'json':
        import json
        return rows.write(json.dumps(value, ensure_ascii=False) if value not in (None, '') else '', 'rich_text')
    return rows.write(value, kind)


class NotionAgentRuns:
    fields = base.AGENT_RUN_FIELDS

    def __init__(self, tracker, database_id):
        self.tracker, self.database_id = tracker, database_id

    def _record(self, page, transcript=None):
        props = page.get('properties') or {}
        found = rows.to_record(page, COLUMNS, [f for f in self.fields if f not in ('fields', 'transcript')])
        extras = {key: _read(props.get(column), kind) for key, (column, kind) in EXTRAS.items()}
        extras.update({key: _computed(props.get(column)) for key, column in COMPUTED.items()})
        found['fields'] = {key: value for key, value in extras.items() if value not in (None, '', [])}
        found['transcript'] = self._transcript(page['id']) if transcript is None else transcript
        return base.record(self.fields, found)

    def _transcript(self, run_id):
        for block in self.tracker._children(run_id):
            body = block.get(block['type']) or {}
            if block['type'] == 'heading_2' and body.get('is_toggleable') and rows.plain_text(body.get('rich_text')) == TRANSCRIPT:
                return to_markdown(self.tracker._children(block['id']) if block.get('has_children') else [],
                                   children=self.tracker._children)
        return ''

    def _set_transcript(self, run_id, markdown):
        for block in self.tracker._children(run_id):
            body = block.get(block['type']) or {}
            if block['type'] == 'heading_2' and rows.plain_text(body.get('rich_text')) == TRANSCRIPT:
                self.tracker._request('DELETE', f"blocks/{block['id']}")
        if markdown:
            self.tracker.append_blocks(run_id, [{'object': 'block', 'type': 'heading_2', 'heading_2': {
                'rich_text': rows.write(TRANSCRIPT, 'rich_text')['rich_text'], 'is_toggleable': True,
                'children': to_blocks(markdown)[:100]}}])

    def _properties(self, values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
        base.check_extras(values, base.AGENT_RUN_EXTRAS)
        props = rows.to_properties({k: v for k, v in values.items() if k not in ('fields', 'transcript', 'id')}, COLUMNS)
        for key, value in (values.get('fields') or {}).items():
            if key in EXTRAS:  # a computed one (COMPUTED) is Notion's own: not written
                column, kind = EXTRAS[key]
                props[column] = _write(value, kind)
        return props

    def _title(self, values):
        extras = values.get('fields') or {}
        parts = (extras.get('company'), extras.get('job'), extras.get('agent') or values.get('ats'))
        return {'Run': rows.write(' · '.join(str(p) for p in parts if p and not str(p).count('-') == 4)[:200] or 'Run', 'title')}

    def _create(self, values):
        values = {**values, 'created_at': values.get('created_at') or datetime.now(timezone.utc).isoformat(timespec='seconds')}
        page = self.tracker.create_page(self.database_id, {**self._properties(values), **self._title(values)})
        self._set_transcript(page['id'], values.get('transcript') or '')
        return self._record(page, values.get('transcript') or '')

    def add(self, run):
        return self._create({k: v for k, v in dict(run).items() if k != 'id'})

    def put(self, record):
        return self._create({k: v for k, v in dict(record).items() if k != 'id'})

    def update(self, run_id, fields):
        fields = {k: v for k, v in fields.items() if k not in ('id', 'created_at')}
        props = self._properties(fields)
        if self.get(run_id) is None:
            raise KeyError(run_id)
        page = self.tracker.update_page(run_id, props) if props else self.tracker._request('GET', f'pages/{run_id}')
        if 'transcript' in fields:
            self._set_transcript(run_id, fields['transcript'] or '')
        return self._record(page)

    def get(self, run_id):
        try:
            page = self.tracker._request('GET', f'pages/{run_id}')
        except Exception:  # noqa: BLE001 (a missing or foreign id: Notion answers 400/404)
            return None
        if page.get('archived') or (page.get('parent') or {}).get('database_id', '').replace('-', '') != \
                self.database_id.replace('-', ''):
            return None
        return self._record(page)

    def list(self, ats=None, limit=None):
        filter_ = {'property': 'ATS', 'select': {'equals': ats}} if ats is not None else None
        pages = [page for page in self.tracker.query_database(self.database_id, filter_) if not page.get('archived')]
        pages.sort(key=lambda page: ((rows.read(page['properties'].get('Created'), 'created') or page.get('created_time', ''))[:19],
                                     page.get('created_time', '')), reverse=True)  # same second: Notion's own time in ms
        return [self._record(page) for page in pages[:limit] if page]
