"""Class guard for the shell the tests run (11 Oct 2026, main red on Linux CI): a macOS-only form without its GNU form first fails here with file:line. The incident: `stat -f %m dir` succeeds on Linux with lines of file-system text, so a staleness check never saw a number and a lock livelocked."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCANNED = ('tools/*.sh', 'tools/githooks/*', 'desktop/e2e/*.sh', 'desktop/scripts/*.sh', 'scripts/*.sh')
# (pattern, rule, what is allowed). A line may carry `# macos-only` or `# gnu-only` to say it is meant (a script that only ever runs on one of them).
RULES = (
    (re.compile(r'\bstat -f\b'), 'stat -f is the BSD form (on GNU it is a file-system report that succeeds): put `stat -c %Y` (GNU) first on the same line', lambda line, m: 'stat -c' in line[:m.start()]),
    (re.compile(r'\bdate -[jv]\b'), 'date -j / -v are BSD only: use `date -d` first on the same line', lambda line, m: 'date -d' in line[:m.start()]),
    (re.compile(r"\bsed -i(?:\s+(?:''|\"\"))"), "sed -i '' is BSD only: use `sed -i.bak ...` (works on both) or python", lambda line, m: False),
    (re.compile(r'\bsed -i\s+(?![\'"]{2}|\.)'), 'bare sed -i is GNU only: use `sed -i.bak ...` (works on both) or python', lambda line, m: False),
    (re.compile(r'\bmktemp -t\b'), 'mktemp -t means different things on BSD and GNU: use `mktemp -d` or a full template', lambda line, m: False),
)


def problems(text):
    found = []
    for number, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith('#') or '# macos-only' in line or '# gnu-only' in line:
            continue
        for pattern, rule, allowed in RULES:
            match = pattern.search(line)
            if match and not allowed(line, match):
                found.append((number, rule))
    return found


class ShellPortabilityTest(unittest.TestCase):
    def test_the_scanner_catches_each_form_and_accepts_the_portable_ones(self):
        bad = ('x="$(stat -f %m "$f")"', 'x="$(stat -f %m "$f" || stat -c %Y "$f")"', 'date -j -f %s 1', 'date -v+1d', "sed -i '' 's/a/b/' f", 'sed -i s/a/b/ f', 'mktemp -t x')
        for line in bad:
            self.assertTrue(problems(line), line)
        good = ('x="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")"', 'date -d @1 +%s || date -j -f %s 1', 'sed -i.bak s/a/b/ f', '# stat -f %m in a comment', 'stat -f %m "$f"  # macos-only', 'mktemp -d')
        for line in good:
            self.assertEqual(problems(line), [], line)

    def test_no_script_the_tests_or_ci_run_uses_a_macos_only_form_without_its_gnu_form(self):
        files = sorted({p for pattern in SCANNED for p in ROOT.glob(pattern) if p.is_file()})
        self.assertGreater(len(files), 20, 'the scan found the scripts')
        report = [f'{p.relative_to(ROOT).as_posix()}:{number}: {rule}' for p in files for number, rule in problems(p.read_text(errors='replace'))]
        self.assertEqual(report, [], '\n'.join(report))


if __name__ == '__main__':
    unittest.main()
