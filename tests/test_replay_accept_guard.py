"""tools/replay-accept-guard.py (owner, 14 Oct 2026: a session never accepts its own replay drop): its cases pass, it is registered as a Bash PreToolUse hook of the project,
and the rule is written where sessions read it."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class ReplayAcceptGuard(unittest.TestCase):
    def test_the_cases_pass(self):
        done = subprocess.run(['bash', str(ROOT / 'tools/replay-accept-guard.cases.sh')], capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertGreaterEqual(done.stdout.count('ok '), 10)

    def test_it_is_registered_for_bash(self):
        hooks = json.loads((ROOT / '.claude/settings.json').read_text())['hooks']['PreToolUse']
        commands = [h['command'] for entry in hooks if entry.get('matcher') == 'Bash' for h in entry['hooks']]
        self.assertTrue(any(c.endswith('tools/replay-accept-guard.py') for c in commands), commands)

    def test_the_rule_is_written(self):
        for path in ('docs/rules/apply-flow-workflow.md', '.claude/skills/fix-recorded-sites/SKILL.md'):
            text = (ROOT / path).read_text()
            self.assertIn('REPLAY_ACCEPT_OK=1', text, path)
            self.assertIn('never accept your own drop', text.lower(), path)
