"""The inbox triage (src/ai/mail_triage.py): any new inbox email no sender search found is judged job-related or not by a small model, in
any language, from sender + subject + snippet only; a no is remembered, a failed call judges nothing."""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail_triage  # noqa: E402


class FakeGoogle:
    def __init__(self, inbox):
        self.inbox, self.queries, self.read = inbox, [], []

    def search(self, query, limit=50):
        self.queries.append(query)
        return list(self.inbox)

    def snippet(self, message_id):
        self.read.append(message_id)
        return {'id': message_id, **self.inbox[message_id]}


class FakeClient:
    def __init__(self, jobs, error=None):
        self.jobs, self.error, self.calls = jobs, error, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        results = [{'index': i, 'job': i in self.jobs} for i in range(kwargs['messages'][0]['content'].count('### Email'))]
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'results': results}))])


INBOX = {'pt': {'from': 'rh@empresa.pt', 'subject': 'A sua candidatura', 'snippet': 'Obrigado pelo interesse. Infelizmente'},
         'de': {'from': 'hr@firma.de', 'subject': 'Ihre Bewerbung', 'snippet': 'Leider müssen wir Ihnen mitteilen'},
         'shop': {'from': 'news@shop.example', 'subject': 'Oferta -20%', 'snippet': 'Só hoje'},
         'known': {'from': 'no-reply@greenhouse-mail.io', 'subject': 'x', 'snippet': ''},
         'old': {'from': 'a@b.c', 'subject': 'seen before', 'snippet': ''}}


class TriageTests(unittest.TestCase):
    def test_any_language_is_judged_by_claude_from_sender_subject_and_snippet_only(self):
        google, client = FakeGoogle(INBOX), FakeClient(jobs={0, 1})
        job, other = mail_triage.new_from_inbox(google, client, 3, known={'known'}, seen={'old'})
        self.assertEqual((job, other), (['pt', 'de'], ['shop']))
        self.assertEqual(google.read, ['pt', 'de', 'shop'], 'known senders and seen emails are not judged again')
        self.assertEqual(google.queries, ['newer_than:3d in:inbox -in:chats -category:promotions -category:social -category:forums'])
        sent = client.calls[0]['messages'][0]['content']
        self.assertIn('A sua candidatura', sent)
        self.assertNotIn('subject:', google.queries[0], 'no words decide what is fetched')
        self.assertEqual(client.calls[0]['model'], mail_triage.MODEL)
        self.assertIn('untrusted', client.calls[0]['system'][0]['text'])

    def test_a_failed_call_judges_nothing_so_the_next_check_reads_them(self):
        job, other = mail_triage.new_from_inbox(FakeGoogle(INBOX), FakeClient(set(), error=RuntimeError('down')), 3, set(), set())
        self.assertEqual((job, other), ([], []))

    def test_a_mail_client_without_the_light_read_skips_the_triage(self):
        google = SimpleNamespace(search=lambda query, limit=50: list(INBOX))   # an older client (or a test fake) with no snippet()
        self.assertEqual(mail_triage.new_from_inbox(google, FakeClient({0}), 3, set(), set()), ([], []))

class SubjectSearchTests(unittest.TestCase):
    def test_the_subject_words_search_every_folder_as_before(self):
        """8 Oct 2026 (a regression check): an English "Your application" archived or in Promotions is still found."""
        from unittest import mock
        with mock.patch.object(mail_triage, 'role_words', lambda: ('site reliability',)):
            q = mail_triage.subject_query(2)
        for part in ('subject:"application"', 'subject:"interview"', 'subject:"site reliability"', 'subject:"SRE"'):
            self.assertIn(part, q)
        self.assertNotIn('in:inbox', q)


if __name__ == '__main__':
    unittest.main()
