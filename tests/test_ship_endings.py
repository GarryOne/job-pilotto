"""Every place that tells a session how a tools/ship.sh run ends names all three endings: DONE (merged), FAILED, REVIEW (green, the owner merges by hand).
12 Oct 2026: review mode ends with 'ship: REVIEW #n'; ship's own announcement named only DONE and FAILED, and job-pilotto-next-move waited 10 min in the
foreground for a line it never prints. A new doc, skill or tool line that names the endings without REVIEW fails here."""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDS = ('DONE', 'FAILED', 'REVIEW')
NAMES_ENDINGS = re.compile(r'ship: \(?DONE|DONE\|FAILED')   # a line that tells how a ship run ends


def tracked():
    out = subprocess.run(['git', 'ls-files', '*.md', '*.sh', '*.py', '*.mjs', '*.js', '*.yml'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if not path.startswith(('tests/', 'desktop/test/', 'desktop/e2e/test/'))]   # tests assert one ending on purpose


class ShipEndingsTest(unittest.TestCase):
    def test_every_line_that_names_how_ship_ends_names_all_three(self):
        missing, seen = [], 0
        for path in tracked():
            try: text = (ROOT / path).read_text(encoding='utf-8')
            except (OSError, UnicodeDecodeError): continue
            lines = text.splitlines()
            for number, line in enumerate(lines, 1):
                window = line + ' ' + (lines[number] if number < len(lines) else '')   # a doc may wrap the endings onto the next line (AGENTS.md did)
                if NAMES_ENDINGS.search(line) and 'FAILED' in window:
                    seen += 1
                    if not all(end in window for end in ENDS): missing.append(f'{path}:{number}: {line.strip()[:120]}')
        self.assertGreater(seen, 0, 'positive control: the scan finds the lines (tools/ship.sh announces its endings)')
        self.assertEqual(missing, [], 'name REVIEW too: review mode ends with `ship: REVIEW #n <url>` (Monitor ^ship: (DONE|FAILED|REVIEW))')

    def test_the_background_announcement_names_the_monitor_pattern(self):
        announce = next(line for line in (ROOT / 'tools' / 'ship.sh').read_text().splitlines() if 'its last line says how it ended' in line)
        for end in ENDS: self.assertIn(f'ship: {end}', announce)
        self.assertIn('^ship: (DONE|FAILED|REVIEW)', announce)

    def test_ship_prints_each_ending_it_announces(self):
        source = (ROOT / 'tools' / 'ship.sh').read_text() + (ROOT / 'tools' / 'ship-pr.sh').read_text()
        for end in ENDS: self.assertRegex(source, rf'echo "ship: {end}\b|ship: {end} ', end)


if __name__ == '__main__':
    unittest.main()
