"""Every PR a workflow opens by itself is laid out by tools/bot-pr-body.sh (-> tools/pr-body.sh), or the required PR-description check fails it (#1456, 18 Oct 2026).
One test loops over every `gh pr create` / `gh pr edit --body*` in .github/workflows and names file:line when its body does not come from the helper."""
import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
OPENS = re.compile(r'gh pr (create|edit)\b')


def opens():
    for path in sorted((ROOT / '.github' / 'workflows').glob('*.yml')):
        lines = path.read_text().split('\n')
        for number, line in enumerate(lines, 1):
            if OPENS.search(line) and not line.lstrip().startswith('#') and (' pr create' in line or re.search(r'--body', line)):
                yield path, number, line, lines[:number - 1]


class BotPrBodiesTest(unittest.TestCase):
    def test_every_workflow_pr_body_comes_from_the_helper(self):
        found = list(opens())
        self.assertGreaterEqual(len(found), 4)
        for path, number, line, before in found:
            where = f'{path.relative_to(ROOT)}:{number}'
            match = re.search(r'--body-file\s+"?([^\s")]+)', line)
            self.assertTrue(match, f'{where}: the body is not --body-file <file> written by tools/bot-pr-body.sh')
            joined = re.sub(r'\\\n\s*', ' ', '\n'.join(before)).split('\n')   # a command continued with a backslash is one line
            produced = [text for text in joined if 'tools/bot-pr-body.sh' in text and re.search(r'>\s*"?' + re.escape(match.group(1)), text)]
            self.assertTrue(produced, f'{where}: {match.group(1)} is not written by tools/bot-pr-body.sh (the PR-description check fails a raw body)')

    def run_helper(self, *args):
        with tempfile.TemporaryDirectory() as tmp:
            git = lambda *a: subprocess.run(['git', '-C', tmp, *a], check=True, capture_output=True, text=True)
            git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@x'); git('config', 'user.name', 'T')
            (pathlib.Path(tmp) / 'a').write_text('a\n'); git('add', '.'); git('commit', '-qm', 'Start')
            (pathlib.Path(tmp) / 'b').write_text('b\n'); git('add', '.'); git('commit', '-qm', 'Change')
            detail = pathlib.Path(tmp) / 'detail.md'; detail.write_text('Fixes #5\n![x](https://x/a.png)\n')
            out = subprocess.run(['bash', str(ROOT / 'tools/bot-pr-body.sh'), 'HEAD~1', f'--detail={detail}', *args], cwd=tmp, capture_output=True, text=True)
        return out

    def test_the_helper_makes_a_body_the_check_accepts(self):
        out = self.run_helper('--verdict=🟢 A bot opened this', '--why=a workflow', '--unblocks=the check', '--label=Pool', '--before=a', '--after=b', '--rate=Cost=⚪ Low|cents')
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn('Fixes #5', out.stdout)
        self.assertIn('| 💰 Cost | ⚪ Low | cents |', out.stdout)
        check = subprocess.run(['python3', str(ROOT / 'tools/pr-body-check.py')], input=out.stdout, capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)

    def test_the_helper_refuses_a_missing_part(self):
        self.assertEqual(self.run_helper('--verdict=🟢 X', '--why=w').returncode, 2)


if __name__ == '__main__':
    unittest.main()
