"""Commands that act only on Notion (unapply, not-submitted) print one result and stop: they must not fall through to `status`."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import desktop
from src.notion import client


class FakeTracker:
    def revert_applying(self, url):
        return 'updated'

    def revert_unsubmitted(self, url):
        return 'unchanged', None


class TrackerCommandsTests(unittest.TestCase):
    def run_command(self, *argv):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(desktop, 'JOBS_DB', Path(tmp) / 'jobs.sqlite'), \
                mock.patch.object(client.Tracker, 'from_env', return_value=FakeTracker()), contextlib.redirect_stdout(out):
            code = desktop.main(list(argv))
        return code, out.getvalue().strip().splitlines()

    def test_each_notion_only_command_prints_one_result_and_returns(self):
        for command in ('unapply', 'not-submitted'):
            with self.subTest(command=command):
                code, lines = self.run_command(command, 'https://x.test/1')
                self.assertEqual(code, 0)
                self.assertEqual(len(lines), 1, lines)
                self.assertIn('ok', json.loads(lines[0]))


if __name__ == '__main__':
    unittest.main()
