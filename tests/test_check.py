"""The shared checker selects compatible runtimes, preserves failure status and uses the same suite commands as CI."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('project_check', Path(__file__).resolve().parents[1] / 'tools/check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class CheckTests(unittest.TestCase):
    def test_node_versions(self):
        for version in ['v12.18.3', 'v20.19.0', 'v22.12.0', 'v23.0.0']:
            self.assertFalse(check.node_supported(version))
        for version in ['v22.13.0', 'v22.23.1', 'v24.0.0']:
            self.assertTrue(check.node_supported(version))

    def test_fallback_from_stale_node(self):
        with mock.patch.object(check.shutil, 'which', return_value='/old/node'), mock.patch.object(check.subprocess, 'check_output', side_effect=['v22.23.1']):
            node, version = check.find_node({'JOB_PILOTTO_CHECK_NODE': '/new/node', 'NVM_DIR': '/nonexistent'})
            self.assertEqual(node, '/new/node')
            self.assertEqual(version, 'v22.23.1')
        with mock.patch.object(check.shutil, 'which', return_value='/old/node'), mock.patch.object(check.subprocess, 'check_output', return_value='v12.0.0'):
            with self.assertRaisesRegex(RuntimeError, 'Node 22'):
                check.find_node({'NVM_DIR': '/nonexistent'})

    def test_area_and_fast_commands(self):
        full = check.commands('desktop', False, 'node', 'npm')
        self.assertEqual(full[0][1], ['npm', 'test'])
        fast = check.commands('desktop', True, 'node', 'npm')
        self.assertEqual(fast[0][1], ['node', 'scripts/stage.mjs'])
        self.assertIn('test/session-contracts.test.js', fast[-1][1])
        self.assertIn('test/app-scenarios.test.js', fast[-1][1])
        self.assertEqual(check.commands('python', False, None, None)[0][1][1:4], ['-m', 'unittest', 'discover'])

    def test_failure_propagates_and_external_services_are_disabled(self):
        with mock.patch.object(check.subprocess, 'run', return_value=mock.Mock(returncode=3)) as run:
            self.assertEqual(check.main(['--area', 'python']), 1)
            self.assertEqual(run.call_args.kwargs['env']['JOB_PILOTTO_DISABLE'], 'mail,notion,telegram,google_jobs')
            self.assertEqual(run.call_args.kwargs['env']['npm_config_legacy_peer_deps'], 'false')

    def test_missing_dependencies_are_actionable(self):
        with mock.patch.object(check, 'find_node', return_value=('/node', 'v22.23.1')), mock.patch.object(check.shutil, 'which', return_value='/npm'), mock.patch.object(check.Path, 'is_dir', return_value=False):
            self.assertEqual(check.main(['--area', 'desktop']), 2)
