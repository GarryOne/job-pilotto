import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import daily
import job_store
import score


def fit(value, reason='Kubernetes + Datadog match; salary not stated'):
    return {'score': value, 'tier': 'A' if value >= 75 else 'B', 'reason': reason,
            'components': {'role_fit': value, 'location': 80, 'compensation': 50, 'growth': 70, 'risk': 20},
            'strengths': ['Kubernetes'], 'gaps': ['salary not stated'], 'confidence': 'medium'}


class FakeClient:
    def __init__(self, value=80):
        self.value, self.requests = value, []
        self.messages = self

    def create(self, **params):
        self.requests.append(params)
        return SimpleNamespace(stop_reason='end_turn',
                               content=[SimpleNamespace(type='text', text=json.dumps(fit(self.value)))],
                               usage=SimpleNamespace(input_tokens=100, output_tokens=40, cache_read_input_tokens=0))


def seed_jobs(db, count, old=True):
    job_store.import_watch_report(db, {'jobs': [
        {'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich',
         'url': f'https://x.test/{i}', 'description': 'Kubernetes, Terraform, Datadog.'} for i in range(count)]})
    if old:
        db.execute("UPDATE jobs SET last_seen_at = '2099-01-01T00:00:00+00:00'")


class ScoreTests(unittest.TestCase):
    def test_rescores_only_when_job_or_profile_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 3)
                candidates, _ = daily.eligible_jobs(db)
                client = FakeClient()
                self.assertIn('Scored 3 of 3', score.run(db, candidates, 'Profile v1', 'm', 10, client=client))
                self.assertIn('0 job(s)', score.run(db, candidates, 'Profile v1', 'm', 10, client=client))
                self.assertIn('Scored 3 of 3', score.run(db, candidates, 'Profile v2', 'm', 10, client=client))
                system = client.requests[0]['system'][0]
                self.assertIn('Profile v1', system['text'])
                self.assertEqual(system['cache_control'], {'type': 'ephemeral'})
                self.assertEqual(client.requests[0]['output_config']['format']['type'], 'json_schema')

    def test_scores_are_clamped(self):
        client = FakeClient(value=140)
        data, _ = score.score_one(client, 'm', {'title': 'SRE', 'company': 'X', 'description': 'd'}, 'p')
        self.assertEqual(data['score'], 100)

    def test_best_matches_lead_and_rotate(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed_jobs(db, 20)
                candidates, _ = daily.eligible_jobs(db)
                for job in candidates:  # job ids 1..20 get scores 41..98
                    score.save(db, job, 'm', fit(38 + 3 * job['id']), 'p')
                first = []
                message = daily.build_digest(db, seed=1, shown_ids=first)[0][0]
                daily.mark_shown(db, first, seed=1)
                second = []
                daily.build_digest(db, seed=2, shown_ids=second)
        self.assertIn('🎯 <b>Best matches</b>', message)
        self.assertIn('🎯 <b>98</b>', message)
        self.assertIn('<i>Kubernetes + Datadog match; salary not stated</i>', message)
        self.assertEqual(set(first), set(range(11, 21)))  # the ten highest scores
        # Light rotation: some best matches return, but the list is not identical.
        self.assertNotEqual(first, second)
        self.assertTrue(set(first) & set(second))


if __name__ == '__main__':
    unittest.main()
