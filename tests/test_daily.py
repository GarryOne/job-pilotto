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
        self.assertIn('Tap a job number', message)
        self.assertIn('<b>SRE &lt;Platform&gt; &amp; Ops</b>', message)
        self.assertIn('href="https://example.test/jobs?id=1&amp;x=&quot;y&quot;"', message)
        self.assertIn('A&amp;B &lt;Labs&gt; · Zurich', message)
        self.assertNotIn('<blockquote>', message)
        self.assertIn('Hybrid', message)
        self.assertNotIn('<Labs>', message)

    def test_ranking_prefers_zurich_then_switzerland_then_berlin_london_dubai_remote(self):
        jobs = [{'title': 'Accountant', 'location': 'Toronto'},
                {'title': 'Site Reliability Engineer', 'location': 'London, UK'},
                {'title': 'Site Reliability Engineer', 'location': 'Geneva'},
                {'title': 'Site Reliability Engineer', 'location': 'Zürich', 'city': 'Zurich'},
                {'title': 'Site Reliability Engineer', 'location': 'Toronto'}]
        ranked = daily.rank_jobs(jobs, daily.random.Random(1))
        self.assertEqual([j['location'] for j in ranked], ['Zürich', 'Geneva', 'London, UK', 'Toronto', 'Toronto'])
        self.assertEqual(ranked[-1]['title'], 'Accountant')

    def test_pages_of_ten_continue_with_the_same_seed(self):
        report = {'jobs': [{'company': f'Company {i}', 'id': str(i), 'title': 'Site Reliability Engineer',
                            'location': 'Zurich', 'url': f'https://example.test/{i}'} for i in range(25)]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                pages = [daily.build_digest(db, page=p, seed=7) for p in (1, 2, 3, 4)]
        urls = []
        for messages, _, keyboards in pages[:3]:
            self.assertEqual(len(messages), 1)
            self.assertLessEqual(daily.visible_length(messages[0]), daily.TELEGRAM_LIMIT)
            urls += [u for u in daily.re.findall(r'href="([^"]+)"', messages[0])]
        self.assertEqual(len(urls), 25)
        self.assertEqual(len(set(urls)), 25)  # no job repeated across pages
        next_buttons = [row[0]['callback_data'] for _, _, kb in pages[:3] for row in kb[0]['inline_keyboard']
                        if row[0]['callback_data'].startswith('more:')]
        self.assertEqual(next_buttons, ['more:7:2', 'more:7:3'])
        self.assertIn('jobs 11–20 of 25', pages[1][0][0])
        self.assertIn('no more jobs', pages[3][0][0])

    def test_consecutive_digests_rotate_older_jobs(self):
        report = {'jobs': [{'company': f'Company {i}', 'id': str(i), 'title': 'Site Reliability Engineer',
                            'location': 'Zurich', 'url': f'https://example.test/{i}'} for i in range(25)]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                db.execute("UPDATE jobs SET last_seen_at = '2099-01-01T00:00:00+00:00'")  # none are new any more
                first_ids, second_ids, page2_ids = [], [], []
                daily.build_digest(db, seed=1, shown_ids=first_ids)
                daily.mark_shown(db, first_ids, seed=1)
                # Page 2 of the same digest ignores its own marks and continues the list.
                daily.build_digest(db, seed=1, page=2, shown_ids=page2_ids)
                daily.build_digest(db, seed=2, shown_ids=second_ids)
        self.assertEqual(len(first_ids), 10)
        self.assertFalse(set(first_ids) & set(second_ids))
        self.assertFalse(set(first_ids) & set(page2_ids))

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
