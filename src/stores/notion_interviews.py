"""🎤 Interviews in Notion as the store's interviews (base.Interviews): one database row per interview, plain dicts out.

The page keeps today's layout, so a Notion user sees no change: the 🔗 job line, the review (Markdown ↔ blocks through
notion_blocks, put where the placeholder or the old review is) and the transcript in a "Transcript" toggle. A listing
reads the rows only (no page bodies: one call per row); get() reads the page. Used by src/stores/notion.py.
Guarded by tests/test_store_notion_interviews.py.
"""
import os

from ..ai import interviews_blocks as layout
from ..ai import interviews_review as review_blocks
from . import base
from . import notion_blocks

# record field → (Notion column, kind)
COLUMNS = {'title': ('Interview', 'title'), 'at': ('Date', 'date'), 'input': ('Input', 'select'),
           'round': ('Round', 'text'), 'overall': ('Overall', 'select'), 'questions': ('Questions', 'number'),
           'weak_answers': ('Weak answers', 'number'), 'topics': ('Topics', 'text'), 'weak_topics': ('Weak topics', 'text'),
           'next_step': ('Next step', 'text'), 'cost': ('Cost (USD)', 'number'), 'model': ('Model', 'text')}
BODY = ('transcript', 'review')
NOT_KEPT = ()


def _same(a, b):
    return (a or '').replace('-', '') == (b or '').replace('-', '')


class NotionInterviews:
    def __init__(self, tracker, database_id=None):
        self.tracker = tracker
        self.database_id = database_id if database_id is not None else os.getenv('NOTION_INTERVIEWS_DB', '')

    def _record(self, page, body=None):
        props = page.get('properties') or {}
        values = {name: notion_blocks.value(props.get(col), kind) for name, (col, kind) in COLUMNS.items()}
        links = (props.get('Application') or {}).get('relation') or []
        values.update(id=page['id'], app_id=links[0]['id'] if links else '', created_at=page.get('created_time', ''),
                      **(body or {}))
        return base.record(base.INTERVIEW_FIELDS, values)

    def _properties(self, fields):
        props = {COLUMNS[k][0]: notion_blocks.column(COLUMNS[k][1], v) for k, v in fields.items() if k in COLUMNS}
        if 'app_id' in fields:
            props['Application'] = {'relation': [{'id': fields['app_id']}] if fields['app_id'] else []}
        return props

    def _app(self, app_id):
        return self.tracker._request('GET', f'pages/{app_id}') if app_id else None

    def _body(self, page_id):
        """(transcript, review) of a page: the Transcript toggle's text, and the review blocks as Markdown."""
        blocks = self.tracker._children(page_id)
        transcript = ''
        for block in blocks:
            if block['type'] == 'heading_3' and review_blocks._plain_block(block) == 'Transcript':
                kids = block.get('children') or self.tracker._children(block['id'])
                transcript = ''.join(notion_blocks.plain_text(k.get(k['type'], {}).get('rich_text')) for k in kids)
        ids = set(review_blocks.review_block_ids(blocks))
        return {'transcript': transcript,
                'review': notion_blocks.to_markdown([b for b in blocks if b.get('id') in ids], self.tracker._children)}

    def _set_transcript(self, page_id, transcript):
        for block in self.tracker._children(page_id):
            if block['type'] == 'heading_3' and review_blocks._plain_block(block) == 'Transcript':
                self.tracker._request('DELETE', f"blocks/{block['id']}")
        self.tracker._request('PATCH', f'blocks/{page_id}/children', {'children': [layout.transcript_toggle(transcript)]})

    def list(self, app_id=None):
        rows = [r for r in self.tracker.query_database(self.database_id) if not r.get('archived') and not r.get('in_trash')]
        found = [self._record(r) for r in rows]
        return [r for r in found if app_id is None or _same(r['app_id'], app_id)]

    def get(self, interview_id):
        try:
            page = self.tracker._request('GET', f'pages/{interview_id}')
        except Exception:  # noqa: BLE001 - a deleted or unshared page is not there
            return None
        if not page or page.get('archived') or page.get('in_trash'):
            return None
        return self._record(page, self._body(interview_id))

    def save(self, interview_id, fields):
        unknown = set(fields) - set(base.INTERVIEW_FIELDS)
        if unknown:
            raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
        fields = {k: v for k, v in fields.items() if k not in ('id', 'created_at', *NOT_KEPT)}
        if not interview_id:
            app = self._app(fields.get('app_id'))
            review = notion_blocks.to_blocks(fields['review']) if fields.get('review') else \
                [layout._block('paragraph', review_blocks.PLACEHOLDER)]
            page = self.tracker._request('POST', 'pages', {
                'parent': {'database_id': self.database_id}, 'properties': self._properties(fields),
                'children': [layout.job_line(app)] + review + [layout.transcript_toggle(fields.get('transcript') or '')]})
            return self._record(page, {k: fields.get(k, '') for k in BODY})
        if self.get(interview_id) is None:
            raise KeyError(interview_id)
        props = self._properties(fields)
        if props:
            self.tracker._request('PATCH', f'pages/{interview_id}', {'properties': props})
        if 'review' in fields:
            review_blocks.replace_review(self.tracker, interview_id, notion_blocks.to_blocks(fields['review']))
        if 'transcript' in fields:
            self._set_transcript(interview_id, fields['transcript'])
        if 'app_id' in fields:
            layout.ensure_job_line(self.tracker, interview_id, self._app(fields['app_id']))
        return self.get(interview_id)

    def archive(self, interview_id):
        self.tracker._request('PATCH', f'pages/{interview_id}', {'archived': True})

    def put(self, record):
        """A record copied from another store (Notion sets its own created time)."""
        return self.save(None, {k: v for k, v in record.items() if k not in ('id', 'created_at')})
