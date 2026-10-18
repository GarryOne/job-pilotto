"""The Lab Job Search's CI replay (.github/workflows/search-lab.yml, tools/persona-search/tape-store.mjs, lab-upload.mjs): never on a PR, offline with no AI, the six candidates the upload knows,
the newest tape of a candidate chosen exactly, and a replay that lacked an AI answer ending as FAILED rather than thin numbers."""
import json
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github' / 'workflows' / 'search-lab.yml').read_text(encoding='utf-8')
UPLOAD = (ROOT / 'tools' / 'persona-search' / 'lab-upload.mjs').read_text(encoding='utf-8')


def node(code):
    out = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])


class Workflow(unittest.TestCase):
    def test_never_on_a_pr_and_main_moves_the_page(self):
        self.assertNotIn('pull_request', WORKFLOW)
        self.assertIn('branches: [main]', WORKFLOW)
        self.assertIn('--branch "${{ github.ref_name }}"', WORKFLOW)

    def test_the_replay_is_offline_and_runs_the_candidates_the_upload_knows(self):
        self.assertIn('--replay --no-live', WORKFLOW)
        self.assertNotIn('ANTHROPIC_API_KEY', WORKFLOW, 'no AI account on this workflow')
        matrix = re.search(r'candidate: \[([^\]]+)\]', WORKFLOW).group(1).replace(' ', '').split(',')
        known = re.findall(r"(\w+): '", re.search(r'CANDIDATES = \{(.*?)\};', UPLOAD, re.S).group(1))
        self.assertEqual(sorted(matrix), sorted(known))

    def test_a_crashed_search_is_posted_then_the_job_ends_red(self):
        self.assertIn('continue-on-error: true', WORKFLOW)
        self.assertIn("steps.replay.outcome == 'failure'", WORKFLOW)


class TapeStore(unittest.TestCase):
    def test_the_newest_complete_pair_of_exactly_that_candidate(self):
        names = ['search-tape-sre-20261018T010000Z.tgz.enc', 'search-tape-sre-20261018T010000Z.k.enc', 'search-tape-sre-20261019T010000Z.tgz.enc',
                 'search-tape-sre-2-20261020T010000Z.tgz.enc', 'search-tape-sre-2-20261020T010000Z.k.enc']
        got = node(f"import {{newestPair}} from './tools/persona-search/tape-store.mjs'; console.log(JSON.stringify([newestPair('sre', {json.dumps(names)}), newestPair('nobody', {json.dumps(names)})]))")
        self.assertEqual(got[0], {'bundle': 'search-tape-sre-20261018T010000Z.tgz.enc', 'key': 'search-tape-sre-20261018T010000Z.k.enc'},
                         'the 19 Oct bundle has no key yet, so the 18 Oct pair is used; "sre-2" is another candidate')
        self.assertIsNone(got[1])

    def test_only_replay_lines_count_and_a_changed_search_makes_the_row_tape_stale(self):
        report = '\n'.join(json.dumps(line) for line in [{'mode': 'record', 'ai_missing': 9}, {'mode': 'replay', 'ai_missing': 2, 'web_missing': 5, 'web_tape': 100}, {'mode': 'replay', 'ai_missing': 1, 'web_tape': 50}]) + '\nnot json'
        misses = node(f"import {{replayMisses}} from './tools/persona-search/tape-store.mjs'; console.log(JSON.stringify(replayMisses({json.dumps(report)})))")
        self.assertEqual(misses, {'ai': 3, 'web': 5, 'webTape': 150})

    def test_stale_means_any_missing_ai_answer_or_over_2_percent_of_web_requests(self):
        def note(ai, web, web_tape):
            return node(f"import {{staleNote}} from './tools/persona-search/tape-store.mjs'; console.log(JSON.stringify(staleNote({{ai: {ai}, web: {web}, webTape: {web_tape}}})))")
        self.assertEqual(note(0, 0, 500), '')
        self.assertEqual(note(0, 2, 498), '', '2 of 500 web requests: noise')
        self.assertEqual(note(0, 20, 480), 'Tape stale (0 AI and 20 web requests not recorded)')
        self.assertEqual(note(1, 0, 500), 'Tape stale (1 AI and 0 web requests not recorded)')


class HealWorkflow(unittest.TestCase):
    def test_the_heal_is_by_hand_on_its_own_key_and_publishes_nothing(self):
        heal = (ROOT / '.github' / 'workflows' / 'search-lab-heal.yml').read_text(encoding='utf-8')
        self.assertNotIn('pull_request', heal)
        self.assertNotIn('\n  schedule:', heal)
        self.assertIn('LAB_HEAL_ANTHROPIC_KEY: ${{ secrets.LAB_HEAL_ANTHROPIC_KEY }}', heal)   # owner 18 Oct 2026: apart from the random draws' key and cap
        self.assertNotIn('RANDOM_DRAWS_ANTHROPIC_KEY', heal)
        self.assertNotIn('tape-store.mjs publish', heal)
        self.assertNotIn('lab-upload', heal)


if __name__ == '__main__':
    unittest.main()
