"""Every reader that filters the Profile by heading still sees Your details' facts (owner's Profile, 18 Oct 2026: 🛂 / 💶 / 🗣️ sat under "# Links"
and the fit scorer skipped them; the work permit was then visible only to the kit, never to the score). A fact must reach every reader, wherever its
section sits. A new heading filter (a FORM_ONLY list) must be added here, or the last test fails."""
import re
import unittest
from pathlib import Path

from src.ai import provenance, score

ROOT = Path(__file__).resolve().parents[1]
# The owner's shape, fictional values: the fact sections under an old "Links" heading, beside the CV file and the contact lines.
PROFILE = ('# Hard constraints\n| Constraint | Value |\n|---|---|\n| Work mode | Hybrid |\n# Links\n- Medium: https://medium.example/@a\n## 📎 CV\n- cv.pdf\n'
           '## 📇 Contact details\n- Phone: +00 000\n## 🛂 Work eligibility\n- Work permit: B permit\n## 💶 Availability & compensation\n'
           '- Notice period: 1 month\n## 🗣️ Languages\n- Languages I can work in: English\n# Experience\n- SRE')
FACTS = ('Work permit: B permit', 'Notice period: 1 month', 'Languages I can work in: English')

# reader -> what it makes of the Profile text (a changed fact must change what it reads).
READERS = {
    'fit score (src/ai/score.py scoring_profile)': score.scoring_profile,
    'kit freshness (src/ai/provenance.py kit_inputs)': lambda profile: provenance.kit_inputs(profile, '', cv_path='/nonexistent'),
}
# The files that filter Profile sections by heading, and where each is checked (desktop/test/strategy-rebuild.test.js for the JS one).
FILTERS = {'src/ai/score.py', 'desktop/lib/strategy-rebuild.js'}


class ProfileReadersTests(unittest.TestCase):
    def test_every_reader_sees_every_your_details_fact_under_an_old_heading(self):
        for name, read in READERS.items():
            for fact in FACTS:
                changed = PROFILE.replace(fact, fact + ' (changed)')
                self.assertNotEqual(read(PROFILE), read(changed), f'{name} does not see "{fact}"')

    def test_contact_lines_still_change_nothing(self):
        for name, read in READERS.items():
            self.assertEqual(read(PROFILE), read(PROFILE.replace('+00 000', '+11 111')), f'{name}: a new phone number must not re-score or re-draft')

    def test_every_heading_filter_is_listed_here(self):
        found = set()
        for folder, pattern in (('src', '*.py'), ('desktop/lib', '*.js')):
            for path in (ROOT / folder).rglob(pattern):
                if 'node_modules' not in path.parts and re.search(r'\bFORM_ONLY\s*=', path.read_text(encoding='utf-8', errors='ignore')):
                    found.add(path.relative_to(ROOT).as_posix())
        self.assertEqual(found, FILTERS, 'a new Profile heading filter: check it reads Your details under any heading, then list it here')


if __name__ == '__main__':
    unittest.main()
