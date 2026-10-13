"""The offline replay of the pool rows (.github/workflows/replay-offline.yml): never on a PR (owner, 14 Oct 2026: 15+ minutes of macOS queue on every PR),
only main publishes to /admin/applying "Replay vs live", and it never asks an AI."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github' / 'workflows' / 'replay-offline.yml').read_text()


class ReplayOfflineWorkflow(unittest.TestCase):
    def test_it_never_runs_on_a_pull_request(self):
        trigger = re.search(r'(?m)^on:\n((?:  .*\n)+)', WORKFLOW).group(1)
        self.assertNotIn('pull_request', trigger)
        self.assertIn('workflow_dispatch:', trigger)

    def test_only_main_publishes_to_the_page(self):
        send = re.search(r'- name: Send the rows[^\n]*\n\s+if: ([^\n]+)', WORKFLOW)
        self.assertIsNotNone(send, 'the step that sends the rows to /admin/applying')
        self.assertIn("github.ref == 'refs/heads/main'", send.group(1))

    def test_it_never_asks_an_ai(self):
        for word in ('ANTHROPIC', 'OPENAI', 'claude -p', 'secrets: inherit'):
            self.assertNotIn(word, WORKFLOW)


if __name__ == '__main__':
    unittest.main()
