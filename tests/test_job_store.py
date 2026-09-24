import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import job_store


class CanonicalStoreTests(unittest.TestCase):
    def test_import_is_idempotent_and_status_is_tracked(self):
        report = {'jobs': [{'company': 'Example', 'id': '1', 'title': 'SRE', 'location': 'Zurich',
                            'city': 'Zurich', 'work_mode': 'Hybrid (stated)', 'url': 'https://example.test/1'}]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                self.assertEqual(job_store.import_watch_report(db, report), ['new'])
                self.assertEqual(job_store.import_watch_report(db, report), ['seen'])
                row = job_store.digest_jobs(db)[0]
                self.assertEqual(row['application_status'], 'unreviewed')
                job_store.set_application_status(db, row['id'], 'saved')
                self.assertEqual(job_store.digest_jobs(db)[0]['application_status'], 'saved')

    def test_invalid_application_status_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                with self.assertRaises(ValueError):
                    job_store.set_application_status(db, 1, 'auto_apply')

    def test_same_application_url_converges_across_sources(self):
        first = {'company': 'Example', 'id': 'a', 'title': 'SRE', 'url': 'https://example.test/job', 'location': 'Zurich'}
        second = {'company': 'Example', 'id': 'b', 'title': 'SRE', 'url': 'https://example.test/job', 'location': 'Zurich'}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.upsert_job(db, first, 'jobs.ch')
                job_store.upsert_job(db, second, 'Employer feed')
                self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 1)

    def test_description_is_kept_when_a_later_fetch_has_none(self):
        job = {'company': 'Example', 'id': '1', 'title': 'SRE', 'url': 'https://example.test/1',
               'description': 'Run Kubernetes in production.'}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': [job]})
                job_store.import_watch_report(db, {'jobs': [dict(job, description='')]})
                self.assertEqual(job_store.digest_jobs(db)[0]['description'], 'Run Kubernetes in production.')


if __name__ == '__main__':
    unittest.main()
