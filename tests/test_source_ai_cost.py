"""The AI that helps find sources counts in the run's AI cost and the monthly budget, and pauses with the other optional AI at 90%."""
import argparse
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import budget, cost  # noqa: E402
from src.notion import cron_runs  # noqa: E402


class SourceCostTests(unittest.TestCase):
    def setUp(self):
        cost.SIDE.clear()
        self.addCleanup(cost.SIDE.clear)

    def test_source_calls_add_up_and_count_in_the_runs_total(self):
        usage = SimpleNamespace(input_tokens=1_000_000, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        cost.side('claude-haiku-4-5', usage)
        cost.side('claude-haiku-4-5', usage)
        cost.side('claude-haiku-4-5', None)   # a fake model in tests: nothing counted
        self.assertEqual((cost.SIDE['done'], round(cost.SIDE['usd'], 2)), (2, 2.0))
        run = {'score': {'usd': 0.5}, 'sources': dict(cost.SIDE)}
        self.assertEqual(round(cron_runs.total_usd(run), 2), 2.5)

    def test_at_the_monthly_pause_source_reading_is_switched_off_too(self):
        args = argparse.Namespace(auto_kit_max=3, score_max=60, enrich_max=200)
        warnings = []
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_DISABLE': 'google_jobs'}):
            budget.apply_caps(args, {'level': 'pause', 'pct': 0.93}, warnings)
            off = os.environ['JOB_PILOTTO_DISABLE'].split(',')
        self.assertEqual(off, ['google_jobs', 'page_reader', 'job_alerts', 'scout_ai'])
        self.assertIn('AI source reading off', warnings[0])
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_DISABLE': ''}):
            self.assertFalse(budget.apply_caps(args, {'level': 'warn', 'pct': 0.75}, []))
            self.assertEqual(os.environ['JOB_PILOTTO_DISABLE'], '')


if __name__ == '__main__':
    unittest.main()
