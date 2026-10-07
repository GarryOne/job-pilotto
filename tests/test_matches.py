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

    def test_a_fresh_cache_does_not_rewrite_rows_already_marked_not_seen(self):
        # 6 Oct 2026: the e2e workspace held 486 "Not seen" rows from earlier runs; each run starts with an empty cache and wrote every one again (~5 min of PATCHes).
        gone = [{'id': f'p{i}', 'properties': {'Job URL': {'url': f'https://x.test/gone{i}'}, 'Status': {'type': 'select', 'select': {'name': 'Not seen'}}}} for i in range(3)]
        class Tracker(FakeTracker):
            def query_database(self, database_id, filter_=None):
                return gone
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = Tracker()
                matches.sync(db, tracker, [job(1)], open_urls={'https://x.test/1'})
                self.assertEqual([call[0] for call in tracker.calls], [None])  # only the new job is written, not the three rows already Not seen
                matches.sync(db, tracker, [job(1)], open_urls={'https://x.test/1'})
                self.assertEqual(len(tracker.calls), 1)

    def test_two_stored_copies_of_one_job_make_one_row_not_two(self):
        # A database that already holds the same posting under two URL forms (found by the golden-postings e2e, 2 Oct 2026): one Notion row, the better score,
        # and a second sync changes nothing.
        clean, tracked = job(1, 75), {**job(2, 65), 'url': 'https://x.test/1?utm_source=linkedin&utm_medium=social'}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = FakeTracker()
                summary = matches.sync(db, tracker, [clean, tracked], open_urls={clean['url'], tracked['url']})
                self.assertIn('1 created, 0 updated', summary)
                self.assertEqual([call[1]['Score']['number'] for call in tracker.calls], [75])
                self.assertIn('0 created, 0 updated', matches.sync(db, tracker, [tracked, clean], open_urls={clean['url'], tracked['url']}))
                self.assertEqual(len(tracker.calls), 1)

    def test_a_write_during_scoring_adds_the_new_rows_and_marks_nothing_else(self):
        # 7 Oct 2026: Job Matches is written every 10 scores; only the end of the search knows every open job, so only it marks Not seen.
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                tracker = NotionTracker({'https://x.test/1': 'old-1', 'https://x.test/9': 'old-9'})
                summary = matches.sync(db, tracker, [job(1), job(2)], partial=True)
                self.assertIn('1 created', summary)
                self.assertNotIn(('old-9', {'Status': {'select': {'name': 'Not seen'}}}), tracker.calls)

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
