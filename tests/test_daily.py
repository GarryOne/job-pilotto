import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import daily, digest
from src import store as job_store


class DigestFormatTests(unittest.TestCase):
    def test_digest_is_escaped_telegram_html(self):
        report = {'jobs': [{'company': 'A&B <Labs>', 'id': '1', 'title': 'SRE <Platform> & Ops',
                            'location': 'Zurich', 'work_mode': 'Hybrid (stated)',
                            'url': 'https://example.test/jobs?id=1&x="y"'}]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                message = digest.format_digest(db)
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
        ranked = digest.rank_jobs(jobs, digest.random.Random(1))
        self.assertEqual([j['location'] for j in ranked], ['Zürich', 'Geneva', 'London, UK', 'Toronto', 'Toronto'])
        self.assertEqual(ranked[-1]['title'], 'Accountant')

    def test_pages_of_ten_continue_with_the_same_seed(self):
        report = {'jobs': [{'company': f'Company {i}', 'id': str(i), 'title': 'Site Reliability Engineer',
                            'location': 'Zurich', 'url': f'https://example.test/{i}'} for i in range(25)]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                pages = [digest.build_digest(db, page=p, seed=7) for p in (1, 2, 3, 4)]
        urls = []
        for messages, _, keyboards in pages[:3]:
            self.assertEqual(len(messages), 1)
            self.assertLessEqual(digest.visible_length(messages[0]), digest.TELEGRAM_LIMIT)
            urls += [u for u in digest.re.findall(r'href="([^"]+)"', messages[0])]
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
                digest.build_digest(db, seed=1, shown_ids=first_ids)
                digest.mark_shown(db, first_ids, seed=1)
                # Page 2 of the same digest ignores its own marks and continues the list.
                digest.build_digest(db, seed=1, page=2, shown_ids=page2_ids)
                digest.build_digest(db, seed=2, shown_ids=second_ids)
        self.assertEqual(len(first_ids), 10)
        self.assertFalse(set(first_ids) & set(second_ids))
        self.assertFalse(set(first_ids) & set(page2_ids))

    def test_company_and_title_are_shortened(self):
        self.assertEqual(digest.short_company('Zürich Versicherungs-Gesellschaft AG / Zurich Insurance Company Ltd'),
                         'Zürich Versicherungs-Gesellschaft')
        self.assertEqual(digest.short_company('Consult & Pepper AG'), 'Consult & Pepper')
        self.assertEqual(digest.short_title('Senior Platform Engineer - Identity & Security (m/f/d) 80-100%'),
                         'Senior Platform Engineer - Identity & Security 80-100%')
        self.assertEqual(digest.short_title('Site Reliability Engineer (a)'), 'Site Reliability Engineer')
        self.assertEqual(digest.short_title('Software Development Engineer (all genders)'), 'Software Development Engineer')

    def test_unknown_work_mode_is_omitted(self):
        self.assertIsNone(digest._work_mode_badge('Not stated'))
        self.assertEqual(digest._work_mode_badge('Remote mentioned; verify conditions'), '🌍 Remote?')


class DigestNoteTests(unittest.TestCase):
    def test_the_app_is_not_told_to_use_a_terminal(self):
        # 2 Oct 2026 (activity e2e suite): "Send today's matches" without Telegram showed "(terminal: set TELEGRAM_BOT_TOKEN…" in the app's Recent activity.
        app = daily.digest_note(3, 1, terminal=False)
        self.assertEqual(app, "Digest ready: 3 jobs, 1 new. Telegram isn't connected, so nothing was sent.")
        self.assertNotIn('terminal', app)
        self.assertIn('--send', daily.digest_note(3, 1, terminal=True))


class InsightLimitTests(unittest.TestCase):
    def test_an_insight_paused_by_the_spend_limit_is_a_run_with_a_warning_not_a_failure(self):
        # 2 Oct 2026 (activity e2e suite): the run exited 0 without closing its row; the end-of-process guard then wrote it as Failed ("Insight failed") under a
        # Completed pill. It is closed here, as a warning that names the limit.
        import contextlib
        import io
        from unittest import mock
        logged = []
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(daily.notion.Tracker, 'from_env', return_value=object()), \
                mock.patch.object(daily.insights, 'run', side_effect=RuntimeError('Your credit balance is too low to access the Anthropic API.')), \
                mock.patch.object(daily.cron_runs, 'log_run', side_effect=lambda tracker, run, failed=False: logged.append((dict(run), failed)) or 'https://notion.so/row'), \
                mock.patch.object(daily.telegram, 'to_app'), mock.patch.object(sys, 'argv', ['daily', '--mode', 'insight', '--log-run', '--db', str(Path(tmp) / 'jobs.sqlite')]), \
                contextlib.redirect_stdout(out):
            code = daily.main()
        self.assertEqual(code, 0)
        self.assertEqual(len(logged), 1, out.getvalue())
        run, failed = logged[0]
        self.assertFalse(failed)
        self.assertTrue(any('AI limit reached' in warning for warning in run['warnings']), run['warnings'])
        self.assertTrue(any(line.startswith('AI limit reached') for line in out.getvalue().splitlines()))


if __name__ == '__main__':
    unittest.main()
