"""Fit scores are not made against an empty Profile: the Notion template (❓ fields) says nothing about the person, and its low scores
stuck after the Profile was filled (7 Oct 2026, a workspace connected after an import got the blank template)."""
from pathlib import Path
import re
import sqlite3
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import score  # noqa: E402
from src import doctor  # noqa: E402


def template_as_notion_renders_it():
    """The Profile section of the template, as Tracker.page_text gives it: headings kept, table rows 'a | b' without outer pipes."""
    text = score.TEMPLATE.read_text()
    section = text.split('## 👤 Profile — CV and Preferences', 1)[1].split('\n---', 1)[0]
    lines = []
    for line in section.splitlines():
        if re.fullmatch(r'\|[\s|:-]*\|', line.strip()):
            continue  # Notion has no separator row
        lines.append(' | '.join(cell.strip() for cell in line.strip().strip('|').split('|')) if line.strip().startswith('|') else line)
    return '\n'.join(lines)


FILLED = """# Hard constraints
Constraint | Value
Countries | Switzerland, Geneva area first
Home base | Geneva, not relocating
Languages I can work in | French (native), English (good)
Work permit / visa | Swiss B permit
# Experience
- Store manager, fashion retail, Geneva, 2021-2026: team of 6, visual merchandising, stock
- Event photographer, freelance: weddings and portraits, Lightroom and Photoshop
"""


class UnfilledProfileTest(unittest.TestCase):
    def test_the_template_is_unfilled_and_a_real_profile_is_not(self):
        blank = template_as_notion_renders_it()
        self.assertGreater(len(blank), 1000)                     # long enough to pass the old "under 300 characters" check
        self.assertTrue(score.unfilled(blank), score.own_words(blank))
        self.assertTrue(score.unfilled(''))
        self.assertFalse(score.unfilled('Senior SRE, Zurich'))         # short, but the person's own: scored
        self.assertTrue(score.unfilled(blank + '\nHome base | Geneva'))   # one field of the template: still no basis
        self.assertFalse(score.unfilled(FILLED))
        self.assertFalse(score.unfilled(blank + '\n' + FILLED))  # the template with the person's answers added

    def test_no_score_is_made_or_saved_while_the_profile_is_empty(self):
        class NoCalls:
            def __getattr__(self, name):
                raise AssertionError('no AI call with an empty Profile')
        db = sqlite3.connect(':memory:')
        stats = {}
        said = score.run(db, [{'id': 1, 'title': 'Vendeur', 'url': 'u'}], template_as_notion_renders_it(), 'm', 60, client=NoCalls(), stats=stats)
        self.assertEqual(said, score.PAUSED)
        self.assertEqual(stats, {'paused': 'profile'})

    def test_doctor_fails_on_the_template(self):
        from src.stores import memory
        stores = memory.open_store()
        stores.texts.set('profile', template_as_notion_renders_it())
        self.assertEqual(doctor.check_profile(stores).state, doctor.FAIL)
        stores.texts.set('profile', FILLED)
        self.assertEqual(doctor.check_profile(stores).state, doctor.OK)


if __name__ == '__main__':
    unittest.main()
