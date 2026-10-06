"""The Gmail reading eval (tools/mail_eval.py): its scoring and its cases must be right, because a model release is judged by them. No network."""
import importlib.util
import json
import unittest
from pathlib import Path

from src.ai import mail

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mail_eval', ROOT / 'tools' / 'mail_eval.py')
mail_eval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mail_eval)

APPS = [{'company': 'Acme Labs', 'job': 'SRE', 'stage': 'Applied', 'applied': '2026-09-28'},
        {'company': '', 'job': 'Principal SRE', 'stage': 'Recruiter lead', 'via': 'Example Talent', 'applied': ''}]


def case(id, relevant, kinds=(), app=None, strict=False):
    return {'id': id, 'strict': strict, 'email': {}, 'expect': {'relevant': relevant, 'kinds': list(kinds), 'application': app}}


class ScoringTests(unittest.TestCase):
    def test_a_right_answer_is_right_and_each_kind_of_wrong_answer_says_why(self):
        rejected = case('r', True, ['Rejected'], 'Acme Labs')
        self.assertEqual(mail_eval.judge(rejected, {'relevant': True, 'kind': 'Rejected', 'application': 0}, APPS), '')
        self.assertIn('relevant', mail_eval.judge(rejected, {'relevant': False, 'kind': 'Other', 'application': -1}, APPS))
        self.assertIn('kind=Other', mail_eval.judge(rejected, {'relevant': True, 'kind': 'Other', 'application': 0}, APPS))
        self.assertIn('application', mail_eval.judge(rejected, {'relevant': True, 'kind': 'Rejected', 'application': 1}, APPS))
        self.assertIn('no answer', mail_eval.judge(rejected, None, APPS))

    def test_a_recruiter_lead_is_named_by_its_agency_and_no_application_is_minus_one(self):
        reply = case('l', True, ['Reply received'], 'Example Talent')
        self.assertEqual(mail_eval.judge(reply, {'relevant': True, 'kind': 'Reply received', 'application': 1}, APPS), '')
        pitch = case('p', True, ['Recruiter outreach'], None)
        self.assertEqual(mail_eval.judge(pitch, {'relevant': True, 'kind': 'Recruiter outreach', 'application': -1}, APPS), '')
        self.assertNotEqual(mail_eval.judge(pitch, {'relevant': True, 'kind': 'Recruiter outreach', 'application': 99}, APPS), '')   # out of range: wrong, not a crash

    def test_not_about_an_application_needs_only_relevant_false(self):
        code = case('c', False)
        self.assertEqual(mail_eval.judge(code, {'relevant': False, 'kind': 'Other', 'application': -1}, APPS), '')

    def test_one_strict_miss_fails_the_run_however_many_others_are_right(self):
        cases = [case(f'ok{n}', False) for n in range(9)] + [case('rejection', True, ['Rejected'], 'Acme Labs', strict=True)]
        results = {n: {'relevant': False, 'kind': 'Other', 'application': -1} for n in range(9)}
        results[9] = {'relevant': True, 'kind': 'Other', 'application': 0}
        report = mail_eval.score(cases, results, APPS)
        self.assertEqual((report['right'], report['strict_failed'], report['passed']), (9, ['rejection'], False))

    def test_a_few_misses_that_are_not_strict_still_pass_but_too_many_do_not(self):
        cases = [case(f'c{n}', False) for n in range(10)]
        right = {n: {'relevant': False, 'kind': 'Other', 'application': -1} for n in range(10)}
        wrong = lambda count: {n: ({'relevant': True, 'kind': 'Other', 'application': 0} if n < count else right[n]) for n in range(10)}
        self.assertTrue(mail_eval.score(cases, wrong(1), APPS)['passed'])      # 90%
        self.assertFalse(mail_eval.score(cases, wrong(2), APPS)['passed'])     # 80%, under the bar


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.applications, self.cases = mail_eval.load()

    def test_every_case_is_well_formed_and_expects_a_kind_the_check_knows(self):
        ids = [item['id'] for item in self.cases]
        self.assertEqual(len(ids), len(set(ids)))
        names = {app['company'] or app.get('via', '') for app in self.applications}
        for item in self.cases:
            self.assertTrue(all(item['email'].get(key) for key in ('from', 'subject', 'date', 'body')), item['id'])
            want = item['expect']
            if want['relevant']:
                self.assertTrue(want['kinds'] and set(want['kinds']) <= set(mail.KINDS), item['id'])
                self.assertTrue(want['application'] is None or want['application'] in names, item['id'])

    def test_the_cases_that_must_never_fail_are_marked_strict(self):
        strict = {item['id'] for item in self.cases if item['strict']}
        for needed in ('ats_update_reject', 'reject_no_individual_feedback', 'offer', 'interview_invite', 'security_code', 'card_receipt', 'vendor_usage_alert'):
            self.assertIn(needed, strict)

    def test_the_tracked_applications_read_the_way_the_check_reads_them(self):
        rows = mail_eval.tracked(self.applications)
        self.assertEqual(len(rows), len(self.applications))
        self.assertIn('Acme Labs', mail.listing(rows))
        self.assertIn('via Example Talent', mail.listing(rows))


if __name__ == '__main__':
    unittest.main()
