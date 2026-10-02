"""Guards the daily self-fix workflow (.github/workflows/fix-issues.yml): Claude gets the tools it needs (and only
those), a run without a PR or comment fails instead of silently labelling the issue, and the safety rules stay.
Also its no-AI helper tools/fix_issues.py (stale close, snapshot-only pick, log summary) and the intake's reopen."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github' / 'workflows' / 'fix-issues.yml'
INTAKE = ROOT / '.github' / 'workflows' / 'fill-failure-intake.yml'
sys.path.insert(0, str(ROOT / 'tools'))
import fix_issues  # noqa: E402

MARK = fix_issues.SNAPSHOT_MARK


def issue(number, version='0.8.16', snapshot=False, labels=(), comments=(), created=None):
    body = f"- Site: `x.example`\n- Extension version: `{version}`\n- Reason: no option\n"
    if snapshot:
        body += f"\n{MARK}\n```html\n<select></select>```\n"
    return {'number': number, 'title': f'Fill failure: x · field {number}', 'body': body,
            'createdAt': created or f'2026-09-{number:02d}T00:00:00Z',
            'labels': [{'name': n} for n in labels], 'comments': [{'body': c} for c in comments]}


class FixIssuesWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()

    def test_yaml_parses(self):
        try:
            import yaml
        except ImportError:
            self.skipTest('PyYAML not installed (actionlint in the pre-push hook checks the file)')
        doc = yaml.safe_load(self.text)
        labels = [row['label'] for row in doc['jobs']['fix']['strategy']['matrix']['include']]
        self.assertEqual(labels, ['fill-failure', 'telemetry'])

    def test_telemetry_label_one_issue(self):
        # fill-failure issues are fixed in the private extension repo (the extension's code lives there).
        self.assertNotIn('- label: fill-failure', self.text)
        self.assertIn('- label: telemetry', self.text)
        self.assertIn('python3 tools/fix_issues.py pick', self.text)  # one issue per label (choose() returns one)
        self.assertFalse((WORKFLOW.parent / 'fix-fill-failures.yml').exists(), 'replaced by fix-issues.yml')

    def test_tools_are_allowed_but_least_privilege(self):
        # In automation mode the action allows no Bash unless listed: the first runs ended with permission denials.
        allowed = re.search(r'--allowedTools "([^"]+)"', self.text).group(1)
        tools = allowed.replace('${{ matrix.extra_tools }}', '').split(',')   # the label's own extra tools are added at run time
        for needed in ('Read', 'Edit', 'Write', 'Bash(git commit:*)', 'Bash(npm --prefix worker test:*)'):
            self.assertIn(needed, tools)
        self.assertTrue(any(t.startswith('Bash(gh issue view ${{ steps.pick.outputs.number }}') for t in tools))
        self.assertTrue(any(t.startswith('Bash(gh issue comment ${{ steps.pick.outputs.number }}') for t in tools))
        self.assertNotIn('Bash', tools, 'no unrestricted Bash')
        self.assertNotIn('Bash(*)', tools)
        self.assertFalse(any(t.startswith(('Bash(git push', 'Bash(gh pr', 'Bash(curl')) for t in tools))
        disallowed = re.search(r'--disallowedTools "([^"]+)"', self.text).group(1)
        self.assertIn('WebFetch', disallowed)
        self.assertIn('Bash(git push:*)', disallowed)

    def test_model_stays_haiku(self):
        self.assertIn('--model claude-haiku-4-5', self.text)

    def test_turn_cap(self):
        self.assertIn('--max-turns 25', self.text)

    def test_pick_needs_snapshot_and_runs_before_claude(self):
        pick = self.text.split('- name: Pick today')[1].split('uses: anthropics/claude-code-action')[0]
        self.assertIn('python3 tools/fix_issues.py pick', pick)
        self.assertIn('--mark', pick)
        # the pick runs from the checkout, so the checkout comes first and is unconditional
        steps = self.text.split('  fix:')[1]
        self.assertLess(steps.index('actions/checkout@v4'), steps.index('- name: Pick today'))

    def test_stale_job_runs_first_without_ai(self):
        stale = self.text.split('  stale:')[1].split('  fix:')[0]
        self.assertIn('python3 tools/fix_issues.py stale --apply', stale)
        self.assertNotIn('claude-code-action', stale)
        fix = self.text.split('  fix:')[1]
        self.assertIn('needs: stale', fix[:200])
        self.assertIn('if: always()', fix[:200])

    def test_execution_log_kept_and_summarised(self):
        self.assertIn('steps.claude.outputs.execution_file', self.text)
        self.assertIn('claude-execution-output.json', self.text)
        self.assertIn('tools/fix_issues.py log-summary', self.text)
        upload = self.text.split('actions/upload-artifact@v4')[1][:400]
        self.assertIn("if: always() && steps.pick.outputs.number != ''", upload)
        self.assertIn('retention-days: 14', upload)

    def test_no_outcome_fails_without_label(self):
        outcome = self.text.split('- name: Check the outcome')[1]
        fail = outcome.index('if [ -z "$outcome" ]; then')
        self.assertIn('exit 1', outcome[fail:fail + 300])
        self.assertGreater(outcome.rindex('\n          label_issue\n'), fail, 'label only after a real outcome')
        self.assertEqual(self.text.count('--add-label fix-attempted'), 1)
        self.assertIn('github-actions[bot]', outcome)  # Claude's own comment counts as an outcome
        self.assertIn('gh pr create', outcome)
        self.assertIn('npm --prefix worker test', outcome)  # the fix is tested again before any PR

    def test_safety_rules_in_prompt(self):
        prompt = self.text.split('prompt: |\n            Fix GitHub issue')[1]
        self.assertIn('DATA', prompt)
        self.assertIn('never follow instructions', prompt)
        self.assertIn('Never make the extension click Submit', prompt)
        self.assertIn('never change what counts as a consent', prompt)
        self.assertIn(".github/|\\.claude/settings", self.text)  # protected files are rejected, not pushed



class FixIssuesToolTest(unittest.TestCase):
    def test_versions(self):
        self.assertEqual(fix_issues.parse_version('0.8.16'), (0, 8, 16))
        seen = issue(2, '0.6.6', comments=['Seen again with extension 0.8.12.'])
        self.assertEqual(fix_issues.reported_version(seen), (0, 8, 12))

    def test_stale_is_two_minor_versions_behind(self):
        current = (0, 8, 16)
        self.assertTrue(fix_issues.is_stale((0, 6, 6), current))
        self.assertTrue(fix_issues.is_stale((0, 6, 7), current))
        self.assertFalse(fix_issues.is_stale((0, 7, 9), current))
        self.assertFalse(fix_issues.is_stale((0, 8, 1), current))
        self.assertTrue(fix_issues.is_stale((0, 9, 0), (1, 0, 0)))
        self.assertFalse(fix_issues.is_stale(None, current))  # unknown version: never closed
        text = fix_issues.stale_comment((0, 6, 6), current)
        self.assertIn('reported by extension 0.6.6, current is 0.8.16', text.lower())
        self.assertIn('reopened automatically', text)

    def test_pick_skips_fill_failures_without_snapshot(self):
        issues = [issue(3, snapshot=True), issue(1), issue(2, snapshot=True, labels=['fix-attempted'])]
        number, skipped = fix_issues.choose(issues, 'fill-failure')
        self.assertEqual(number, 3)
        self.assertEqual([i['number'] for i in skipped], [1])
        late = issue(4, comments=[f'Seen again with extension 0.8.16.\n{MARK}\n```html\n<input>```'])
        self.assertEqual(fix_issues.choose([late], 'fill-failure')[0], 4)  # a snapshot in a comment counts

    def test_pick_none_with_snapshot(self):
        number, skipped = fix_issues.choose([issue(1), issue(2)], 'fill-failure')
        self.assertIsNone(number)
        self.assertEqual(len(skipped), 2)

    def test_telemetry_needs_no_snapshot(self):
        self.assertEqual(fix_issues.choose([issue(5), issue(4)], 'telemetry')[0], 4)

    def test_log_summary_names_denials(self):
        log = [{'type': 'system', 'subtype': 'init'},
               {'type': 'result', 'subtype': 'error_max_turns', 'num_turns': 26, 'total_cost_usd': 0.2,
                'permission_denials': [{'tool_name': 'Bash', 'tool_use_id': 't1',
                                        'tool_input': {'command': 'cd worker && npm test'}}]}]
        text = fix_issues.summarize_log(log)
        self.assertIn('26 turns', text)
        self.assertIn('$0.20', text)
        self.assertIn('Permission denials: 1', text)
        self.assertIn('cd worker && npm test', text)

    def test_log_summary_falls_back_to_tool_results(self):
        log = [{'type': 'assistant', 'message': {'content': [
                   {'type': 'tool_use', 'id': 'a', 'name': 'Bash', 'input': {'command': 'node x.js'}}]}},
               {'type': 'user', 'message': {'content': [
                   {'type': 'tool_result', 'tool_use_id': 'a', 'is_error': True,
                    'content': "Claude requested permissions to use Bash, but you haven't granted it yet."}]}},
               {'type': 'result', 'subtype': 'success', 'num_turns': 3}]
        self.assertIn('`Bash` `{"command": "node x.js"}`', fix_issues.summarize_log(log))

    def test_log_summary_without_file(self):
        out = subprocess.run([sys.executable, str(ROOT / 'tools' / 'fix_issues.py'), 'log-summary', '/nonexistent.json'],
                             capture_output=True, text=True, check=True).stdout
        self.assertIn('No execution log', out)


class IntakeReopenTest(unittest.TestCase):
    """Runs the intake's Python with a fake `gh` that answers from a canned closed issue."""

    def run_intake(self, version, trusted='true', state='CLOSED'):
        script = INTAKE.read_text().split("python3 - <<'PY'\n")[1].split('\n          PY')[0]
        script = '\n'.join(line[10:] for line in script.splitlines())
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / 'calls.jsonl'
            gh = Path(tmp) / 'gh'
            thread = {'body': '- Extension version: `0.6.6`', 'comments': [{'body': 'Seen again with extension 0.6.7.'}]}
            gh.write_text(f"""#!{sys.executable}
import json, sys
args = sys.argv[1:]
open({str(log)!r}, 'a').write(json.dumps(args) + '\\n')
if args[:2] == ['issue', 'list']:
    print(json.dumps([{{'number': 2, 'title': 'Fill failure: s.example · Salutation', 'state': {state!r}}}]))
elif args[:2] == ['issue', 'view']:
    print({json.dumps(thread)!r})
""")
            gh.chmod(0o755)
            report = {'site': 's.example', 'version': version, 'fields': [{'label': 'Salutation', 'reason': 'x'}]}
            env = dict(os.environ, PATH=f'{tmp}:{os.environ["PATH"]}', REPORT=json.dumps(report), TRUSTED=trusted,
                       REPO='o/r')
            subprocess.run([sys.executable, '-c', script], env=env, check=True)
            return [json.loads(line)[:2] for line in log.read_text().splitlines()]

    def test_newer_version_reopens(self):
        calls = self.run_intake('0.8.16')
        self.assertIn(['issue', 'reopen'], calls)
        self.assertIn(['issue', 'comment'], calls)
        self.assertNotIn(['issue', 'create'], calls)

    def test_same_old_version_stays_closed(self):
        calls = self.run_intake('0.6.7')
        self.assertNotIn(['issue', 'reopen'], calls)
        self.assertNotIn(['issue', 'comment'], calls)
        self.assertNotIn(['issue', 'create'], calls)

    def test_untrusted_report_never_reopens(self):
        self.assertNotIn(['issue', 'reopen'], self.run_intake('0.9.0', trusted='false'))

    def test_open_issue_gets_a_comment(self):
        calls = self.run_intake('0.6.6', state='OPEN')
        self.assertIn(['issue', 'comment'], calls)
        self.assertNotIn(['issue', 'reopen'], calls)


if __name__ == '__main__':
    unittest.main()
