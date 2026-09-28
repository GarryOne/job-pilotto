import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import desktop, store


class FakeTracker:
    def __init__(self):
        self.marked = []

    def mark(self, job, stage):
        self.marked.append((job['url'], job['title'], job['company'], stage))
        return {}, 'created'


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = store.connect(Path(self.tmp.name) / 'jobs.sqlite')
        store.upsert_job(self.db, {'title': 'Site Reliability Engineer', 'company': 'Acme', 'url': 'https://x.test/1',
                                   'location': 'Zurich'}, 'Acme', source_kind='employer feed')
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def test_jobs_lists_open_jobs_as_json(self):
        result = desktop.jobs(self.db)
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['jobs'][0]['title'], 'Site Reliability Engineer')
        json.dumps(result)

    def test_posting_finds_a_job_by_its_code(self):
        from src.notion.client import job_code
        found = desktop.posting(self.db, job_code('https://x.test/1'))
        self.assertTrue(found['ok'])
        self.assertEqual((found['title'], found['company'], found['url']), ('Site Reliability Engineer', 'Acme', 'https://x.test/1'))
        self.assertFalse(desktop.posting(self.db, 'nope0000')['ok'])

    def test_a_job_has_a_kit_when_its_notion_stage_is_kit_ready(self):
        self.assertFalse(desktop.jobs(self.db)['jobs'][0]['kit'])
        self.assertTrue(desktop.jobs(self.db, stages={'https://x.test/1': 'Kit ready'})['jobs'][0]['kit'])
        self.assertFalse(desktop.jobs(self.db, stages={'https://x.test/1': 'Saved'})['jobs'][0]['kit'])
        row = desktop.jobs(self.db, stages={'https://x.test/1': ('Kit ready', '⛔ Not eligible: UK residents only')})['jobs'][0]
        self.assertEqual((row['kit'], row['ineligible']), (True, 'UK residents only'))
        page = desktop.jobs(self.db, stages={'https://x.test/1': ('Kit ready', '', 'https://notion.so/p')})['jobs'][0]
        self.assertEqual(page['notion_url'], 'https://notion.so/p')
        # starred first, kit drafted later: the stage stays Saved, Next step shows the kit
        self.assertTrue(desktop.jobs(self.db, stages={'https://x.test/1': ('Saved', '📝 Kit ready: review it, then Apply')})['jobs'][0]['kit'])

    def test_status_is_local_and_reaches_notion_applications(self):
        tracker = FakeTracker()
        self.assertEqual(desktop.set_status(self.db, 'https://x.test/1', 'saved', tracker), {'ok': True, 'notion': 'created'})
        self.assertEqual(tracker.marked, [('https://x.test/1', 'Site Reliability Engineer', 'Acme', 'Saved')])
        self.assertEqual(desktop.jobs(self.db)['jobs'][0]['status'], 'saved')

    def test_notion_stage_is_the_truth_and_refreshes_the_local_cache(self):
        desktop.set_status(self.db, 'https://x.test/1', 'saved')  # stale local value
        listed = desktop.jobs(self.db, stages={'https://x.test/1': ('Rejected', '', '')}, notion=True)
        self.assertEqual(listed['jobs'][0]['status'], 'applied')  # Rejected = it was applied to
        self.assertEqual(desktop.jobs(self.db)['jobs'][0]['status'], 'applied')  # cache updated
        # No row in Notion (e.g. the Saved row was deleted there) = not reviewed.
        self.assertEqual(desktop.jobs(self.db, stages={}, notion=True)['jobs'][0]['status'], 'unreviewed')
        self.assertEqual([desktop.stage_status(s) for s in (None, 'Kit ready', 'Saved', 'Dismissed', 'Closed', 'Interview scheduled')],
                         ['unreviewed', 'unreviewed', 'saved', 'dismissed', 'dismissed', 'applied'])

    def test_a_status_notion_rejects_changes_nothing(self):
        class Down:
            def mark(self, job, stage):
                raise TimeoutError()
        result = desktop.set_status(self.db, 'https://x.test/1', 'dismissed', Down())
        self.assertFalse(result['ok'])
        self.assertIn('Notion could not be updated', result['error'])
        self.assertEqual(desktop.jobs(self.db)['jobs'][0]['status'], 'unreviewed')

    def test_without_notion_status_stays_local(self):
        self.assertEqual(desktop.set_status(self.db, 'https://x.test/1', 'applied'), {'ok': True})
        self.assertFalse(desktop.set_status(self.db, 'https://x.test/404', 'applied')['ok'])


if __name__ == '__main__':
    unittest.main()


class StrategyTests(unittest.TestCase):
    def test_strategy_shows_the_users_own_targets_scores_and_counts(self):
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from unittest import mock
        from src import desktop, store
        with tempfile.TemporaryDirectory() as tmp:
            db = store.connect(Path(tmp) / 'j.sqlite')
            fits = {1: {'components': {'role_fit': 80, 'location': 60, 'compensation': 50, 'growth': 40, 'risk': 30}},
                    2: {'components': {'role_fit': 60, 'location': 40, 'compensation': 50, 'growth': 60, 'risk': 10}}}
            tracker = SimpleNamespace(url_stages=lambda: {'a': 'Applied', 'b': 'Kit ready', 'c': 'Rejected', 'd': 'Saved'},
                                      page_text=lambda: '# Compensation\n- Target: CHF 150k\n# Other\n- x',
                                      _request=lambda *a, **k: {'results': []})
            search = {'jobs_board_search_queries': ['site reliability'], 'locations': {'top_tier': ['z[uü]rich'], 'country_wide': ['switzerland', 'bern'], 'abroad': ['berlin']},
                      'quality_stack_keywords': [r'\bk8s\b'], 'title_exclude_keywords': ['sales']}
            with mock.patch.object(desktop.digest, 'eligible_jobs', lambda db: ([{'id': 1}, {'id': 2}], [])), \
                    mock.patch.object(desktop.score, 'load', lambda db: fits), mock.patch('src.paths.load_search_config', lambda: search):
                data = desktop.strategy(db, tracker)
            db.close()
        self.assertEqual(data['roles'], ['site reliability'])
        self.assertEqual(data['locations'], ['zürich', 'switzerland', 'berlin'])
        self.assertEqual(data['stack'], ['k8s'])
        self.assertEqual(data['compensation'], 'Target: CHF 150k')
        self.assertIn('Title: sales', data['avoid'])
        self.assertEqual({c['key']: c['value'] for c in data['components']},
                         {'role_fit': 70, 'location': 50, 'compensation': 50, 'growth': 50, 'risk': 80})  # risk shown as "low risk"
        self.assertEqual(data['counts'], {'matches': 2, 'kits': 1, 'sent': 2})
