"""The notion store's Employers: 🌍 Employers & Sources rows as store records, one per employer (matched by name, any case).

Find employers (src/scout_notion.py) writes each checked employer here through `upsert`; the feed crawl reads the active ones
with a feed through `list`. A column an older workspace lacks yet is dropped from that write, never the row (_without_missing).
Columns: config/notion_schema.json NOTION_EMPLOYERS_DB. Guarded by tests/test_store_notion.py (the store contract on the stand-in).
"""
from ..notion.cron_runs import _without_missing
from . import base
from . import notion_rows as rows

COLUMNS = (('name', 'Company', 'title'), ('website', 'Website', 'url'), ('careers_url', 'Careers', 'url'),
           ('feed', 'Feed', 'url'), ('active', 'Active', 'checkbox'), ('kind', 'Kind', 'select'), ('tier', 'Tier', 'select'),
           ('ats', 'ATS', 'select'), ('slug', 'Slug', 'rich_text'), ('feed_status', 'Feed status', 'select'),
           ('integration', 'Integration', 'select'), ('quality', 'Quality', 'number'), ('origin', 'Origin', 'rich_text'),
           ('cities', 'Cities', 'rich_text'), ('relevant_roles', 'Relevant roles', 'number'),
           ('in_preferred_places', 'In preferred places', 'number'), ('notes', 'Notes', 'rich_text'), ('size', 'Size', 'rich_text'),
           ('verification', 'Verification', 'select'), ('glassdoor', 'Glassdoor', 'url'), ('levels_fyi', 'levels.fyi', 'url'),
           ('checked', 'Checked', 'date'), ('added', 'Added', 'date'))
# The table has no Created column: created_at is the row's created time.
assert {field for field, _, _ in COLUMNS} | {'id', 'created_at'} == set(base.EMPLOYER_FIELDS), 'every employer field has its column'


class NotionEmployers:
    fields = base.EMPLOYER_FIELDS

    def __init__(self, tracker, database_id):
        self.tracker, self.database_id = tracker, database_id

    def _record(self, page):
        return rows.to_record(page, COLUMNS, self.fields)

    def _pages(self, filter_=None):
        return [page for page in self.tracker.query_database(self.database_id, filter_)
                if not page.get('archived') and not page.get('in_trash')]

    def _find(self, name):
        key = (name or '').strip().casefold()
        pages = self._pages({'property': 'Company', 'title': {'contains': (name or '').strip()}})
        return next((page for page in pages if rows.read(page['properties'].get('Company'), 'title').strip().casefold() == key), None)

    def _properties(self, values):
        unknown = set(values) - set(self.fields)
        if unknown:
            raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
        return rows.to_properties({k: v for k, v in values.items() if k not in ('id', 'created_at')}, COLUMNS)

    def _create(self, values):
        return self._record(_without_missing(lambda p: self.tracker.create_page(self.database_id, p), self._properties(values)))

    def list(self, active=True):
        filter_ = None if active is None else {'property': 'Active', 'checkbox': {'equals': bool(active)}}
        return sorted((self._record(page) for page in self._pages(filter_)), key=lambda employer: employer['name'].casefold())

    def add(self, employer):
        page = self._find(employer['name'])
        if page:
            return self._record(page)
        return self._create({'active': True, **employer})

    def upsert(self, employer):
        page = self._find(employer['name'])
        if page is None:
            return self.add(employer)
        props = self._properties({k: v for k, v in employer.items() if k != 'name'})  # the row keeps the name it was found by
        if not props:
            return self._record(page)
        return self._record(_without_missing(lambda p: self.tracker.update_page(page['id'], p), props) or page)

    def put(self, record):
        """A record copied from another store (Notion sets its own created time)."""
        return self._create(dict(record))
