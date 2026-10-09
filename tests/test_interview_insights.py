"""Interview insights (src/ai/interview_insights.py): what is read, the honesty checks, the update and its stored words.
Siblings: test_interview_insights_prompt.py, test_interview_insights_run.py."""
from datetime import date
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import interview_insights as ii
from src.stores import open_stores
from src.ai import insights, interviews
from tests.model_stand_ins import rounds as setUpModule  # noqa: F401 (the model's answer)
from tests.interview_insights_fakes import NOW, text, select, interview, FakeNotion, FakeClient, ONE, PAGES, RESULT, env, of, recs


class Input(unittest.TestCase):
    def test_round_types_keep_screens_technical_and_manager_rounds_apart(self):
        self.assertEqual(ii.round_type('Recruiter screen'), 'Recruiter screen')
        self.assertEqual(ii.round_type('Technical screen'), 'Technical')
        self.assertEqual(ii.round_type('System design'), 'Technical')
        self.assertEqual(ii.round_type('Hiring manager'), 'Hiring manager')
        self.assertEqual(ii.round_type('Delivery chat'), 'Other')  # "live" inside a word is not a live-coding round

    def test_only_reviewed_rows_and_their_review_are_read_never_the_transcript(self):
        rows = ONE + [interview('iv-x', 'Recruiter screen', '', '2026-09-21')]  # saved, not reviewed
        a, b = env()
        with a, b:
            fake = FakeNotion(rows, PAGES)
            items = ii.gather(of(fake), ii.reviewed_rows(of(fake)))
        self.assertEqual([i['id'] for i in items], ['iv-1'])
        item = items[0]
        self.assertEqual((item['label'], item['round_type'], item['company'], item['outcome']), ('I1', 'Technical', 'Acme', 'neutral'))
        self.assertEqual(item['summary'], 'Solid on Kubernetes, vague on databases.')
        self.assertEqual(item['weak_answers'], ['⚠️ [Postgres] Explain failover — Vague'])
        self.assertEqual(item['topics'], ['Kubernetes', 'Postgres'])
        self.assertNotIn('SECRET', json.dumps(ii.prompt_input(items)))

    def test_the_prompt_groups_interviews_by_round_type(self):
        items = [{'label': 'I1', 'round_type': 'Technical'}, {'label': 'I2', 'round_type': 'Recruiter screen'}]
        full = lambda i: dict(i, date='', round='', company='', job='', outcome='', topics=[], weak_topics=[], next_step='',
                              summary='', strengths=[], weak_spots=[], practice=[], signals=[], weak_answers=[])
        grouped = ii.prompt_input([full(i) for i in items])['by_round_type']
        self.assertEqual(list(grouped), ['Recruiter screen', 'Technical'])

    def test_the_fingerprint_changes_with_a_review_not_with_order(self):
        two = ONE + [interview('iv-2', 'Technical 2', 'negative', '2026-09-25')]
        self.assertEqual(ii.fingerprint(recs(None, two)), ii.fingerprint(recs(None, list(reversed(two)))))
        changed = [ONE[0], interview('iv-2', 'Technical 2', 'positive', '2026-09-25')]
        self.assertNotEqual(ii.fingerprint(recs(None, two)), ii.fingerprint(recs(None, changed)))


class Honesty(unittest.TestCase):
    def items(self, n):
        rows = [ONE[0], interview('iv-2', 'Technical 2', 'negative', '2026-09-25', app='app-1'),
                interview('iv-3', 'Recruiter screen', 'positive', '2026-09-26')][:n]
        a, b = env()
        with a, b:
            return ii.gather(of(FakeNotion(rows, PAGES)), recs(None, rows))

    def test_one_interview_is_tentative_with_low_confidence(self):
        result = {**RESULT, 'patterns': [{'round_type': 'Technical', 'pattern': 'Postgres failover lacks numbers',
                                          'evidence': [{'interview': 'I1', 'quote': 'Postgres failover answer lacked RTO numbers'}]}],
                  'next_steps': [{'action': 'Practise failover', 'interviews': ['I1']}]}
        stored = ii.validate(result, self.items(1))
        self.assertEqual(stored['interviews'], 1)
        self.assertEqual(stored['confidence'], 'low')
        self.assertTrue(all(p['tentative'] for p in stored['patterns']))

    def test_a_pattern_needs_two_interviews_and_evidence_must_be_quoted_from_the_review(self):
        stored = ii.validate(RESULT, self.items(3))
        self.assertEqual([p['text'] for p in stored['patterns']], ['Postgres failover answers lack numbers'])  # invented one dropped
        pattern = stored['patterns'][0]
        self.assertFalse(pattern['tentative'])
        self.assertEqual(pattern['interviews'], ['iv-1', 'iv-2'])
        self.assertEqual([s['text'] for s in stored['next_steps']], ['Practise a Postgres failover story with RTO numbers'])
        # With a single interview behind it, the same pattern is tentative.
        one = {**RESULT, 'patterns': [dict(RESULT['patterns'][0], evidence=RESULT['patterns'][0]['evidence'][:1])]}
        self.assertTrue(ii.validate(one, self.items(3))['patterns'][0]['tentative'])
        self.assertEqual(ii.validate(one, self.items(3))['confidence'], 'low')  # no pattern backed by 2 interviews

    def test_nothing_useful_says_so_briefly(self):
        stored = ii.validate({'nothing_useful': False, 'headline': 'x', 'confidence': 'high', 'patterns': [], 'next_steps': []}, self.items(2))
        self.assertTrue(stored['nothing_useful'])
        self.assertIn('Nothing to conclude yet', stored['headline'])


class Update(unittest.TestCase):
    def run_update(self, fake, client, **kw):
        a, b = env()
        with a, b:
            return ii.update(stores=open_stores(tracker=fake), client=client, now=NOW, budget_status=lambda t: {'level': 'ok'}, **kw)

    def test_first_run_creates_the_row_then_an_unchanged_set_never_spends_again(self):
        rows = [ONE[0], interview('iv-2', 'Technical 2', 'negative', '2026-09-25', app='app-1')]
        fake, client, stats = FakeNotion(rows, PAGES), FakeClient(RESULT), {}
        out = self.run_update(fake, client, stats=stats)
        self.assertEqual(out['status'], 'updated')
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0]['model'], interviews.DEFAULT_MODEL)  # the interview review's model
        self.assertGreater(stats['usd'], 0)
        self.assertEqual(len(fake.insights), 1)
        props = fake.insights[0]['properties']
        self.assertEqual(props['Category']['select']['name'], 'Interview patterns')
        self.assertEqual(props['Sample size']['number'], 2)
        data = json.loads(''.join(t['plain_text'] for t in props['Data']['rich_text']))
        self.assertEqual(data['patterns'][0]['interviews'], ['iv-1', 'iv-2'])

        again = self.run_update(fake, client)
        self.assertEqual(again['status'], 'unchanged')
        self.assertEqual(len(client.calls), 1)  # no second AI call for the same input
        self.assertEqual(len(fake.writes), 1)

    def test_a_new_review_updates_the_same_row(self):
        fake, client = FakeNotion(list(ONE), PAGES), FakeClient(RESULT)
        self.run_update(fake, client)
        fake.rows.append(interview('iv-2', 'Technical 2', 'negative', '2026-09-25'))
        self.assertEqual(self.run_update(fake, client)['status'], 'updated')
        self.assertEqual(len(fake.insights), 1)  # upserted, never a second row
        self.assertEqual([w[0] for w in fake.writes], ['POST', 'PATCH'])
        self.assertEqual(fake.insights[0]['properties']['Sample size']['number'], 2)

    def test_no_reviewed_interview_or_a_paused_budget_makes_no_call(self):
        client = FakeClient(RESULT)
        self.assertEqual(self.run_update(FakeNotion([interview('iv-x', 'Screen', '', '2026-09-21')], PAGES), client)['status'], 'none')
        a, b = env()
        with a, b:
            out = ii.update(stores=open_stores(tracker=FakeNotion(list(ONE), PAGES)), client=client, now=NOW, budget_status=lambda t: {'level': 'pause', 'pct': 0.93})
        self.assertEqual(out['status'], 'paused')
        self.assertEqual(client.calls, [])

    def test_a_failure_after_the_review_never_fails_the_review(self):
        broken = FakeClient(RESULT)
        broken.create = mock.Mock(side_effect=RuntimeError('boom'))
        a, b = env()
        with a, b, mock.patch.object(ii.budget, 'status', return_value={'level': 'ok'}):
            line = ii.after_review(stores=open_stores(tracker=FakeNotion(list(ONE), PAGES)), client=broken)
        self.assertIn('skipped', line)

    def test_saved_reads_the_row_for_the_app(self):
        fake = FakeNotion(list(ONE), PAGES)
        self.run_update(fake, FakeClient(RESULT))
        a, b = env()
        with a, b:
            shown = ii.saved(of(fake))
        self.assertEqual(shown['headline'], RESULT['headline'])
        self.assertEqual(shown['interviews'][0]['id'], 'iv-1')
        self.assertEqual(shown['sample'], 1)


class CardWords(unittest.TestCase):
    """What the redesigned card shows besides the sentences: a short title and icon kind per pattern, a title and keyword line
    per step, and a sentence under the headline. Older rows and answers without them still work."""

    def result(self):
        rich = json.loads(json.dumps(RESULT))
        rich['headline_detail'] = 'The same pattern showed in tenure and unblocking questions.'
        rich['patterns'][0].update(title='Answers become unstructured', kind='weakness')
        rich['next_steps'][0].update(title='Prepare three STAR stories', focus='Team unblocking • Manual intervention')
        return rich

    def stored(self, result):
        fake = FakeNotion(list(ONE), PAGES)
        a, b = env()
        with a, b:
            ii.update(stores=open_stores(tracker=fake), client=FakeClient(result), now=NOW, budget_status=lambda t: {'level': 'ok'})
            return ii.saved(of(fake))

    def test_the_new_words_are_stored_and_read_back(self):
        shown = self.stored(self.result())
        self.assertEqual(shown['headline_detail'], 'The same pattern showed in tenure and unblocking questions.')
        self.assertEqual((shown['patterns'][0]['title'], shown['patterns'][0]['kind']), ('Answers become unstructured', 'weakness'))
        self.assertEqual((shown['next_steps'][0]['title'], shown['next_steps'][0]['focus']),
                         ('Prepare three STAR stories', 'Team unblocking • Manual intervention'))

    def test_an_answer_without_them_still_stores_and_an_unknown_kind_is_a_plain_note(self):
        shown = self.stored(RESULT)
        self.assertEqual(shown['headline_detail'], '')
        self.assertEqual((shown['patterns'][0]['title'], shown['patterns'][0]['kind']), ('', 'note'))
        odd = self.result()
        odd['patterns'][0]['kind'] = 'catastrophe'
        self.assertEqual(self.stored(odd)['patterns'][0]['kind'], 'note')

    def test_the_model_is_asked_for_them(self):
        for name in ('headline_detail',):
            self.assertIn(name, ii.SCHEMA['required'])
        self.assertIn('title', ii.SCHEMA['properties']['patterns']['items']['required'])
        self.assertIn('kind', ii.SCHEMA['properties']['patterns']['items']['required'])
        self.assertIn('focus', ii.SCHEMA['properties']['next_steps']['items']['required'])


class OlderRows(unittest.TestCase):
    """An insight saved before the card's new words (titles, kinds, keyword lines) is regenerated once on Refresh, even when no
    review changed, so it fills them in; after that an unchanged set never spends again."""

    def test_saved_says_which_version_the_insight_is(self):
        fake, client = FakeNotion(list(ONE), PAGES), FakeClient(RESULT)
        a, b = env()
        with a, b:
            ii.update(stores=open_stores(tracker=fake), client=client, now=NOW, budget_status=lambda t: {'level': 'ok'})
            self.assertEqual(ii.saved(of(fake))['version'], ii.DATA_VERSION)
            data = json.loads(''.join(t['plain_text'] for t in fake.insights[0]['properties']['Data']['rich_text']))
            del data['v']
            fake.insights[0]['properties']['Data'] = {'type': 'rich_text', 'rich_text': [{'plain_text': json.dumps(data)}]}
            self.assertEqual(ii.saved(of(fake))['version'], 1)

    def test_a_row_without_the_new_words_is_regenerated_once(self):
        fake, client = FakeNotion(list(ONE), PAGES), FakeClient(RESULT)
        a, b = env()
        with a, b:
            ii.update(stores=open_stores(tracker=fake), client=client, now=NOW, budget_status=lambda t: {'level': 'ok'})
            data = json.loads(''.join(t['plain_text'] for t in fake.insights[0]['properties']['Data']['rich_text']))
            self.assertEqual(data['v'], ii.DATA_VERSION)
            del data['v']  # as saved before the card was redesigned
            fake.insights[0]['properties']['Data'] = {'type': 'rich_text', 'rich_text': [{'plain_text': json.dumps(data)}]}
            again = ii.update(stores=open_stores(tracker=fake), client=client, now=NOW, budget_status=lambda t: {'level': 'ok'})
            self.assertEqual((again['status'], len(client.calls)), ('updated', 2))
            self.assertEqual(ii.update(stores=open_stores(tracker=fake), client=client, now=NOW, budget_status=lambda t: {'level': 'ok'})['status'], 'unchanged')
            self.assertEqual(len(client.calls), 2)  # no third call


if __name__ == '__main__':
    unittest.main()
