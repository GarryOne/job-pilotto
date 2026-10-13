"""The offline replay of the pool rows (.github/workflows/replay-offline.yml; owner, 14 Oct 2026): never on a PR, started on time by the Worker (GitHub's schedule as
the backup, which stops on a commit already replayed), compared with the last green run (replay-gate.mjs, with a retry), its results kept as the next baseline,
red when a counted row got worse, Telegram on failure, only main updates /admin/applying, and it never asks an AI."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github' / 'workflows' / 'replay-offline.yml').read_text()
TRIGGER = re.search(r'(?m)^on:\n((?:  .*\n|\n)+?)(?=^\S)', WORKFLOW).group(1)


class ReplayOfflineWorkflow(unittest.TestCase):
    def test_never_on_a_pr_started_by_the_worker_with_a_backup_schedule(self):
        self.assertNotIn('pull_request', TRIGGER)
        self.assertIn('workflow_dispatch:', TRIGGER)
        self.assertIn('schedule:', TRIGGER)
        self.assertIn("'Replay check · on time (Worker cron)'", WORKFLOW)
        self.assertIn('Anything changed since the last green replay?', WORKFLOW)
        self.assertIn("':!desktop/test'", WORKFLOW, 'a change to the tests alone replays nothing')

    def test_the_gate_compares_with_the_last_green_run_and_keeps_its_results(self):
        self.assertIn('--status success', WORKFLOW)
        self.assertIn('node replay-gate.mjs', WORKFLOW)
        self.assertIn('--retry', WORKFLOW)
        self.assertIn('name: replay-results-${{ github.run_id }}', WORKFLOW)
        self.assertRegex(WORKFLOW, r"if: steps\.gate\.outputs\.red == '1'\n\s+run: .*exit 1")

    def test_only_main_publishes_and_alerts(self):
        send = re.search(r'- name: Send the rows[^\n]*\n\s+if: ([^\n]+)', WORKFLOW)
        self.assertIn("github.ref == 'refs/heads/main'", send.group(1))
        self.assertIn('node ci-alert.mjs failure', WORKFLOW)
        self.assertIn('secrets.CI_ALERTS_TELEGRAM_BOT_TOKEN', WORKFLOW)

    def test_it_never_asks_an_ai(self):
        for word in ('ANTHROPIC', 'OPENAI', 'claude -p', 'secrets: inherit'):
            self.assertNotIn(word, WORKFLOW)

    def test_the_nightly_builds_only_after_a_green_replay(self):
        desktop = (ROOT / '.github' / 'workflows' / 'desktop.yml').read_text()
        self.assertIn('tools/nightly-replay-gate.sh', desktop)
        self.assertIn('No nightly beta:', desktop)


if __name__ == '__main__':
    unittest.main()
