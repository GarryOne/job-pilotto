import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import daily, digest
from src import store as job_store
from src.ai import score


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
                candidates, _ = digest.eligible_jobs(db)
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
                candidates, _ = digest.eligible_jobs(db)
                for job in candidates:
                    # ids 1-3: low fit (hidden); 4-10: 64..70; 11-20: 86..95, a gap wider than the rotation jitter
                    value = 30 if job['id'] <= 3 else 60 + job['id'] if job['id'] <= 10 else 75 + job['id']
                    score.save(db, job, 'm', fit(value), 'p')
                first = []
                message = digest.build_digest(db, seed=1, shown_ids=first)[0][0]
                digest.mark_shown(db, first, seed=1)
                second = []
                digest.build_digest(db, seed=2, shown_ids=second)
        self.assertIn('🎯 <b>Best matches</b>', message)
        self.assertIn('🎯 <b>95</b>', message)
        self.assertIn('3 low fit', message)
        self.assertEqual(message.count('🎯 <b>Best matches</b>'), 1)
        self.assertIn('<i>Kubernetes + Datadog match; salary not stated</i>', message)
        self.assertEqual(set(first), set(range(11, 21)))  # the ten highest scores
        self.assertFalse({1, 2, 3} & set(first + second))  # below digest_min_score: never in the digest
        # Light rotation: some best matches return, but the list is not identical.
        self.assertNotEqual(first, second)
        self.assertTrue(set(first) & set(second))


if __name__ == '__main__':
    unittest.main()


class ScoringProfileTests(unittest.TestCase):
    PROFILE = ('# Hard constraints\n- EU citizen\n# Contact\n- Phone: +00 000\n# Links\n- LinkedIn: x\n## 📎 CV\n- cv.pdf\n'
               '# Experience\n## SRE — Acme\n- Kubernetes\n# Application form answers — surveys\n- Gender: …')

    def test_the_fit_score_reads_goals_and_experience_but_not_contact_links_or_form_answers(self):
        kept = score.scoring_profile(self.PROFILE)
        self.assertEqual(kept, '# Hard constraints\n- EU citizen\n# Experience\n## SRE — Acme\n- Kubernetes')

    def test_a_new_phone_number_rescores_nothing_but_a_new_skill_does(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        job = {'id': 1, 'title': 'SRE', 'description': 'Run Kubernetes', 'ai': {}, 'first_seen_at': '2026-09-28'}
        score.save(db, job, 'm', {'score': 80}, score.scoring_profile(self.PROFILE))
        phone = self.PROFILE.replace('+00 000', '+11 111')
        self.assertEqual(score.stale_count(db, [job], phone), 0)
        skill = self.PROFILE.replace('- Kubernetes', '- Kubernetes, Terraform')
        self.assertEqual(score.stale_count(db, [job], skill), 1)

    def test_scores_made_from_the_whole_profile_stay_current_without_a_new_ai_call(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        job = {'id': 1, 'title': 'SRE', 'description': 'Run Kubernetes', 'ai': {}, 'first_seen_at': '2026-09-28'}
        score.save(db, job, 'm', {'score': 80}, self.PROFILE)  # scored before scoring_profile existed
        self.assertEqual(score.stale_count(db, [job], self.PROFILE), 0)  # adopted: its hash is updated, no re-score
        self.assertEqual(score.stale_count(db, [job], self.PROFILE.replace('+00 000', '+2')), 0)


class ProvenanceTests(unittest.TestCase):
    def test_kept_scores_are_labelled_previous_method_and_can_be_queued_for_a_new_score(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        profile = '# Goals\n- SRE\n# Contact\n- Phone: 1'
        job = {'id': 1, 'title': 'SRE', 'description': 'Run Kubernetes', 'ai': {}, 'first_seen_at': '2026-09-28'}
        score.save(db, job, 'm', {'score': 80}, profile)  # the whole Profile: the previous method
        score.stale_count(db, [job], profile)  # kept without an AI call...
        self.assertEqual(score.load(db)[1]['method'], 'Previous')  # ...but labelled as such
        self.assertEqual(score.previous_method(db), [1])
        self.assertEqual(score.rescore_previous(db), 1)
        self.assertEqual(score.stale_count(db, [job], profile), 1)  # queued: the next search re-scores it
        score.save(db, job, 'm', {'score': 82}, score.scoring_profile(profile))
        self.assertEqual((score.load(db)[1]['method'], score.load(db)[1]['scorer_version']), ('Current', score.SCORER_VERSION))


class KitProvenanceTests(unittest.TestCase):
    def test_a_kit_is_current_until_its_cv_profile_or_answers_change_and_unknown_without_a_record(self):
        import tempfile
        from pathlib import Path
        from src.ai import provenance
        with tempfile.TemporaryDirectory() as tmp:
            cv = Path(tmp) / 'cv.pdf'
            cv.write_bytes(b'%PDF one')
            recorded = provenance.kit_inputs('# Goals\n- SRE\n# Contact\n- Phone: 1', '# A\n- x', cv)
            self.assertEqual(provenance.kit_state(recorded, provenance.kit_inputs('# Goals\n- SRE\n# Contact\n- Phone: 2', '# A\n- x', cv)), 'current')
            self.assertEqual(provenance.kit_state(recorded, provenance.kit_inputs('# Goals\n- SRE, platform', '# A\n- y', cv)), 'earlier:profile,answers')
            cv.write_bytes(b'%PDF two')
            self.assertEqual(provenance.kit_state(recorded, provenance.kit_inputs('# Goals\n- SRE', '# A\n- x', cv)), 'earlier:cv')
        self.assertEqual(provenance.kit_state('', 'cv:a profile:b answers:c'), 'unknown')
