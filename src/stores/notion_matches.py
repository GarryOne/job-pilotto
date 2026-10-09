"""The notion store's Matches: 🎯 Job Matches rows as store records, one per job (found by its URL, src/stores/base.url_key).

The record holds what the app shows (fit, reason, why: strengths, gaps and the score's parts); sync() is the search's own sync
(src/notion/matches.py), which also writes the scoring columns it alone knows (tier, confidence, languages...).
Guarded by tests/test_store_notion.py (the store contract on the Notion stand-in).
"""
from datetime import datetime, timezone

from . import base
from . import notion_rows as rows

COLUMNS = (('url', 'Job URL', 'url'), ('title', 'Job', 'title'), ('company', 'Company', 'rich_text'),
           ('location', 'Location', 'rich_text'), ('work_mode', 'Work mode', 'select'), ('fit', 'Score', 'number'),
           ('reason', 'Reason', 'rich_text'), ('status', 'Status', 'select'), ('first_seen', 'First seen', 'date'),
           ('tier', 'Tier', 'select'), ('confidence', 'Confidence', 'select'), ('code', 'Code', 'rich_text'), ('scored', 'Scored', 'date'),
           ('scoring_method', 'Scoring method', 'select'), ('seniority', 'Seniority', 'select'), ('languages', 'Languages', 'multi_select'),
           ('salary', 'Salary', 'rich_text'), ('recruiter', 'Recruiter', 'checkbox'), ('technologies', 'Technologies', 'rich_text'),
           ('role_family', 'Role family', 'select'))
# fit_detail: {'strengths', 'gaps', 'parts': {part: number}}, each in its own column (as notion_jobs reads them).
PARTS = (('role_fit', 'Role fit'), ('location', 'Location fit'), ('compensation', 'Compensation fit'),
         ('growth', 'Growth'), ('risk', 'Risk'))


def _detail_of(props):
    return {'strengths': rows.read(props.get('Strengths'), 'rich_text'), 'gaps': rows.read(props.get('Gaps'), 'rich_text'),
            'parts': {part: rows.read(props.get(column), 'number') for part, column in PARTS}}


def _detail_props(detail):
    detail = detail or {}
    props = {column: rows.write(value, 'rich_text') for key, column in (('strengths', 'Strengths'), ('gaps', 'Gaps'))
             if (value := detail.get(key)) is not None}
    for part, column in PARTS:
        if part in (detail.get('parts') or {}):
            props[column] = rows.write(detail['parts'][part], 'number')
    return props


class NotionMatches:
    fields = base.MATCH_FIELDS

    def __init__(self, tracker, database_id):
        self.tracker, self.database_id = tracker, database_id

    def _record(self, page):
        found = rows.to_record(page, COLUMNS, [f for f in self.fields if f not in ('fit_detail', 'last_update')])   # id: the page's
        found['first_seen'] = found['first_seen'] or page.get('created_time', '')
        found['last_update'] = page.get('last_edited_time', '')   # Notion's own Last update: read, never written
        return {**base.record(self.fields, found), 'fit_detail': _detail_of(page.get('properties') or {})}

    def _pages(self, filter_=None):
        return [page for page in self.tracker.query_database(self.database_id, filter_) if not page.get('archived')]

    def _find(self, url):
        url, key = (url or '').strip(), base.url_key(url)
        forms = list(dict.fromkeys((url, url.rstrip('/'), url.rstrip('/') + '/')))
        pages = self._pages({'or': [{'property': 'Job URL', 'url': {'equals': form}} for form in forms]})
        return next((page for page in pages if base.url_key(rows.read(page['properties'].get('Job URL'), 'url')) == key), None)

    def _properties(self, values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
        props = rows.to_properties({k: v for k, v in values.items() if k not in ('id', 'fit_detail', 'last_update')}, COLUMNS)
        return {**props, **(_detail_props(values['fit_detail']) if 'fit_detail' in values else {})}

    def list(self, status=None):
        filter_ = {'property': 'Status', 'select': {'equals': status}} if status is not None else None
        return sorted((self._record(page) for page in self._pages(filter_)), key=lambda match: match['first_seen'])

    def get(self, url):
        page = self._find(url)
        return self._record(page) if page else None

    def upsert(self, job):
        page = self._find(job['url'])
        if page:
            values = {k: v for k, v in job.items() if k != 'url'}  # the row keeps the URL it was found by
            return self._record(self.tracker.update_page(page['id'], self._properties(values)) if values else page)
        first = job.get('first_seen') or datetime.now(timezone.utc).isoformat(timespec='seconds')
        return self._record(self.tracker.create_page(self.database_id, self._properties({**job, 'first_seen': first})))

    def set_status(self, url, status):
        page = self._find(url)
        if page is None:
            raise KeyError(url)
        self.tracker.update_page(page['id'], self._properties({'status': status}))

    def remove(self, url):
        """To Notion's trash (restorable there for 30 days)."""
        page = self._find(url)
        if page:
            self.tracker.trash_page(page['id'])

    def sync(self, db, scored_jobs, applied_urls=frozenset(), open_urls=None, dismissed_urls=frozenset(), partial=False):
        """Today's 🎯 Job Matches sync (src/notion/matches.py), unchanged: every scoring column, its page-id and hash cache in
        `db`, adopting rows it doesn't know by URL (a workspace a move filled through upsert gets no second row)."""
        from ..notion import matches as job_matches
        return job_matches.sync(db, _Bound(self.tracker, self.database_id), scored_jobs, applied_urls, open_urls,
                                dismissed_urls, partial)


class _Bound:
    """The tracker with Job Matches pinned to this store's database: the search's sync reads the id from its module, set
    from the same NOTION_MATCHES_DB at import; this keeps a store opened with other ids (a test's) on its own database."""
    def __init__(self, tracker, database_id):
        self._tracker, self._database_id = tracker, database_id

    def query_database(self, database_id, filter_=None):
        return self._tracker.query_database(self._database_id, filter_)

    def upsert_match(self, properties, page_id=None, database_id=None):
        return self._tracker.upsert_match(properties, page_id, database_id=self._database_id)

    def __getattr__(self, name):
        return getattr(self._tracker, name)
