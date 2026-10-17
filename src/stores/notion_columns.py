"""Writing to a Notion database that may lack a column the code knows: the one place that leaves such a column out.

An older workspace (before the app's schema repair, or a GitHub run ahead of it) lacks newer columns, and Notion refuses a
whole row for one unknown property. Two ways to keep the row: `KnownColumns` reads the database schema once and filters
before the write; `without_missing` sends, and on "X is not a property that exists" drops X and sends again.
Used by the notion store (notion.py, notion_cron_runs.py, notion_employers.py, notion_insights.py) and src/notion/cron_runs.py.
Guarded by tests/test_notion_columns.py and the store contract tests.
"""
import re


class KnownColumns:
    """The columns database `database_id` has, read once per process; `writable(props)` keeps only those."""

    def __init__(self, tracker, database_id):
        self.tracker, self.database_id = tracker, database_id
        self._have = None

    def have(self):
        if self._have is None:
            schema = self.tracker._request('GET', f'databases/{self.database_id}')
            self._have = set(schema.get('properties') or {})
        return self._have

    def writable(self, props):
        have = self.have()
        return {name: value for name, value in props.items() if name in have}


def without_missing(send, properties):
    """send(properties); when Notion refuses a column this workspace doesn't have yet (the code is newer than its
    schema: a GitHub run before the app's schema repair), drop that column and send again, so the row is never lost."""
    for _ in range(5):
        try:
            return send(properties)
        except Exception as error:  # noqa: BLE001 — only a missing column is retried
            missing = re.search(r'([^:.\n]+?) is not a property that exists', str(error))
            name = missing.group(1).strip().strip('"').strip("'") if missing else ''
            if name not in properties:
                raise
            properties = {k: v for k, v in properties.items() if k != name}
    return send(properties)
