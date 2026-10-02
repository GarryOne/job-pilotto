import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import store as job_store


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

    def test_the_same_posting_under_tracking_parameters_is_one_job(self):
        # Found by the golden-postings e2e (2 Oct 2026): a feed listing one posting twice, the second with ?utm_source=..., made two jobs, two scores, two Notion rows.
        base = {'company': 'Example', 'title': 'Senior SRE', 'location': 'Zurich'}
        report = {'jobs': [{**base, 'id': '1', 'url': 'https://example.test/job/1'},
                           {**base, 'id': '2', 'url': 'https://example.test/job/1?utm_source=linkedin&utm_medium=social'},
                           {**base, 'id': '3', 'url': 'https://EXAMPLE.test/job/1/'}]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                self.assertEqual(job_store.import_watch_report(db, report), ['new', 'seen', 'seen'])
                self.assertEqual(len(job_store.digest_jobs(db)), 1)
                # Two real postings that differ in a parameter that identifies them stay two.
                other = {'jobs': [{**base, 'id': '4', 'url': 'https://example.test/job?gh_jid=4'}, {**base, 'id': '5', 'url': 'https://example.test/job?gh_jid=5'}]}
                job_store.import_watch_report(db, other)
                self.assertEqual(len(job_store.digest_jobs(db)), 3)

    def test_a_job_stored_under_its_raw_url_is_found_again_not_duplicated(self):
        # Databases made before the key was normalized hold "url:<raw url>": the next crawl must adopt that row, not add a second one.
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': [{'company': 'Example', 'id': '1', 'title': 'SRE', 'url': 'https://example.test/job/1'}]})
                db.execute("UPDATE jobs SET canonical_key=?", ('url:https://example.test/job/1/?utm_source=old',))   # the raw form the old code stored
                db.commit()
                status = job_store.import_watch_report(db, {'jobs': [{'company': 'Example', 'id': '1', 'title': 'SRE', 'url': 'https://example.test/job/1/?utm_source=old'}]})
                self.assertEqual(status, ['seen'])
                self.assertEqual(len(job_store.digest_jobs(db)), 1)
                self.assertEqual(db.execute('SELECT canonical_key FROM jobs').fetchone()[0], 'url:https://example.test/job/1')

    def test_applied_elsewhere_joins_the_jobs_list_as_applied(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                # Not found by any search: added from the posting's details.
                job_store.track_applied(db, 'https://jobs.lever.co/acme/1', {'title': 'SRE', 'company': 'Acme', 'location': 'Bern'})
                row = job_store.digest_jobs(db)[0]
                self.assertEqual((row['title'], row['company'], row['location'], row['application_status']),
                                 ('SRE', 'Acme', 'Bern', 'applied'))
                # Found by a search already: keeps the crawled details, only the status changes.
                job_store.import_watch_report(db, {'jobs': [{'company': 'Example', 'id': '2', 'title': 'Platform Engineer',
                                                              'url': 'https://example.test/2'}]})
                job_store.track_applied(db, 'https://example.test/2', {'title': 'Other title', 'company': 'Other'})
                crawled = [j for j in job_store.digest_jobs(db) if j['url'] == 'https://example.test/2']
                self.assertEqual([(j['title'], j['company'], j['application_status']) for j in crawled],
                                 [('Platform Engineer', 'Example', 'applied')])

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

    def test_stale_jobs_close_and_reopen_when_seen_again(self):
        from datetime import datetime, timedelta, timezone
        job = {'company': 'Example', 'id': '1', 'title': 'SRE', 'url': 'https://example.test/1'}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, {'jobs': [job]})
                later = datetime.now(timezone.utc) + timedelta(days=8)
                self.assertEqual(job_store.close_stale(db, 7, now=later), 1)
                self.assertEqual(job_store.digest_jobs(db), [])
                job_store.import_watch_report(db, {'jobs': [job]})
                self.assertEqual(len(job_store.digest_jobs(db)), 1)


if __name__ == '__main__':
    unittest.main()
