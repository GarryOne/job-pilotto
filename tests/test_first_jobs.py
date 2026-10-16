"""A new user's first jobs come in seconds (spec docs/superpowers/specs/2026-10-16-first-jobs-fast.md): a small slice of fast feeds is read and
3 jobs are scored first, the first one is saved and synced the moment it is scored; the rest of the search is unchanged."""
import unittest
from unittest import mock

from src import first_jobs
from src.daily_args import build_parser


def feed(company, ats='greenhouse', **kw):
    return {'company': company, 'ats': ats, 'slug': company.lower(), **kw}


class PickTests(unittest.TestCase):
    def test_fast_json_feeds_come_first_then_the_index_order(self):
        feeds = [feed('Slow', 'careers'), feed('A', 'workday'), feed('B', 'lever'), feed('C', 'greenhouse'), feed('D', 'visit')]
        names = [source['company'] for source in first_jobs.pick(feeds, 3)]
        self.assertEqual(set(names[:2]), {'B', 'C'}, 'lever and greenhouse first')
        self.assertNotIn('D', names, 'a page read in Chrome is not a first-slice feed')

    def test_the_slice_is_at_most_the_size_asked(self):
        feeds = [feed(f'Co{i}') for i in range(40)]
        self.assertEqual(len(first_jobs.pick(feeds, 15)), 15)
        self.assertEqual(len(first_jobs.pick(feeds[:4], 15)), 4)


class RunTests(unittest.TestCase):
    def run_slice(self, scored=3, calls=None):
        calls = calls if calls is not None else []
        jobs = [{'id': str(i), 'title': 'Engineer', 'company': 'A', 'location': 'Zurich', 'url': f'https://x/{i}'} for i in range(5)]
        report = {'jobs': jobs, 'sources': []}

        def fake_score(db, candidates, profile, model, max_jobs, workers=5, stats=None, on_scored=None, every=10, only_ids=None, **kw):
            calls.append(('score', sorted(only_ids), workers, every))
            for _ in range(scored):
                on_scored()
            stats.update(done=scored)
            return 'Scored'
        synced = []
        said = []
        with mock.patch.object(first_jobs.store, 'import_watch_report', return_value=['new'] * 5), \
                mock.patch.object(first_jobs.score, 'queue', return_value=jobs), mock.patch.object(first_jobs, 'to_score', return_value=jobs):
            count = first_jobs.run(mock.MagicMock(), mock.MagicMock(), [feed('A')], profile='p', hidden=frozenset(), sync=lambda: synced.append(1), say=said.append,
                                   scan=lambda sources, feed_db: report, scorer=fake_score)
        return count, calls, synced, said

    def test_three_jobs_are_scored_at_once_and_each_save_is_synced(self):
        count, calls, synced, said = self.run_slice()
        self.assertEqual(calls, [('score', ['0', '1', '2'], 3, 1)], 'the first 3 jobs, 3 at a time, a sync after every score')
        self.assertEqual(len(synced), 3)
        self.assertEqual(count, 3)
        self.assertTrue(any(line.startswith('First jobs:') for line in said), 'the log says it, the app shows it')

    def test_no_job_found_scores_nothing(self):
        with mock.patch.object(first_jobs.store, 'import_watch_report', return_value=[]), \
                mock.patch.object(first_jobs.score, 'queue', return_value=[]), mock.patch.object(first_jobs, 'to_score', return_value=[]):
            scorer = mock.Mock()
            self.assertEqual(first_jobs.run(mock.MagicMock(), mock.MagicMock(), [feed('A')], profile='p', hidden=frozenset(), sync=lambda: None, say=lambda _: None,
                                            scan=lambda sources, feed_db: {'jobs': [], 'sources': []}, scorer=scorer), 0)
            scorer.assert_not_called()


class ScenarioTests(unittest.TestCase):
    def test_the_first_job_is_in_the_store_and_listed_before_the_batch_ends(self):
        # A new user presses Find jobs: the first score is saved and the list shows it while the other two are still being scored.
        import tempfile
        from pathlib import Path
        from src import desktop_jobs, digest, store as job_store
        from tests.test_score import ModelClient
        from src.ai import score as real_score
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            report = {'jobs': [{'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich', 'url': f'https://x.test/{i}',
                                'description': 'Kubernetes, Terraform, Datadog.', 'status': 'new'} for i in range(5)], 'sources': []}
            seen = []

            def sync():   # what the app's list reads at the moment of each save
                listed = desktop_jobs.jobs(db, hide_unscored=False)['jobs']
                seen.append((sum(1 for job in listed if job.get('fit') is not None), len(listed)))

            def scorer(db_, candidates, profile, model, max_jobs, **kw):
                return real_score.run(db_, candidates, profile, model, max_jobs, client=ModelClient({'m': lambda title: 70}), **kw)
            scored = first_jobs.run(db, None, [feed('Example')], profile='Profile v1', hidden=frozenset(), sync=sync, say=lambda _: None,
                                    scan=lambda sources, feed_db: report, scorer=scorer, model='m')
            self.assertEqual(scored, 3)
            self.assertEqual(seen[0], (1, 5), 'at the first save: 1 scored, all 5 found are listed (the others say Scoring…)')
            self.assertEqual(len(seen), 3)
            self.assertEqual(len(real_score.load(db)), 3, 'the other two wait for the full search: a batch, never more AI calls')


class WiringTests(unittest.TestCase):
    def test_the_flag_exists(self):
        self.assertTrue(build_parser('x').parse_args(['--first-jobs']).first_jobs)
        self.assertFalse(build_parser('x').parse_args([]).first_jobs)

    def test_the_search_runs_the_slice_before_the_full_crawl(self):
        source = open('src/daily_search.py').read()
        self.assertIn('first_jobs.run(', source)
        self.assertLess(source.index('first_jobs.run('), source.index('report = feeds.scan(feed_list, feed_db)'))

    def test_a_first_run_lists_the_jobs_still_waiting_for_a_score(self):
        import sqlite3
        from src import desktop
        row = {'id': 1, 'url': 'https://x/1', 'title': 'Vendeur', 'company': 'Coop', 'location': 'Lausanne', 'work_mode': '', 'notes': '',
               'application_status': 'unreviewed', 'first_seen_at': '2026-10-07'}
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=([row], [])), mock.patch.object(desktop.score, 'load', return_value={}):
            hidden = desktop.jobs(sqlite3.connect(':memory:'), notion_jobs=[], hide_unscored=True)
            shown = desktop.jobs(sqlite3.connect(':memory:'), notion_jobs=[], hide_unscored=False)
        self.assertEqual((len(hidden['jobs']), hidden['waiting']), (0, 1))
        self.assertEqual((len(shown['jobs']), shown['waiting']), (1, 0))
        self.assertIsNone(shown['jobs'][0]['score'] if 'score' in shown['jobs'][0] else None, 'no score yet: the window says Scoring…')

    def test_the_jobs_command_takes_first_run(self):
        source = open('src/desktop.py').read()
        self.assertIn("--first-run", source)
        self.assertIn('hide_unscored=ai_engine.ready() and not args.first_run', source)


if __name__ == '__main__':
    unittest.main()
