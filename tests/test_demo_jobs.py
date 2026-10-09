"""The app's demo data (desktop/demo/jobs.json) holds only jobs the engine could produce: a job's list status is what its Applications Stage
gives (src/desktop_jobs.stage_status). 9 Oct 2026: a demo job at "Interview scheduled" said "saved", so its row read Saved while its page
said Interview scheduled (the UI audit took it for a bug in the app)."""
import json
import unittest
from pathlib import Path

from src.desktop_jobs import stage_status

DEMO = Path(__file__).resolve().parents[1] / 'desktop' / 'demo' / 'jobs.json'


class DemoJobsTests(unittest.TestCase):
    def test_every_demo_job_with_a_stage_has_the_status_that_stage_gives(self):
        jobs = json.loads(DEMO.read_text())['jobs']
        wrong = [(job['url'], job['stage'], job['status']) for job in jobs if job.get('stage') and job['status'] != stage_status(job['stage'])]
        self.assertEqual(wrong, [])
        self.assertTrue(any(job.get('stage') for job in jobs), 'the demo has staged jobs to check')


if __name__ == '__main__':
    unittest.main()
