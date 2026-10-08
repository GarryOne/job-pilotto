"""Shared fakes for the Gmail-check tests (tests/test_mail*.py): tracker, Google, model client and the row/email builders.
Imported by test_mail*.py and by test_feedback, test_follow_up, test_inbox, test_opportunity, test_rejection."""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail
from src.notion import ledger


NOW = datetime(2026, 9, 26, 16, 0, tzinfo=timezone.utc)  # 18:00 in Zurich


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app(page_id, company, job, stage='Applied', via='', contact='', applied='2026-09-26'):
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': {
        'Company': text(company), 'Job': {'type': 'title', 'title': [{'plain_text': job}]},
        'Stage': {'type': 'select', 'select': {'name': stage}}, 'Via': text(via), 'Contact': text(contact),
        'Applied on': {'type': 'date', 'date': {'start': applied}}, 'Next step': text(''),
        'Next interview': {'type': 'date', 'date': None}, 'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}}


def event_row(page_id, kind, at, source_id=''):
    return {'id': f'ev-{kind}-{at}', 'properties': {
        'Kind': {'type': 'select', 'select': {'name': kind}}, 'At': {'type': 'date', 'date': {'start': at}},
        'Source ID': text(source_id), 'Application': {'type': 'relation', 'relation': [{'id': page_id}]}}}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, apps, events=()):
        self.apps, self.events, self.created, self.updates = apps, list(events), [], []

    def query_database(self, database_id, filter_=None):
        if database_id == ledger.EVENTS_DATABASE_ID:
            return self.events
        if database_id == 'interviews' or 'Interviews' in str(database_id):
            return []
        return self.apps if database_id == 'apps' else []

    def create_page(self, database_id, properties):
        self.created.append(properties)
        return {'id': f'new-{len(self.created)}'}

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))


class FakeGoogle:
    def __init__(self, emails=(), events=()):
        self.emails, self.cal, self.queries = {e['id']: e for e in emails}, list(events), []

    def search(self, query, limit=50):
        self.queries.append(query)
        return list(self.emails)

    def message(self, message_id):
        return self.emails[message_id]

    def events(self, start, end):
        return self.cal


class FakeClient:
    def __init__(self, results):
        self.results, self.calls, self.messages = results, [], self

    def create(self, **params):
        self.calls.append(params)
        answer = {'results': self.results.pop(0)}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))],
                               usage=SimpleNamespace(input_tokens=3000, output_tokens=300, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


def email(message_id, subject, date='2026-09-26T09:00:00+02:00', sender='no-reply@us.greenhouse-mail.io', body='Hello Sam ...'):
    return {'id': message_id, 'from': sender, 'to': 'me', 'subject': subject, 'date': date, 'body': body}


def result(index, application, kind, summary='s', relevant=True, interview_at='', company='Acme'):
    return {'index': index, 'relevant': relevant, 'application': application, 'company': company, 'kind': kind,
            'interview_at': interview_at, 'summary': summary}


class MailCase(unittest.TestCase):
    """setUp, tearDown and run_mail shared by the Gmail-check test classes."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state.json'

    def tearDown(self):
        self.tmp.cleanup()

    def run_mail(self, tracker, google, results, calendar=False):
        sent = []
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {'Postgres': 2}}):
            summary = mail.run(tracker, google, client=FakeClient(results), days=2, send=sent.append, calendar=calendar,
                               now=NOW, state_path=self.state, stats={})
        return summary, sent
