"""Canary auto-promote decision (tools/canary_promote.py): age, CI state, reported problems, already stable."""
import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'canary_promote.py'
SPEC = importlib.util.spec_from_file_location('canary_promote', SCRIPT)
canary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(canary)

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)


def release(n, hours_ago, pre=True, latest=False, draft=False):
    at = datetime.fromtimestamp(NOW.timestamp() - hours_ago * 3600, timezone.utc).isoformat().replace('+00:00', 'Z')
    return {'tagName': f'desktop-v0.4.0-alpha.{n}', 'isPrerelease': pre, 'isLatest': latest, 'isDraft': draft,
            'publishedAt': at, 'createdAt': at}


GREEN = [{'status': 'completed', 'conclusion': 'success'}]


class Facts:
    def __init__(self, ci=GREEN, telemetry=(), fill=(), ext=None):
        self.ci, self.tel, self.fill, self.ext = ci, list(telemetry), list(fill), ext or {}

    def ci_runs(self, tag):
        return self.ci

    def telemetry(self):
        return self.tel

    def fill_failures(self):
        return self.fill

    def extension_version(self, tag):
        return self.ext.get(tag, '0.8.15')


STABLE = release(60, 100, pre=False, latest=True)


class CanaryPromoteTests(unittest.TestCase):
    def test_promotes_a_clean_build_older_than_48_hours(self):
        result = canary.decide([release(66, 2), release(65, 50), STABLE], NOW, Facts())
        self.assertTrue(result['promote'])
        self.assertEqual(result['tag'], 'desktop-v0.4.0-alpha.65')

    def test_waits_while_every_newer_build_is_under_48_hours(self):
        result = canary.decide([release(66, 2), release(65, 47), STABLE], NOW, Facts())
        self.assertFalse(result['promote'])
        self.assertIn('47 h', result['reasons'][0])

    def test_nothing_when_newest_is_already_stable(self):
        result = canary.decide([release(66, 60, pre=False, latest=True), release(65, 70)], NOW, Facts())
        self.assertFalse(result['promote'])
        self.assertIsNone(result['tag'])
        self.assertIn('nothing newer than stable', result['reasons'][0])

    def test_drafts_are_still_building(self):
        result = canary.decide([release(66, 60, draft=True), STABLE], NOW, Facts())
        self.assertFalse(result['promote'])

    def test_red_or_missing_ci_blocks(self):
        for ci in ([{'status': 'completed', 'conclusion': 'failure'}], [{'status': 'in_progress', 'conclusion': None}], []):
            result = canary.decide([release(65, 50), STABLE], NOW, Facts(ci=ci))
            self.assertFalse(result['promote'], ci)

    def test_a_telemetry_problem_in_the_candidate_blocks(self):
        issue = {'number': 7, 'title': 'App report: crash [t:abc]', 'state': 'CLOSED',
                 'body': 'versions 0.4.0-alpha.64', 'comments': [{'body': 'Back in a newer version. versions 0.4.0-alpha.65'}]}
        result = canary.decide([release(65, 50), STABLE], NOW, Facts(telemetry=[issue]))
        self.assertFalse(result['promote'])
        self.assertIn('#7', result['reasons'][-1])

    def test_a_problem_stable_already_has_is_not_new(self):
        issue = {'number': 8, 'title': 'App report: x', 'state': 'OPEN', 'body': 'Versions seen: 0.4.0-alpha.60,0.4.0-alpha.65'}
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(telemetry=[issue]))['promote'])

    def test_versions_match_whole(self):
        self.assertFalse(canary.mentions('versions 0.4.0-alpha.650', '0.4.0-alpha.65'))
        self.assertFalse(canary.mentions('0.4.0-alpha.6', '0.4.0-alpha.65'))
        self.assertTrue(canary.mentions('versions 0.4.0-alpha.64,0.4.0-alpha.65.', '0.4.0-alpha.65'))

    def test_fill_failures_count_only_when_the_extension_changed(self):
        issue = {'number': 9, 'title': 'Fill failure: acme · Name', 'state': 'OPEN', 'body': 'Extension version: `0.8.16`'}
        changed = {'desktop-v0.4.0-alpha.65': '0.8.16', 'desktop-v0.4.0-alpha.60': '0.8.15'}
        self.assertFalse(canary.decide([release(65, 50), STABLE], NOW, Facts(fill=[issue], ext=changed))['promote'])
        same = {'desktop-v0.4.0-alpha.65': '0.8.16', 'desktop-v0.4.0-alpha.60': '0.8.16'}
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(fill=[issue], ext=same))['promote'])

    def test_version_order(self):
        key = canary.version_key
        self.assertGreater(key('0.4.0-alpha.10'), key('0.4.0-alpha.9'))
        self.assertGreater(key('0.4.0'), key('0.4.0-alpha.99'))
        self.assertGreater(key('0.5.0-alpha.1'), key('0.4.0'))


if __name__ == '__main__':
    unittest.main()
