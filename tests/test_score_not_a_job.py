"""A scored text that is not one job (a list of jobs, a category page) never ranks as a match (src/ai/score_not_a_job.py): the scorer answers
basis.one_job, a False answer keeps score 0 and tier C with the reason first, and an older answer without the field stays as it was."""
import json
import unittest
from types import SimpleNamespace

from src.ai import score, score_not_a_job


def answer(one_job=None, value=78):
    basis = {'salary_stated': True, 'level_stated': True, **({} if one_job is None else {'one_job': one_job})}
    return {'score': value, 'tier': 'A', 'reason': 'Finance roles in Amsterdam', 'basis': basis, 'confidence': 'medium',
            'components': {'role_fit': value, 'location': 90, 'compensation': None, 'growth': None, 'risk': 20},
            'strengths': ['FP&A'], 'gaps': ['salary not stated']}


def client(data):
    asked = []
    def create(**params):
        asked.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(data))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))
    return SimpleNamespace(messages=SimpleNamespace(create=create), asked=asked)


# 18 Oct 2026: a recruiter's category page sat in a finance candidate's top 10.
CATEGORY = {'title': 'Finance vacatures', 'company': 'Michael Page', 'location': 'Amsterdam',
            'description': 'Financial Analyst - Amsterdam\nController - Utrecht\nFP&A Manager - Rotterdam\n312 vacatures'}


class NotAJobTest(unittest.TestCase):
    def test_the_scorer_is_asked_whether_the_text_is_one_job(self):
        basis = score.SCHEMA['properties']['basis']
        self.assertIn('one_job', basis['required'])
        self.assertEqual(basis['properties']['one_job']['type'], 'boolean')
        self.assertIn('list of jobs', basis['properties']['one_job']['description'])

    def test_a_category_page_scores_0_tier_c_with_the_reason_and_no_second_ask(self):
        fake = client(answer(one_job=False))
        data, _ = score.score_one(fake, 'm', CATEGORY, 'Financial analyst in Amsterdam')
        self.assertEqual((data['score'], data['tier'], data['gaps'][0]), (0, 'C', score_not_a_job.GAP))
        self.assertEqual(len(fake.asked), 1, 'a page that is not a job is not asked again for its salary or level')

    def test_one_job_keeps_its_score(self):
        for one_job in (True, None):   # None: an answer scored before the field existed
            with self.subTest(one_job=one_job):
                data, _ = score.score_one(client(answer(one_job=one_job)), 'm', {**CATEGORY, 'title': 'Financial Analyst'}, 'p')
                self.assertEqual((data['score'], data['tier']), (78, 'A'))
                self.assertNotIn(score_not_a_job.GAP, data['gaps'])


if __name__ == '__main__':
    unittest.main()
