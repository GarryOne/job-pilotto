"""tools/sync_release_labels.py: what each release is called, and the pinned issue's table."""
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('sync_release_labels', Path(__file__).resolve().parents[1] / 'tools' / 'sync_release_labels.py')
labels = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(labels)


def release(n, **kw):
    return {'name': f'0.5.{n} · 2 Oct', 'tagName': f'desktop-v0.5.{n}', 'isPrerelease': True, 'isLatest': False, **kw}


class TitleTests(unittest.TestCase):
    def test_each_state_gets_its_prefix(self):
        self.assertEqual(labels.desired_title(release(252, isPrerelease=False, isLatest=True), False), '✅ STABLE · 0.5.252 · 2 Oct')
        self.assertEqual(labels.desired_title(release(249, isPrerelease=False), False), '📦 Previous stable · 0.5.249 · 2 Oct')
        self.assertEqual(labels.desired_title(release(253), True), '🧪 BETA (release candidate) · 0.5.253 · 2 Oct')
        self.assertEqual(labels.desired_title(release(254), False), '🔨 Build · 0.5.254 · 2 Oct')

    def test_a_prefix_is_replaced_not_stacked_and_a_title_without_one_is_kept_whole(self):
        old = release(253, name='🔨 Build · 0.5.253 · 2 Oct')
        self.assertEqual(labels.desired_title(old, True), '🧪 BETA (release candidate) · 0.5.253 · 2 Oct')
        again = release(253, name=labels.desired_title(old, True))
        self.assertEqual(labels.desired_title(again, True), again['name'], 'idempotent: nothing to edit the second time')

    def test_the_latest_flag_wins_over_the_prerelease_flag(self):
        self.assertEqual(labels.state_of(release(1, isLatest=True), True), 'stable')


class BodyTests(unittest.TestCase):
    def test_the_pinned_issue_names_stable_beta_previous_and_the_newest_builds(self):
        rels = [release(256), release(255), release(254), release(253), release(252, isPrerelease=False, isLatest=True), release(249, isPrerelease=False)]
        body = labels.channels_body(rels, {'desktop-v0.5.253'})
        self.assertIn('releases/tag/desktop-v0.5.252)', body.split('Beta')[0])
        self.assertRegex(body, r'Beta \(release candidate\)\*\* \| \[0\.5\.253')
        self.assertRegex(body, r'Previous stable\*\* \| \[0\.5\.249')
        self.assertIn('0.5.256', body)
        self.assertIn('0.5.254', body)
        self.assertNotIn('0.5.249 · 2 Oct](https://github.com/GarryOne/job-pilotto/releases/tag/desktop-v0.5.256', body)

    def test_empty_states_say_so(self):
        body = labels.channels_body([release(252, isPrerelease=False, isLatest=True)], set())
        self.assertIn('none right now', body)
        self.assertIn('| none |', body)


if __name__ == '__main__':
    unittest.main()
