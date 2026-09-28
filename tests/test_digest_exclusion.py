"""Excluded companies match whatever the legal form (the owner's current employer must never show up)."""
import unittest
from unittest import mock

from src import digest


class CompanyExclusionTests(unittest.TestCase):
    def test_legal_form_and_case_do_not_matter(self):
        with mock.patch.dict(digest.PREFERENCES, {'excluded_companies': ['Sonar', 'SonarSource']}):
            for name in ('SonarSource SA', 'sonarsource', 'Sonar', 'SONAR AG', 'SonarSource S.A.'):
                self.assertTrue(digest.company_excluded({'company': name}), name)
            for name in ('Sonarware', 'Grafana Labs', '', None):
                self.assertFalse(digest.company_excluded({'company': name}), name)


if __name__ == '__main__':
    unittest.main()
