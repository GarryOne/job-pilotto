"""The digest header never counts a job the app's Jobs screen (scored matches) does not list."""
import tempfile
import unittest
from pathlib import Path

from src import digest, store as job_store
from src.ai import score
from tests.test_score import fit, seed_jobs


class DigestCountsTests(unittest.TestCase):
    def test_new_counts_only_jobs_the_app_lists(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 8, old=False)   # 8 jobs first seen in this run, none re-seen
                candidates, _ = digest.eligible_jobs(db)
                for job in candidates[:3]:
                    score.save(db, job, 'm', fit(80), 'p')
                app_lists = digest_app_count(db)
                shown = []
                text = digest.build_digest(db, seed=1, shown_ids=shown)[0][0]
                self.assertEqual(app_lists, 3)
                self.assertIn(f'{app_lists} new', text)
                self.assertEqual(len(shown), app_lists)

    def test_without_any_score_unscored_jobs_still_show(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 4, old=False)
                self.assertIn('4 new', digest.build_digest(db, seed=1)[0][0])


    def test_new_means_not_yet_sent_and_total_is_real(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 60)   # all re-seen by later crawls: first_seen != last_seen
                for job in digest.eligible_jobs(db)[0]:
                    score.save(db, job, 'm', fit(80), 'p')
                self.assertIn('60 new · Top 10 of 60 jobs', digest.build_digest(db, seed=1)[0][0])
                digest.mark_shown(db, [j['id'] for j in digest.eligible_jobs(db)[0][:25]], seed=1)
                self.assertIn('35 new · Top 10 of 60 jobs', digest.build_digest(db, seed=2)[0][0])


def digest_app_count(db):
    from src.daily_helpers import for_job_matches
    return len(for_job_matches(db, frozenset()))


if __name__ == '__main__':
    unittest.main()
