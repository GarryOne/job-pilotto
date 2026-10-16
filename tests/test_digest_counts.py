"""Every place that counts jobs (the Jobs list, the digest, the Job Matches sync) counts the same ones, and "new" means added since the last digest."""
import re
import tempfile
import unittest
from pathlib import Path

from src import digest, desktop_jobs, store as job_store
from src.ai import score
from src.daily_helpers import for_job_matches
from tests.test_score import fit, seed_jobs


def header(text):
    return tuple(int(n) for n in re.search(r'(\d+) new · Top \d+ of (\d+) jobs', text).groups())


def app_total(db):
    """The Jobs list as the app builds it: the store's rows (what the sync wrote: the scored matches), plus unscored cache jobs, which wait."""
    stored = [{'url': j['url'], 'title': j['title'], 'company': j['company'], 'fit': j['fit']['score'], 'stage': None}
              for j in for_job_matches(db, frozenset())]
    return desktop_jobs.jobs(db, notion_jobs=stored, hide_unscored=True)['total']


def counts(db):
    """The job count each place shows, on one store (AI ready: unscored jobs wait)."""
    return {
        'Jobs list (app sidebar, Jobs screen, Focus)': app_total(db),
        'Job Matches sync': len(for_job_matches(db, frozenset())),
        'digest total': header(digest.build_digest(db, seed=1, hide_unscored=True)[0][0])[1],
        'digest new, first digest': header(digest.build_digest(db, seed=1, hide_unscored=True)[0][0])[0],
    }


class DigestCountsTests(unittest.TestCase):
    def store_with(self, tmp, jobs=8, scored=3):
        db = job_store.connect(Path(tmp) / 'jobs.sqlite')
        seed_jobs(db, jobs, old=False)
        for job in digest.eligible_jobs(db)[0][:scored]:
            score.save(db, job, 'm', fit(80), 'p')
        return db

    def test_every_place_counts_the_same_jobs(self):
        with tempfile.TemporaryDirectory() as tmp, self.store_with(tmp) as db:
            shown = counts(db)
            self.assertEqual(set(shown.values()), {3}, shown)   # 8 found, 3 scored: the other 5 wait, in no place's count

    def test_digest_never_says_more_new_than_the_app_lists(self):
        with tempfile.TemporaryDirectory() as tmp, self.store_with(tmp, 40, 12) as db:
            new, total = header(digest.build_digest(db, seed=1, hide_unscored=True)[0][0])
            self.assertLessEqual(new, app_total(db))
            self.assertEqual(total, 12)

    def test_without_an_ai_unscored_jobs_still_show(self):
        with tempfile.TemporaryDirectory() as tmp, self.store_with(tmp, 4, 0) as db:
            self.assertEqual(header(digest.build_digest(db, seed=1)[0][0]), (4, 4))

    def test_new_means_added_since_the_last_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 60)
                for job in digest.eligible_jobs(db)[0]:
                    score.save(db, job, 'm', fit(80), 'p')
                self.assertEqual(header(digest.build_digest(db, seed=1)[0][0]), (60, 60))   # nothing sent yet
                db.execute("UPDATE jobs SET first_seen_at = '2021-01-01T00:00:00+00:00' WHERE id <= 35")
                db.execute("UPDATE jobs SET first_seen_at = '2019-01-01T00:00:00+00:00' WHERE id > 35")
                digest.mark_shown(db, [1], seed=1, now=__import__('datetime').datetime(2020, 1, 1, tzinfo=__import__('datetime').timezone.utc))
                self.assertEqual(header(digest.build_digest(db, seed=2)[0][0]), (35, 60))


if __name__ == '__main__':
    unittest.main()
