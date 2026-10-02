"""Excluded companies match whatever the legal form (the owner's current employer must never show up)."""
import unittest
from unittest import mock

from src import digest


class CompanyExclusionTests(unittest.TestCase):
    def test_legal_form_and_case_do_not_matter(self):
        with mock.patch.dict(digest.PREFERENCES, {'excluded_companies': ['Acme', 'AcmeSource']}):
            for name in ('AcmeSource SA', 'acmesource', 'Acme', 'ACME AG', 'AcmeSource S.A.'):
                self.assertTrue(digest.company_excluded({'company': name}), name)
            for name in ('Acmeware', 'Grafana Labs', '', None):
                self.assertFalse(digest.company_excluded({'company': name}), name)


if __name__ == '__main__':
    unittest.main()
