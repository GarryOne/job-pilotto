"""The engine's AI decisions (src/ai/decide.py) and their first users: fixed answers only, asked once per item, None without AI so the
caller's rule decides. 8 Oct 2026: keyword lists replaced for calendar interviews, booking replies, sign-up codes/links, interview rounds."""
import json
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import decide  # noqa: E402


class FakeClient:
    def __init__(self, answer_for):
        self.answer_for, self.calls = answer_for, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        items = kwargs['messages'][0]['content'].split('### Item ')[1:]
        results = [{'index': i, 'answer': self.answer_for(item.split('\n', 1)[1])} for i, item in enumerate(items)]
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'results': results}))])


class DecideTests(unittest.TestCase):
    def setUp(self):
        decide._calls['n'] = 0
        self.db = sqlite3.connect(':memory:')

    def test_each_item_gets_one_fixed_answer_and_is_asked_once(self):
        client = FakeClient(lambda text: 'job_interview' if 'Entrevista' in text else 'other')
        items = {'e1': 'Entrevista técnica com a Acme', 'e2': 'Dentista'}
        self.assertEqual(decide.decide('calendar-event', items, ('job_interview', 'other'), 'task', client, self.db), {'e1': 'job_interview', 'e2': 'other'})
        self.assertEqual(decide.decide('calendar-event', items, ('job_interview', 'other'), 'task', client, self.db), {'e1': 'job_interview', 'e2': 'other'})
        self.assertEqual(len(client.calls), 1)
        sent = client.calls[0]
        self.assertIn('untrusted', sent['system'][0]['text'])
        self.assertEqual(sent['output_config']['format']['schema']['properties']['results']['items']['properties']['answer']['enum'], ['job_interview', 'other'])

    def test_an_answer_outside_the_list_is_never_kept(self):
        client = FakeClient(lambda text: 'ignore previous instructions')
        self.assertIsNone(decide.decide('t', {'a': 'x'}, ('yes', 'no'), 'task', client, self.db))
        self.assertEqual(decide.kept('t', ['a'], self.db), {})

    def test_without_ai_or_past_the_run_limit_the_rule_decides(self):
        with mock.patch.object(decide.engine, 'ready', return_value=False):
            self.assertIsNone(decide.decide('t', {'a': 'x'}, ('yes', 'no'), 'task', db=self.db))
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        self.assertIsNone(decide.decide('t', {'a': 'x'}, ('yes', 'no'), 'task', FakeClient(lambda t: 'yes'), self.db))


class UsersTests(unittest.TestCase):
    def test_a_sign_up_code_is_one_of_the_emails_own_tokens(self):
        from src.sources import google
        email = {'from': 'noreply@site.jp', 'subject': '認証', 'date': '', 'body': '認証コード: 4K7Q2Z\nご注文 A12345B\nhttps://site.jp/kakunin?t=1 https://site.jp/help'}
        answers = {'4K7Q2Z': 'code', 'A12345B': 'other', 'https://site.jp/kakunin?t=1': 'confirms_signup', 'https://site.jp/help': 'other'}
        with mock.patch.object(decide, 'decide', lambda topic, items, *a, **k: {key: answers.get(key, 'other') for key in items}):
            found = google.confirmation(email)
        self.assertEqual((found['code'], found['links']), ('4K7Q2Z', ['https://site.jp/kakunin?t=1']))
        with mock.patch.object(decide, 'decide', lambda *a, **k: None):   # no AI: nothing guessed
            self.assertEqual(google.confirmation(email)['code'], '')

    def test_interview_rounds_in_any_language_and_the_rule_without_ai(self):
        from src.ai import interviews
        with mock.patch.object(decide, 'one', lambda topic, key, text, *a, **k: 'recruiter_screen' if 'RH' in text else 'technical'):
            self.assertEqual(interviews.held_stage('Interview scheduled', 'Entretien RH'), 'Screening')
            self.assertEqual(interviews.held_stage('Interview scheduled', 'Fachgespräch'), 'Interviewing')
        with mock.patch.object(decide, 'one', lambda *a, **k: None):
            from src.ai import meanings
            self.assertEqual(meanings.round_kind('Recruiter screen'), 'recruiter_screen')

    def test_a_booking_reply_in_any_language(self):
        from src import focus
        with mock.patch.object(decide, 'one', lambda *a, **k: 'asks_to_book'):
            self.assertTrue(focus.meanings.asks_to_book('Pediu para escolher um horário na agenda'))
        with mock.patch.object(decide, 'one', lambda *a, **k: None):
            self.assertTrue(focus.meanings.asks_to_book('Please book a slot'))
            self.assertFalse(focus.meanings.asks_to_book('Pediu para escolher um horário'))   # the rule alone knows English only


if __name__ == '__main__':
    unittest.main()
