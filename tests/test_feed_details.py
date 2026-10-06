"""SmartRecruiters lists postings without a description: the scan fetches it for the jobs it keeps, so they get
stage 1 facts and a fit score (Canva's and Delivery Hero's jobs had stayed unscored)."""
import sqlite3
import unittest

from src.sources import feeds


class FeedDetailsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')

    def test_description_fetched_for_kept_jobs_only(self):
        jobs = [{'id': '1', 'title': 'Site Reliability Engineer', 'location': 'Zurich, ch', 'url': 'https://x/1', 'description': '', 'remote': False},
                {'id': '2', 'title': 'Pastry Chef', 'location': 'Zurich, ch', 'url': 'https://x/2', 'description': '', 'remote': False},
                {'id': '3', 'title': 'Platform Engineer', 'location': 'Zurich, ch', 'url': 'https://x/3', 'description': '', 'remote': False}]
        asked = []

        def detail(slug, job_id):
            asked.append((slug, job_id))
            if job_id == '3':
                raise TimeoutError('slow')
            return f'The {job_id} job: Kubernetes, on-call.'

        source = {'company': 'Canva', 'ats': 'smartrecruiters', 'slug': 'canva'}
        report = feeds.scan([source], self.db, fetcher=lambda s: jobs, details={'smartrecruiters': detail})
        kept = {job['id']: job['description'] for job in report['jobs']}
        self.assertNotIn('2', kept)  # filtered out: no detail fetched for it
        self.assertEqual(kept['1'], 'The 1 job: Kubernetes, on-call.')
        self.assertEqual(kept['3'], '')  # its fetch failed; the job is still kept
        self.assertEqual(sorted(asked), [('canva', '1'), ('canva', '3')])


if __name__ == '__main__':
    unittest.main()


class DescriptionBackfillTest(unittest.TestCase):
    def test_missing_descriptions_are_fetched_again_each_run(self):
        from datetime import datetime, timedelta, timezone
        from src.sources import describe
        db = sqlite3.connect(':memory:')
        db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, state TEXT, description TEXT, first_seen_at TEXT)")
        now = datetime.now(timezone.utc)
        recent, old = now.isoformat(timespec='seconds'), (now - timedelta(days=30)).isoformat(timespec='seconds')
        db.executemany('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)', [
            (1, 'https://jobs.smartrecruiters.com/canva/1', 'open', '', recent),
            (2, 'https://www.jobs.ch/en/vacancies/detail/2/', 'open', None, recent),
            (3, 'https://x/3', 'open', 'Already here', recent),
            (4, 'https://x/4', 'closed', '', recent),
            (5, 'https://x/5', 'open', '', old)])
        import urllib.error
        gone = urllib.error.HTTPError('https://x', 404, 'Not Found', {}, None)
        db.execute("INSERT INTO jobs VALUES (6, 'https://www.jobs.ch/en/vacancies/detail/6/', 'open', '', ?)", (recent,))
        pages = {'https://jobs.smartrecruiters.com/canva/1': 'Run Kubernetes.', 'https://www.jobs.ch/en/vacancies/detail/2/': TimeoutError('slow'),
                 'https://www.jobs.ch/en/vacancies/detail/6/': gone}

        def fetcher(url):
            answer = pages[url]
            if isinstance(answer, Exception):
                raise answer
            return answer

        self.assertEqual(describe.backfill(db, fetcher=fetcher), 'Descriptions: 1 of 3 missing fetched, 1 posting(s) taken down (closed), 1 failed')
        self.assertEqual(db.execute('SELECT state FROM jobs WHERE id=6').fetchone()[0], 'closed')
        self.assertEqual(db.execute('SELECT description FROM jobs WHERE id=1').fetchone()[0], 'Run Kubernetes.')
        self.assertEqual(describe.SMARTRECRUITERS.search('https://jobs.smartrecruiters.com/canva/6000000001379105').groups(),
                         ('canva', '6000000001379105'))


class TechTreeDescriptionTest(unittest.TestCase):
    """TechTree's list page has no posting text, so every TechTree job came without one and stayed unscored ("–", 6 Oct 2026)."""

    PAGE = ('<html><nav class="menu">All jobs About us</nav><div class="mt-3"><div class="mt-12 prose prose-base max-w-none">'
            '<h2>About the company</h2><p>We run <b>warehouses</b> &amp; retail.</p><div><ul><li>Lead sales</li><li>Travel<br>often</li></ul></div>'
            '</div><footer>© TechTree</footer></div></html>')

    def test_the_posting_text_is_read_from_its_page(self):
        from src.sources import describe
        self.assertEqual(describe.techtree_text(self.PAGE), 'About the company We run warehouses & retail. Lead sales Travel often')
        self.assertEqual(describe.techtree_text('<p>no prose block</p>'), '')

        class Pages:
            def get(self, url):
                return {'html': TechTreeDescriptionTest.PAGE}
        self.assertTrue(describe.fetch('https://jobs.techtree.dev/job/c5ee88e9', client=Pages()).startswith('About the company'))

    def test_a_site_without_a_reader_is_named_in_the_run_log(self):
        from datetime import datetime, timezone
        from unittest import mock
        from src.sources import describe
        db = sqlite3.connect(':memory:')
        db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, state TEXT, description TEXT, first_seen_at TEXT)")
        now = datetime.now(timezone.utc).isoformat(timespec='seconds')
        db.executemany('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)', [(1, 'https://jobs.techtree.dev/job/1', 'open', '', now),
                                                                   (2, 'https://careers.example.com/job/2', 'open', '', now)])
        with mock.patch.object(describe.boards, 'Client') as client:
            client.return_value.get.return_value = {'html': self.PAGE}
            line = describe.backfill(db)
        self.assertEqual(line, "Descriptions: 1 of 2 missing fetched, 1 can't be read from careers.example.com")
        self.assertTrue(db.execute('SELECT description FROM jobs WHERE id=1').fetchone()[0].startswith('About the company'))
