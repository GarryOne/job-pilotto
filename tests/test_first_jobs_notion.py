"""On a Notion install the first scored job is in the Jobs list at once, from this Mac's own state, before any sync to Notion has landed
(spec docs/superpowers/specs/2026-10-16-first-jobs-fast.md, cc's question on #999), and the first scores are written to Job Matches one by one."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from src import desktop_jobs, first_jobs, store as job_store
from src.ai import score as real_score
from src.daily_helpers import for_job_matches
from src.notion import client
from tests import test_store_notion
from tests.test_score import ModelClient


class FirstJobsOnNotionTests(unittest.TestCase):
    setUpClass = classmethod(test_store_notion.NotionStoreTests.setUpClass.__func__)
    tearDownClass = classmethod(test_store_notion.NotionStoreTests.tearDownClass.__func__)
    make = test_store_notion.NotionStoreTests.make

    def test_the_first_score_is_listed_from_local_state_before_notion_has_it(self):
        stores = self.make()
        self.tracker.database_id = self.env['NOTION_APPLICATIONS_DB']
        report = {'jobs': [{'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich', 'url': f'https://x.test/{i}',
                            'description': 'Kubernetes, Terraform, Datadog.', 'status': 'new'} for i in range(5)], 'sources': []}
        seen, took, read_ms = [], [], []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(client, 'MATCHES_DATABASE_ID', self.env['NOTION_MATCHES_DB']):
            def listed():   # what the window reads on this install: Notion's list, plus what only this Mac has
                rows = desktop_jobs.jobs(db, notion_jobs=self.tracker.notion_jobs(), hide_unscored=False)['jobs']
                return sorted((row['fit'] is not None, bool(row.get('unsynced'))) for row in rows)

            def sync():
                asked = time.monotonic()
                seen.append(('before sync', listed()))   # the score is saved, Notion has heard nothing
                if not read_ms:
                    read_ms.append(round((time.monotonic() - asked) * 1000))
                started = time.monotonic()
                stores.matches.sync(db, for_job_matches(db, frozenset()), frozenset(), None, frozenset(), partial=True)
                took.append(time.monotonic() - started)
                seen.append(('after sync', listed()))

            def scorer(db_, candidates, profile, model, max_jobs, **kw):
                return real_score.run(db_, candidates, profile, model, max_jobs, client=ModelClient({'m': lambda title: 70}), **kw)
            first_jobs.run(db, None, [{'company': 'Example', 'ats': 'greenhouse', 'slug': 'example'}], profile='Profile v1', hidden=frozenset(),
                           sync=sync, say=lambda _: None, scan=lambda sources, feed_db: report, scorer=scorer, model='m')
        before, after = seen[0], seen[1]
        self.assertEqual(before[1].count((True, True)), 1, 'the first scored job is listed before Notion has it, marked as not synced yet')
        self.assertEqual(len(before[1]), 5, 'all five found jobs are listed (the others say Scoring…)')
        self.assertEqual(after[1].count((True, False)), 1, 'after the sync the same job comes from Notion')
        self.assertEqual(len(took), 3, 'a sync after every one of the 3 first scores')
        print(f'  Notion stand-in: the first scored job was in the list {read_ms[0]} ms after its save, before any sync; each sync took {[round(t, 2) for t in took]} s')


if __name__ == '__main__':
    unittest.main()
