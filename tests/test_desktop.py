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

    def test_a_job_has_a_kit_when_its_notion_stage_is_kit_ready(self):
        self.assertFalse(desktop.jobs(self.db)['jobs'][0]['kit'])
        self.assertTrue(desktop.jobs(self.db, stages={'https://x.test/1': 'Kit ready'})['jobs'][0]['kit'])
        self.assertFalse(desktop.jobs(self.db, stages={'https://x.test/1': 'Saved'})['jobs'][0]['kit'])
        row = desktop.jobs(self.db, stages={'https://x.test/1': ('Kit ready', '⛔ Not eligible: UK residents only')})['jobs'][0]
        self.assertEqual((row['kit'], row['ineligible']), (True, 'UK residents only'))
        # starred first, kit drafted later: the stage stays Saved, Next step shows the kit
        self.assertTrue(desktop.jobs(self.db, stages={'https://x.test/1': ('Saved', '📝 Kit ready: review it, then Apply')})['jobs'][0]['kit'])

    def test_status_is_local_and_reaches_notion_applications(self):
        tracker = FakeTracker()
        self.assertEqual(desktop.set_status(self.db, 'https://x.test/1', 'saved', tracker), {'ok': True, 'notion': 'created'})
        self.assertEqual(tracker.marked, [('https://x.test/1', 'Site Reliability Engineer', 'Acme', 'Saved')])
        self.assertEqual(desktop.jobs(self.db)['jobs'][0]['status'], 'saved')

    def test_without_notion_status_stays_local(self):
        self.assertEqual(desktop.set_status(self.db, 'https://x.test/1', 'applied'), {'ok': True})
        self.assertFalse(desktop.set_status(self.db, 'https://x.test/404', 'applied')['ok'])


if __name__ == '__main__':
    unittest.main()
