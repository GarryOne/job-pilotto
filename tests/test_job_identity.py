"""One job, many sources (src/store.py identity, same_job): the same posting from the employer's feed, jobs.ch, an aggregator and an alert
email is one job, listed and scored once; a copy with text gives it to a copy without."""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import store  # noqa: E402


def job(url, title='Senior DevOps Engineer (m/w/d) 80-100%', company='Acme AG', location='Zürich, Switzerland', description=''):
    return {'url': url, 'title': title, 'company': company, 'location': location, 'city': location.split(',')[0], 'description': description}


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = store.connect(Path(self.dir) / 'jobs.sqlite')

    def add(self, item, source):
        return store.upsert_job(self.db, item, source)

    def test_identity_ignores_legal_forms_gender_and_workload_marks(self):
        self.assertEqual(store.identity('Acme AG', 'Senior DevOps Engineer (m/w/d) 80-100%'), store.identity('ACME', 'Senior DevOps Engineer (all genders)'))
        self.assertEqual(store.identity('Acme Schweiz AG', 'DevOps Engineer m/f/d'), 'acme|devops engineer')
        self.assertNotEqual(store.identity('Acme', 'DevOps Engineer'), store.identity('Acme', 'Data Engineer'))
        self.assertEqual(store.identity('Unknown employer', 'DevOps Engineer'), '')

    def test_the_same_posting_from_a_second_source_is_merged_and_lends_its_text(self):
        first, status = self.add(job('https://www.linkedin.com/jobs/view/4012345678/', location='Zurich'), 'LinkedIn alert')
        self.assertEqual(status, 'new')
        second, status = self.add(job('https://jobs.lever.co/acme/123', description='Run our Kubernetes platform.'), 'Acme')
        self.assertEqual((second, status), (first, 'seen'))
        row = self.db.execute('SELECT COUNT(*) n, MAX(description) d, MAX(notes) notes FROM jobs').fetchone()
        self.assertEqual((row['n'], row['d']), (1, 'Run our Kubernetes platform.'))
        self.assertIn('also on Acme', row['notes'])

    def test_same_title_in_another_city_or_at_another_company_stays_separate(self):
        self.add(job('https://a.example/1'), 'A')
        _, other_city = self.add(job('https://b.example/2', location='Berlin, Germany'), 'B')
        _, other_company = self.add(job('https://c.example/3', company='Beta GmbH'), 'C')
        self.assertEqual((other_city, other_company), ('new', 'new'))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 3)

    def test_a_copy_without_a_city_matches_one_with_a_city(self):
        first, _ = self.add(job('https://a.example/1'), 'A')
        second, status = self.add(job('https://ch.indeed.com/viewjob?jk=0a1b2c3d4e', location=''), 'Indeed alert')
        self.assertEqual((second, status), (first, 'seen'))

    def test_two_postings_with_the_same_title_on_one_site_are_two_openings(self):
        self.add(job('https://jobs.lever.co/acme/1'), 'Acme')
        _, status = self.add(job('https://jobs.lever.co/acme/2'), 'Acme')
        self.assertEqual(status, 'new')

    def test_a_closed_job_is_not_a_twin(self):
        first, _ = self.add(job('https://a.example/1'), 'A')
        self.db.execute("UPDATE jobs SET state='closed' WHERE id=?", (first,))
        _, status = self.add(job('https://b.example/2'), 'B')
        self.assertEqual(status, 'new')

    def test_an_older_cache_gets_the_column(self):
        path = Path(self.dir) / 'old.sqlite'
        old = sqlite3.connect(path)
        old.executescript(store.SCHEMA)
        old.close()
        columns = {row['name'] for row in store.connect(path).execute('PRAGMA table_info(jobs)')}
        self.assertIn('identity', columns)


if __name__ == '__main__':
    unittest.main()
