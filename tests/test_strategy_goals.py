"""The Strategy page shows the setup goals from the Profile (owner, 7 Oct 2026: work mode, salary and languages were only in the setup review)."""
import unittest

from src.desktop import _goals


class GoalsTests(unittest.TestCase):
    def test_table_rows_and_lines_as_the_profile_writes_them(self):
        profile = ('## Hard constraints\nConstraint | Value\n**Work mode** | On-site, hybrid or remote\nLanguages I can work in | French (working level), Romanian\n'
                   'Minimum seniority | Junior / entry level\n## Compensation\n- **Minimum acceptable:** CHF 48,000 a year (estimate)\n')
        self.assertEqual(_goals(profile), {'work_mode': 'On-site, hybrid or remote', 'languages': 'French (working level), Romanian',
                                           'seniority': 'Junior / entry level', 'minimum_salary': 'CHF 48,000 a year (estimate)'})

    def test_a_profile_without_them_has_none(self):
        self.assertEqual(_goals('## Strengths\n- Portraits\n'), {})
        self.assertEqual(_goals(''), {})


if __name__ == '__main__':
    unittest.main()
