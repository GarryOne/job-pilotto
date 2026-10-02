"""Canary auto-promote decision (tools/canary_promote.py): age, CI state, reported problems, already stable, and
positive usage evidence from app reports (silence is not health)."""
import importlib.util
import json
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'canary_promote.py'
FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'canary_builds.json'
SPEC = importlib.util.spec_from_file_location('canary_promote', SCRIPT)
canary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(canary)

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)


def release(n, hours_ago, pre=True, latest=False, draft=False):
    at = datetime.fromtimestamp(NOW.timestamp() - hours_ago * 3600, timezone.utc).isoformat().replace('+00:00', 'Z')
    return {'tagName': f'desktop-v0.5.0-alpha.{n}', 'isPrerelease': pre, 'isLatest': latest, 'isDraft': draft,
            'publishedAt': at, 'createdAt': at}


GREEN = [{'status': 'completed', 'conclusion': 'success'}]


def ago(hours):
    return datetime.fromtimestamp(NOW.timestamp() - hours * 3600, timezone.utc).isoformat().replace('+00:00', 'Z')


def evidence(installs=1, days=3, first=60, last=6, ok=12, failed=0, crash=0, run_failed=0):
    """One GET /telemetry/version entry: health lines from `first` to `last` hours ago."""
    return {'installs': installs, 'healthInstalls': installs, 'healthDays': days,
            'firstSeen': ago(first) if installs else None, 'lastSeen': ago(last) if installs else None,
            'healthFirst': ago(first) if installs else None, 'healthLast': ago(last) if installs else None,
            'runs': {'ok': ok, 'failed': failed, 'reports': days},
            'events': {'crash': crash, 'run_failed': run_failed, 'stuck': 0, 'form_issue': 0, 'health': days}}


HEALTHY = evidence()
STABLE_USAGE = evidence(installs=4, days=30, first=900, last=2, ok=200, failed=4)


class Facts:
    def __init__(self, ci=GREEN, telemetry=(), fill=(), ext=None, usage=HEALTHY, stable_usage=STABLE_USAGE, unavailable=None):
        self.ci, self.tel, self.fill, self.ext = ci, list(telemetry), list(fill), ext or {}
        self.usage_, self.stable_usage, self.unavailable = usage, stable_usage, unavailable

    def usage(self, version, stable_version):
        if self.unavailable:
            raise canary.EvidenceUnavailable(self.unavailable)
        return {version: self.usage_, **({stable_version: self.stable_usage} if self.stable_usage else {})}

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
        self.assertEqual(result['tag'], 'desktop-v0.5.0-alpha.65')

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
                 'body': 'versions 0.5.0-alpha.64', 'comments': [{'body': 'Back in a newer version. versions 0.5.0-alpha.65'}]}
        result = canary.decide([release(65, 50), STABLE], NOW, Facts(telemetry=[issue]))
        self.assertFalse(result['promote'])
        self.assertTrue(any('#7' in reason for reason in result['reasons']))

    def test_a_problem_stable_already_has_is_not_new(self):
        issue = {'number': 8, 'title': 'App report: x', 'state': 'OPEN', 'body': 'Versions seen: 0.5.0-alpha.60,0.5.0-alpha.65'}
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(telemetry=[issue]))['promote'])

    def test_versions_match_whole(self):
        self.assertFalse(canary.mentions('versions 0.5.0-alpha.650', '0.5.0-alpha.65'))
        self.assertFalse(canary.mentions('0.5.0-alpha.6', '0.5.0-alpha.65'))
        self.assertTrue(canary.mentions('versions 0.5.0-alpha.64,0.5.0-alpha.65.', '0.5.0-alpha.65'))

    def test_fill_failures_count_only_when_the_extension_changed(self):
        issue = {'number': 9, 'title': 'Fill failure: acme · Name', 'state': 'OPEN', 'body': 'Extension version: `0.8.16`'}
        changed = {'desktop-v0.5.0-alpha.65': '0.8.16', 'desktop-v0.5.0-alpha.60': '0.8.15'}
        self.assertFalse(canary.decide([release(65, 50), STABLE], NOW, Facts(fill=[issue], ext=changed))['promote'])
        same = {'desktop-v0.5.0-alpha.65': '0.8.16', 'desktop-v0.5.0-alpha.60': '0.8.16'}
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(fill=[issue], ext=same))['promote'])

    def wait_with(self, text, **facts):
        result = canary.decide([release(65, 50), STABLE], NOW, Facts(**facts))
        self.assertFalse(result['promote'], result['reasons'])
        self.assertTrue(any(text in reason for reason in result['reasons']), result['reasons'])
        return result

    def test_healthy_usage_promotes_and_shows_the_numbers(self):
        result = canary.decide([release(65, 50), STABLE], NOW, Facts())
        self.assertTrue(result['promote'], result['reasons'])
        self.assertTrue(any('runs 12 ok / 0 failed' in reason for reason in result['reasons']), result['reasons'])

    def test_an_unused_build_waits(self):
        self.wait_with('not used enough', usage=evidence(installs=0, days=0, ok=0))

    def test_reports_on_one_day_only_wait(self):
        self.wait_with('not used enough', usage=evidence(days=1, first=20, last=6))

    def test_two_days_but_under_48_hours_wait(self):
        self.wait_with('not used enough', usage=evidence(days=2, first=30, last=6))

    def test_too_few_successful_runs_wait(self):
        self.wait_with('too few successful runs', usage=evidence(ok=4))

    def test_a_crash_or_failed_run_waits(self):
        self.wait_with('1 crash', usage=evidence(crash=1))
        self.wait_with('1 run_failed', usage=evidence(run_failed=1))

    def test_a_worse_failure_rate_than_stable_waits(self):
        # stable 2 %, candidate 3 of 20 = 15 % > 7 %
        self.wait_with('failure rate 15%', usage=evidence(ok=17, failed=3))
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(ok=19, failed=1)))['promote'])

    def test_stable_without_data_uses_an_absolute_ceiling(self):
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(ok=19, failed=1), stable_usage=None))['promote'])
        self.wait_with('no stable baseline', usage=evidence(ok=17, failed=3), stable_usage=None)

    def test_stale_reports_wait(self):
        self.wait_with('not fresh', usage=evidence(first=90, last=30))

    def test_missing_key_or_unreachable_site_waits(self):
        self.wait_with('JOB_PILOTTO_TELEMETRY_KEY is not set', unavailable='JOB_PILOTTO_TELEMETRY_KEY is not set')
        with self.assertRaises(canary.EvidenceUnavailable):
            canary.GitHub(key=None).usage('0.5.0-alpha.65', '0.5.0-alpha.60')

    def test_the_canary_rule_matches_the_shared_fixture(self):
        # tests/fixtures/canary_builds.json is read by desktop/test/canary.test.js too: one rule, three users
        # (this script, tools/prune-releases.sh and the owner's app).
        for case in json.loads(FIXTURE.read_text())['cases']:
            found = canary.canary_of(case['releases'], canary.parse_time(case['now']), floor=case.get('floor', ''))
            self.assertEqual(found and found['tagName'], case['canary'], case['name'])

    def test_the_candidate_is_the_canary_not_the_newest_aged_build(self):
        result = canary.decide([release(67, 60), release(66, 70), STABLE], NOW, Facts())
        self.assertEqual(result['tag'], 'desktop-v0.5.0-alpha.66')

    def test_a_canary_that_failed_for_sure_is_dropped(self):
        red = [{'status': 'completed', 'conclusion': 'failure'}]
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(ci=red))['blocked'])
        self.assertTrue(canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(crash=1)))['blocked'])
        waiting = canary.decide([release(65, 50), STABLE], NOW, Facts(usage=evidence(days=1, first=20, last=6)))
        self.assertFalse(waiting['blocked'])  # not proven yet is not failed: keep trialling it
        running = [{'status': 'in_progress', 'conclusion': None}]
        self.assertFalse(canary.decide([release(65, 50), STABLE], NOW, Facts(ci=running))['blocked'])

    def test_canary_flag_prints_the_tag_for_prune_releases(self):
        case = json.loads(FIXTURE.read_text())['cases'][0]
        releases = [dict(r, createdAt=datetime.now(timezone.utc).isoformat()) for r in case['releases']]
        out = subprocess.run([sys.executable, str(SCRIPT), '--canary'], input=json.dumps(releases),
                             capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(out, 'desktop-v0.5.0-alpha.65')

    def test_version_order(self):
        key = canary.version_key
        self.assertGreater(key('0.5.0-alpha.10'), key('0.5.0-alpha.9'))
        self.assertGreater(key('0.4.0'), key('0.4.0-alpha.99'))
        self.assertGreater(key('0.5.0-alpha.1'), key('0.4.0'))


class CanaryFloorParityTest(unittest.TestCase):
    def test_python_and_app_use_the_same_floor(self):
        js = (Path(__file__).resolve().parents[1] / 'desktop' / 'lib' / 'canary.js').read_text()
        self.assertIn(f"export const CANARY_FLOOR = '{canary.CANARY_FLOOR}';", js)



class PromotesWithoutStartingARun(unittest.TestCase):
    def test_the_promotion_may_not_start_an_end_to_end_run(self):
        # release-stable.sh starts one by default and waits ~15 minutes; this job has 10 minutes and cannot start workflows.
        from unittest import mock
        decision = {'promote': True, 'tag': 'desktop-v0.4.0-alpha.9', 'stable': 'desktop-v0.4.0-alpha.8', 'reasons': []}
        with mock.patch.object(canary, 'GitHub'), mock.patch.object(canary, 'decide', return_value=decision), \
                mock.patch.object(canary.subprocess, 'run') as ran, mock.patch('builtins.print'):
            canary.main([])
        self.assertEqual(ran.call_args.kwargs['env']['E2E_NO_START'], '1')
        self.assertEqual(ran.call_args.args[0][1], 'desktop-v0.4.0-alpha.9')


if __name__ == '__main__':
    unittest.main()
