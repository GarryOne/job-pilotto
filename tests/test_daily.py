import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import daily
import job_store


class DigestFormatTests(unittest.TestCase):
    def test_digest_is_escaped_telegram_html(self):
        report = {'jobs': [{'company': 'A&B <Labs>', 'id': '1', 'title': 'SRE <Platform> & Ops',
                            'location': 'Zurich', 'work_mode': 'Hybrid (stated)',
                            'url': 'https://example.test/jobs?id=1&x="y"'}]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                message = daily.format_digest(db)
        self.assertIn('🆕 1 new', message)
        self.assertIn('Tap its ✅ number', message)
        self.assertIn('<b>SRE &lt;Platform&gt; &amp; Ops</b>', message)
        self.assertIn('href="https://example.test/jobs?id=1&amp;x=&quot;y&quot;"', message)
        self.assertIn('A&amp;B &lt;Labs&gt; · Zurich', message)
        self.assertNotIn('<blockquote>', message)
        self.assertIn('Hybrid', message)
        self.assertNotIn('<Labs>', message)

    def test_ranking_puts_swiss_sre_first(self):
        jobs = [{'title': 'Accountant', 'location': 'Toronto'},
                {'title': 'Site Reliability Engineer', 'location': 'Remote - Worldwide'},
                {'title': 'Software Engineer', 'location': 'Zürich', 'city': 'Zurich'},
                {'title': 'Senior SRE', 'location': 'Geneva'}]
        ranked = daily.rank_jobs(jobs, daily.random.Random(1))
        self.assertEqual([j['title'] for j in ranked],
                         ['Senior SRE', 'Software Engineer', 'Site Reliability Engineer', 'Accountant'])

    def test_long_digest_splits_under_telegram_limit(self):
        report = {'jobs': [{'company': f'Company {i}', 'id': str(i), 'title': 'Site Reliability Engineer ' + 'x' * 120,
                            'location': 'Zurich', 'url': f'https://example.test/{i}'} for i in range(50)]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                messages, new_count, keyboards = daily.build_digest(db, limit=50)
        self.assertEqual(new_count, 50)
        self.assertGreater(len(messages), 1)
        self.assertTrue(all(len(m) <= daily.TELEGRAM_LIMIT for m in messages))
        self.assertEqual(sum(m.count('https://example.test/') for m in messages), 50)
        self.assertIn(f'part 1/{len(messages)}', messages[0])

    def test_company_and_title_are_shortened(self):
        self.assertEqual(daily.short_company('Zürich Versicherungs-Gesellschaft AG / Zurich Insurance Company Ltd'),
                         'Zürich Versicherungs-Gesellschaft')
        self.assertEqual(daily.short_company('Consult & Pepper AG'), 'Consult & Pepper')
        self.assertEqual(daily.short_title('Senior Platform Engineer - Identity & Security (m/f/d) 80-100%'),
                         'Senior Platform Engineer - Identity & Security 80-100%')
        self.assertEqual(daily.short_title('Site Reliability Engineer (a)'), 'Site Reliability Engineer')
        self.assertEqual(daily.short_title('Software Development Engineer (all genders)'), 'Software Development Engineer')

    def test_unknown_work_mode_is_omitted(self):
        self.assertIsNone(daily._work_mode_badge('Not stated'))
        self.assertEqual(daily._work_mode_badge('Remote mentioned; verify conditions'), '🌍 Remote?')


if __name__ == '__main__':
    unittest.main()
