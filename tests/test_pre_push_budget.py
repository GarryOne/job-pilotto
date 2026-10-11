"""tools/pre-push-check.sh (3 of 3): the one-minute budget: a heavy step deferred to CI at the watchdog, JP_GATE_FULL=1, the SLOW summary. Fixture: pre_push_fixture.py."""
import unittest
import shutil
import time
from pathlib import Path

from tests.pre_push_fixture import *   # noqa: F401,F403 (the fixture: setUp, hook, commit, ...)
from tests.pre_push_fixture import PrePushFixture


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PrePushCheckTest(PrePushFixture):
    def test_a_heavy_step_still_running_at_the_budget_is_deferred_to_ci_not_failed(self):
        # owner, 11 Oct 2026: every local check before a push takes under 60 s; a heavy step still running at ~55 s is "deferred to CI", never failed, never dropped
        self.slow_suite(8, whole=True)
        began = time.monotonic()
        code, err = self.hook('git push origin HEAD:main', JP_GATE_BUDGET='2')
        self.assertEqual(code, 0, err)
        self.assertLess(time.monotonic() - began, 7, 'the hook did not wait the suite out')
        self.assertIn('DEFERRED TO CI', err)
        self.assertIn('(clean checkout)', err.split('DEFERRED TO CI')[1], 'it names what was deferred')

    def test_jp_gate_full_waits_the_suite_out_and_blocks_on_its_failure(self):
        self.slow_suite(4, whole=True)
        began = time.monotonic()
        code, err = self.hook('git push origin HEAD:main', JP_GATE_BUDGET='1', JP_GATE_FULL='1')
        self.assertEqual(code, 0, err)
        self.assertGreaterEqual(time.monotonic() - began, 4, 'JP_GATE_FULL=1 runs the old full run: no watchdog')
        self.assertNotIn('DEFERRED TO CI', err)

    def test_a_push_over_the_budget_is_listed_in_the_summary(self):
        shutil.copy(ROOT / 'tools' / 'gate-timing.sh', self.repo / 'tools' / 'gate-timing.sh')
        self.slow_suite(3)
        code, err = self.hook('git push origin HEAD:main', JP_GATE_BUDGET='60', JP_GATE_SLOW_AFTER='2')
        self.assertEqual(code, 0, err)
        self.assertIn('over the 2 s budget', err)


if __name__ == '__main__':
    unittest.main()
