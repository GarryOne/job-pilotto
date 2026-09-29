"""Interview prep kit: asks for the role when it's unknown, then builds a kit on the job's page (src/ai/prep.py)."""
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from src.ai import prep

NOW = datetime(2026, 9, 29, 14, 0, tzinfo=timezone.utc)
INVITE = """## 🤝 Recruiter message
Subject: Connect Igor / Jaya - SRE
Microsoft Teams meeting
Join: https://teams.microsoft.com/meet/314
Meeting ID: 314 743 971 982 217
Passcode: bJ6Np22T"""
ROLE = """## 🧾 Job description
Principal SRE for a global AI company, remote. You own the reliability of large AWS and Kubernetes platforms that
serve model training and inference, lead incident management and postmortems, and build the observability stack.
Hands-on: Terraform, ArgoCD, Kafka, Prometheus and Grafana. You mentor a team of five SREs and work closely with the
ML platform engineers on capacity planning, SLOs and on-call. Experience running large production systems is a must."""


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def job(page_text):
    row = {'id': 'h1', 'properties': {'Job': {'type': 'title', 'title': [{'plain_text': 'Principal SRE'}]}, 'Company': text(''),
                                      'Via': text('Huxley'), 'Contact': text('Jayantie Nejati'), 'Salary': text(''),
                                      'Stage': {'type': 'select', 'select': {'name': 'Interview scheduled'}},
                                      'Next interview': {'type': 'date', 'date': {'start': '2026-09-30T08:30:00+02:00'}},
                                      'Job URL': {'type': 'url', 'url': 'https://mail.google.com/mail/u/0/#all/h1'}}}
    tracker = SimpleNamespace(written=[], updates=[], page_text=lambda page_id='profile': page_text if page_id == 'h1' else 'Igor: 10 years, SRE at Sonar',
                              replace_after_heading=lambda *a: tracker.written.append(a), update_page=lambda *a: tracker.updates.append(a))
    return tracker, row


KIT = {'interview_type': 'recruiter screen', 'assess': ['motivation'], 'questions': [{'question': 'Why this role?', 'answer_with': 'Sonar SRE work'}],
       'stories': ['Incident at Sonar'], 'gaps': [], 'ask_them': ['Who is the client?'], 'plan': ['Read the description'], 'unknowns': ['salary']}


class Client:
    def __init__(self):
        self.messages, self.calls = self, []

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(KIT))],
                               usage=SimpleNamespace(input_tokens=4000, output_tokens=900, cache_read_input_tokens=0, cache_creation_input_tokens=0))


class PrepTests(unittest.TestCase):
    def test_an_invite_alone_is_not_a_role_it_asks_for_the_description(self):
        tracker, row = job(INVITE)
        client = Client()
        result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['needs_description'])
        self.assertEqual(client.calls, [])  # nothing spent

    def test_with_the_description_it_builds_the_kit_on_the_job(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        client = Client()
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {'Kafka tuning': 2}}):
            result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['ok'], result)
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('Kafka tuning', prompt)
        self.assertIn('ArgoCD', prompt)
        self.assertIn('16 h from now', prompt)  # Wed 08:30 CEST = 06:30 UTC
        heading, blocks = tracker.written[0][1], tracker.written[0][2]
        self.assertEqual(heading, prep.HEADING)
        self.assertIn('Still unknown: ask the recruiter', [b[b['type']]['rich_text'][0]['text']['content'] for b in blocks if b['type'] == 'heading_3'])
        self.assertEqual(tracker.updates[0][1], {'Interview prep': {'date': {'start': '2026-09-29'}}})

    def test_a_pasted_description_is_saved_on_the_job(self):
        tracker, row = job(INVITE)
        self.assertTrue(prep.describe(tracker, row, text=ROLE.split('\n', 1)[1])['ok'])
        self.assertEqual(tracker.written[0][1], prep.DESCRIPTION_HEADING)
        self.assertFalse(prep.describe(tracker, row, text='SRE role')['ok'])


if __name__ == '__main__':
    unittest.main()
