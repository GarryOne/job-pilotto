import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import store as job_store
from src.notion import matches
from test_score import fit


class FakeTracker:
    def __init__(self):
        self.calls = []

    def upsert_match(self, properties, page_id=None):
        self.calls.append((page_id, properties))
        return page_id or f'page-{len(self.calls)}'


def job(i, value=80):
    return {'id': i, 'title': f'SRE {i}', 'company': 'Example', 'location': 'Zurich',
            'url': f'https://x.test/{i}', 'fit': fit(value), 'ai': None}


class NotionTracker(FakeTracker):
    """Also answers the Job Matches query, with rows made before this SQLite existed."""
    def __init__(self, existing):
        super().__init__()
        self.existing = existing

    def query_database(self, database_id, filter_=None):
        return [{'id': page_id, 'properties': {'Job URL': {'url': url}}} for url, page_id in self.existing.items()]


class MatchesSyncTests(unittest.TestCase):
    def test_a_runner_without_its_sqlite_rewrites_only_rows_that_differ(self):
        # A new GitHub repo or an expired cache: Notion already holds job 1 exactly, job 2 with an older score.
        def as_notion(props):  # how Notion returns what was written
            out = {}
            for key, value in props.items():
                kind = next(iter(value))
                inner = value[kind]
                if kind in ('title', 'rich_text'):
                    inner = [{'plain_text': part['text']['content']} for part in inner]
                out[key] = {'type': kind, kind: inner}
            return out
        same, older = matches.properties(job(1), 'Open'), matches.properties(job(2, 70), 'Open')
        class Tracker(FakeTracker):
            def query_database(self, database_id, filter_=None):
                return [{'id': 'p1', 'properties': as_notion(same)}, {'id': 'p2', 'properties': as_notion(older)}]
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = Tracker()
                summary = matches.sync(db, tracker, [job(1), job(2)], open_urls={'https://x.test/1', 'https://x.test/2'})
                self.assertEqual([call[0] for call in tracker.calls], ['p2'])  # only the changed row is written
                self.assertIn('0 created, 1 updated', summary)
                self.assertIn('0 created, 0 updated', matches.sync(db, tracker, [job(1), job(2)],
                                                                  open_urls={'https://x.test/1', 'https://x.test/2'}))

    def test_reset_cache_adopts_existing_rows_instead_of_duplicating(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = NotionTracker({'https://x.test/1': 'old-1', 'https://x.test/9': 'old-9'})
                summary = matches.sync(db, tracker, [job(1), job(2)], open_urls={'https://x.test/1', 'https://x.test/2'})
                self.assertIn('1 created', summary)
                self.assertEqual(tracker.calls[0][0], 'old-1')  # updated in place, not created again
                # A row Notion still shows Open, for a job the crawl no longer lists, becomes Not seen.
                self.assertIn(('old-9', {'Status': {'select': {'name': 'Not seen'}}}), tracker.calls)
                self.assertIn('0 created, 0 updated', matches.sync(db, tracker, [job(1), job(2)],
                                                                  open_urls={'https://x.test/1', 'https://x.test/2'}))

    def test_creates_once_skips_unchanged_and_updates_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = FakeTracker()
                jobs = [job(1), job(2)]
                self.assertIn('2 created', matches.sync(db, tracker, jobs))
                self.assertIn('0 created, 0 updated', matches.sync(db, tracker, jobs))
                self.assertIn('1 updated', matches.sync(db, tracker, [job(1, 60), job(2)]))
                # Job 2 applied (no longer eligible), job 1 still open.
                summary = matches.sync(db, tracker, [job(1, 60)], applied_urls={'https://x.test/2'},
                                       open_urls={'https://x.test/1', 'https://x.test/2'})
                self.assertIn('1 updated', summary)
                self.assertEqual(tracker.calls[-1], ('page-2', {'Status': {'select': {'name': 'Applied'}}}))
                props = tracker.calls[0][1]
                self.assertEqual(props['Score'], {'number': 80})
                self.assertEqual(props['Status'], {'select': {'name': 'Open'}})
                self.assertEqual(len(props['Code']['rich_text'][0]['text']['content']), 8)


if __name__ == '__main__':
    unittest.main()
