"""The scoring cost experiment (tools/score_eval.py): its arithmetic must be right, because decisions rest on it."""
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

spec = importlib.util.spec_from_file_location('score_eval', Path(__file__).resolve().parents[1] / 'tools' / 'score_eval.py')
score_eval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score_eval)


class MeasureTest(unittest.TestCase):
    def test_spearman_is_one_for_the_same_order_and_minus_one_for_the_reverse(self):
        self.assertAlmostEqual(score_eval.spearman([10, 20, 30, 40], [1, 5, 9, 90]), 1.0)
        self.assertAlmostEqual(score_eval.spearman([10, 20, 30, 40], [9, 7, 5, 1]), -1.0)
        self.assertIsNone(score_eval.spearman([1, 2], [1, 2]))            # too few to say
        self.assertIsNone(score_eval.spearman([5, 5, 5], [1, 2, 3]))      # no spread
        self.assertEqual(score_eval.ranks([5, 5, 1]), [2.5, 2.5, 1.0])    # ties share a rank

    def test_compare_counts_the_jobs_that_cross_a_threshold_the_app_acts_on(self):
        result = score_eval.compare([45, 55, 65, 75, 85], [55, 55, 60, 70, 90])
        self.assertEqual(result['n'], 5)
        self.assertAlmostEqual(result['mean_abs_diff'], 5.0)
        self.assertAlmostEqual(result['bias'], 1.0)
        self.assertAlmostEqual(result['flips']['50'], 1 / 5)    # 45 -> 55 crosses 50
        self.assertAlmostEqual(result['flips']['60'], 0.0)
        self.assertAlmostEqual(result['flips']['70'], 0.0)      # 75 -> 70 stays at or above
        self.assertAlmostEqual(result['flips']['80'], 0.0)

    def test_cascade_reports_what_is_sent_on_what_is_missed_and_what_it_costs(self):
        base = [20, 45, 55, 72, 90, 85]
        cheap = [10, 30, 52, 40, 80, 70]     # misses the 72 below a bar of 45
        table = {row['bar']: row for row in score_eval.cascade(base, cheap, cost_cheap=0.005, cost_main=0.02)}
        self.assertAlmostEqual(table[50]['escalated'], 3 / 6)                       # 52, 80, 70
        self.assertAlmostEqual(table[50]['cost_vs_main'], (0.005 + 0.5 * 0.02) / 0.02)
        self.assertAlmostEqual(table[50]['kept_70'], 2 / 3)                          # of 72, 90, 85 the cheap pass lets 90 and 85 through
        self.assertAlmostEqual(table[30]['kept_70'], 1.0)                            # 72 scored 40 >= 30: all three get through
        self.assertIsNone(score_eval.cascade([10, 20], [10, 20], 1, 1)[0]['kept_80'])   # nobody rated >= 80

    def test_the_sample_covers_every_score_band_and_is_repeatable(self):
        rows = [{'id': i, 'base': b} for i, b in enumerate([10] * 30 + [50] * 30 + [70] * 30 + [90] * 30)]
        first = score_eval.stratified_sample(rows, 40, seed=3)
        self.assertEqual(len(first), 40)
        self.assertEqual({row['base'] for row in first}, {10, 50, 70, 90})
        self.assertEqual([r['id'] for r in first], [r['id'] for r in score_eval.stratified_sample(rows, 40, seed=3)])
        self.assertLessEqual(len(score_eval.stratified_sample(rows[:5], 40)), 5)

    def test_the_estimate_is_small_and_grows_with_the_sample(self):
        small, big = score_eval.estimate(30, ['haiku']), score_eval.estimate(60, ['haiku', 'sonnet-low', 'repeat'])
        self.assertLess(small, 0.5)
        self.assertGreater(big, small)
        self.assertLess(big, 3.0)


class RunTest(unittest.TestCase):
    """The whole run against a temporary database and a pretend model: what failed in real life (a wrong import) must not cost money again."""
    def test_a_full_run_compares_every_variant_and_prints_the_cascade(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from src import store as job_store
        from src.ai import score as score_module
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'jobs.sqlite'
            with job_store.connect(db_path) as db:
                job_store.import_watch_report(db, {'jobs': [{'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich', 'url': f'https://x.test/{i}',
                                                              'description': 'Kubernetes, Terraform.'} for i in range(24)]})
                db.execute("UPDATE jobs SET last_seen_at = '2099-01-01T00:00:00+00:00'")
                db.executescript(score_module.SCORES_TABLE)
                for row in db.execute('SELECT id FROM jobs').fetchall():
                    db.execute("INSERT INTO scores (job_id, scorer_version, input_hash, model, created_at, data_json) VALUES (?, 2, 'h', 'claude-sonnet-5-5', 'now', ?)",
                               (row['id'], json.dumps({'score': 10 + row['id'] * 3})))
                db.commit()

            class Client:
                def __init__(self):
                    self.messages = self

                def create(self, **params):
                    value = 20 + len(params['messages'][0]['content']) % 60
                    data = {'score': value, 'tier': 'B', 'reason': 'r', 'components': {'role_fit': value, 'location': 50, 'compensation': 50, 'growth': 50, 'risk': 20},
                            'strengths': ['a'], 'gaps': ['b'], 'confidence': 'medium'}
                    return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(data))],
                                           usage=SimpleNamespace(input_tokens=1000, output_tokens=200, cache_read_input_tokens=0))

            out = Path(tmp) / 'out.json'
            real_connect = job_store.connect
            with mock.patch('src.ai.engine.client', return_value=Client()), \
                    mock.patch('src.paths.local_profile', return_value='# Profile\nSRE, Kubernetes.'), \
                    mock.patch('src.paths.JOBS_DB', db_path), \
                    mock.patch('src.store.connect', lambda path: real_connect(db_path)):
                buffer = io.StringIO()
                with redirect_stdout(buffer):
                    code = score_eval.main(['--yes', '--sample', '12', '--out', str(out)])
            text = buffer.getvalue()
            self.assertEqual(code, 0, text)
            report = json.loads(out.read_text())
            self.assertEqual(set(report['variants']), {'haiku', 'sonnet-low', 'repeat'})
            self.assertEqual(report['variants']['repeat']['jobs'], 4)          # the noise floor uses a third of the sample
            self.assertGreater(report['variants']['haiku']['usd'], 0)
            self.assertEqual([row['bar'] for row in report['cascade']], list(score_eval.BARS))
            self.assertIn('Cascade (cheap pass first', text)

    def test_without_any_profile_it_stops_before_calling_the_api(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from src import store as job_store
        from src.ai import score as score_module
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'jobs.sqlite'
            with job_store.connect(db_path) as db:
                job_store.import_watch_report(db, {'jobs': [{'company': 'E', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich', 'url': f'https://x.test/{i}', 'description': 'd'} for i in range(14)]})
                db.executescript(score_module.SCORES_TABLE)
                for row in db.execute('SELECT id FROM jobs').fetchall():
                    db.execute("INSERT INTO scores (job_id, scorer_version, input_hash, model, created_at, data_json) VALUES (?, 2, 'h', 'm', 'now', ?)", (row['id'], json.dumps({'score': 50})))
                db.commit()
            real_connect = job_store.connect
            boom = mock.Mock(side_effect=AssertionError('the API must not be called'))
            with mock.patch('src.ai.engine.client', boom), mock.patch('src.paths.local_profile', return_value=''), mock.patch('src.notion.client.Tracker.from_env', return_value=None), \
                    mock.patch('src.store.connect', lambda path: real_connect(db_path)):
                buffer = io.StringIO()
                with redirect_stdout(buffer):
                    self.assertEqual(score_eval.main(['--yes', '--sample', '12']), 1)
            self.assertIn('No Profile text', buffer.getvalue())

    def test_nothing_is_called_without_yes(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            self.assertEqual(score_eval.main(['--sample', '30']), 0)
        self.assertIn('Nothing was called', buffer.getvalue())


if __name__ == '__main__':
    unittest.main()
