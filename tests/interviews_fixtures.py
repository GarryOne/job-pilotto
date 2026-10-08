"""Shared fakes and fixtures of the interview tests (tests/test_interviews_*.py): a fake Notion, a fake model client,
the Huxley recruiter call, its reviews and facts. Guards src/ai/interviews*.py."""
import io
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import interviews; from tests.model_stand_ins import screens as setUpModule  # noqa: E702,F401 (the model's answer)
from src.notion import ledger
from src.notion.ledger import plain

NOW = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)
SRT = """1
00:00:01,000 --> 00:00:04,000
<v Interviewer>How do you handle a Kubernetes upgrade?

2
00:00:04,500 --> 00:00:09,000
We drain nodes one pool at a time and watch error budgets.

3
00:00:09,500 --> 00:00:12,000
We drain nodes one pool at a time and watch error budgets.
"""
SPOKEN = ('[00:00:01] Speaker 1: How do you handle a Kubernetes upgrade?\n'
          '[00:00:04] You: We drain nodes one pool at a time and watch error budgets.')
RESULT = {'application': 1, 'company': 'Grafana Labs', 'round': 'Technical 1', 'interviewers': ['SRE manager'],
          'duration_min': 45, 'questions': [
              {'topic': 'Kubernetes upgrades', 'question': 'How do you upgrade?', 'answer': 'Drain pools', 'quality': 'strong', 'better': ''},
              {'topic': 'Postgres replication', 'question': 'Explain failover', 'answer': 'Vague', 'quality': 'weak',
               'better': 'Mention Patroni and your RTO numbers'}],
          'strengths': ['Clear upgrade process'], 'weaknesses': ['Database depth'], 'signals': ['Team of 6'],
          'red_flags': [], 'next_step': 'System design next week', 'practice': ['Postgres HA'], 'overall': 'positive',
          'summary': 'Went well overall.'}


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app(page_id, company, stage, applied):
    return {'id': page_id, 'properties': {'Company': text(company), 'Job': {'type': 'title', 'title': [{'plain_text': 'SRE'}]},
                                          'Stage': {'type': 'select', 'select': {'name': stage}},
                                          'Applied on': {'type': 'date', 'date': {'start': applied}},
                                          'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, apps):
        self.apps, self.requests, self.updates, self.created = apps, [], [], []

    def query_database(self, database_id, filter_=None):
        if database_id == ledger.EVENTS_DATABASE_ID:
            return getattr(self, 'events', [])
        return self.apps

    def page_text(self):
        return 'SRE at Acme; Kubernetes, AWS.'

    def _request(self, method, path, body):
        self.requests.append(body)
        return {'id': 'interview-1', 'url': 'https://notion.test/interview-1'}

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': 'event'}

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))


def rich(value):
    return [{'type': 'text', 'plain_text': value, 'text': {'content': value}}]


class NotionPages(FakeTracker):
    """Pages and blocks kept in memory, answering the Notion calls save/review make."""

    def __init__(self, apps):
        super().__init__(apps)
        self.pages, self.blocks, self.count = {}, {}, 0

    @staticmethod
    def _stored(block):  # what Notion returns: plain_text on every rich text
        kind = block['type']
        body = dict(block[kind], rich_text=[{**t, 'plain_text': t['text']['content']} for t in block[kind]['rich_text']])
        return {'type': kind, kind: body, 'children': body.pop('children', [])}

    def query_database(self, database_id, filter_=None):
        if database_id == interviews.INTERVIEWS_DATABASE_ID:
            return [dict(page, properties={k: {**v, 'type': next(iter(v))} | ({'title': rich(v['title'][0]['text']['content'])}
                                                                               if 'title' in v else {}) for k, v in page['properties'].items()})
                    for page in self.pages.values()]
        if filter_ and filter_.get('property') == 'Job URL':
            return [a for a in self.apps if a['properties']['Job URL']['url'] == filter_['url']['equals']]
        return super().query_database(database_id, filter_)

    def _request(self, method, path, body=None):
        if method == 'POST' and path == 'pages':
            self.requests.append(body)
            self.count += 1
            page_id = f'iv-{self.count}'
            self.pages[page_id] = {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': dict(body['properties'])}
            self.blocks[page_id] = []
            for i, block in enumerate(body.get('children', [])):
                stored = self._stored(block)
                stored['id'] = f'{page_id}-b{i}'
                self.blocks[stored['id']] = [dict(self._stored(c), id=f'{stored["id"]}-c{j}') for j, c in enumerate(stored.pop('children'))]
                self.blocks[page_id].append(stored)
            return self.pages[page_id]
        if method == 'GET' and path.startswith('pages/'):
            page_id = path.split('/')[1]
            if page_id in self.pages:
                props = self.pages[page_id]['properties']
                return {'id': page_id, 'properties': {k: dict(v, type=next(iter(v))) | ({'title': rich(v['title'][0]['text']['content'])}
                                                                                       if 'title' in v else {}) for k, v in props.items()}}
            return next(a for a in self.apps if a['id'] == page_id)
        if method == 'PATCH' and path.startswith('pages/') and body.get('archived'):
            self.archived = getattr(self, 'archived', []) + [path.split('/')[1]]
            return {}
        if method == 'PATCH' and path.startswith('pages/'):
            page = self.pages[path.split('/')[1]]
            page['properties'].update(body['properties'])
            return page
        if method == 'PATCH' and path.endswith('/children'):
            page_id = path.split('/')[1]
            self.added = getattr(self, 'added', 0) + len(body['children'])
            new = [dict(self._stored(b), id=f'new-{self.added}-{i}') for i, b in enumerate(body['children'])]
            at = next(i for i, b in enumerate(self.blocks[page_id]) if b['id'] == body['after']) + 1 if 'after' in body else None
            if at is None:
                self.blocks[page_id] += new
            else:
                self.blocks[page_id][at:at] = new
            return {}
        if method == 'PATCH' and path.startswith('blocks/') and not path.endswith('/children'):
            block_id = path.split('/')[1]
            for children in self.blocks.values():
                for b in children:
                    if b.get('id') == block_id:
                        b[b['type']] = self._stored({'type': b['type'], b['type']: body[b['type']]})[b['type']]
            return {}
        if method == 'DELETE' and path.startswith('blocks/'):
            block_id = path.split('/')[1]
            for children in self.blocks.values():
                children[:] = [b for b in children if b.get('id') != block_id]
            return {}
        raise AssertionError(f'unexpected {method} {path}')

    def _children(self, block_id):
        return self.blocks.get(block_id, [])

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))
        if page_id in self.pages:
            self.pages[page_id]['properties'].update(properties)


class FakeClient:
    def __init__(self):
        self.calls, self.messages = [], self

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(RESULT))],
                               usage=SimpleNamespace(input_tokens=15000, output_tokens=2000,
                                                     cache_read_input_tokens=0, cache_creation_input_tokens=0))


def opener_for(name, body):
    def opener(url, timeout=None):
        if 'getFile' in url:
            return io.BytesIO(json.dumps({'ok': True, 'result': {'file_path': f'documents/{name}'}}).encode())
        return io.BytesIO(body.encode())
    return opener


def huxley(stage='Interview scheduled', **props):
    """The owner's case (30 Sep 2026): an agency's call, booked, held and reviewed."""
    row = app('h-1', '', stage, '')
    row['properties'].update({'Via': text('Huxley'), 'Location': text('Remote'),
                              'Next interview': {'type': 'date', 'date': {'start': '2026-09-26T06:30:00.000Z'}}})
    row['properties'].update(props)
    return row


FACTS = [{'field': 'salary', 'value': 'CHF 160-180k/year', 'quote': 'the band is 160 to 180 thousand francs'},
         {'field': 'contract', 'value': 'b2b / contractor', 'quote': 'it would be a B2B contract'},
         {'field': 'location', 'value': 'Hybrid, Zurich 2 days', 'quote': 'two days a week in Zurich'},
         {'field': 'work_mode', 'value': 'Remote', 'quote': 'mostly remote'},
         {'field': 'relocation', 'value': 'Not stated', 'quote': ''},
         {'field': 'team_size', 'value': '8 SREs', 'quote': 'a team of eight SREs'},
         {'field': 'salary_ask', 'value': 'CHF 170k', 'quote': 'I am looking at 170'},
         {'field': 'work_mode', 'value': 'Hybrid', 'quote': 'twice the same field: the first wins'}]


HUXLEY_CALL = """[00:00:03] Speaker 1: Thanks for joining. This is for a Principal SRE role with our client, in finance. I can't name them yet.
[00:00:12] You: Sure. What can you tell me about them?
[00:00:15] Speaker 1: Headquarters in Greece, about 500 people, and they are opening a US office. On-call is follow the sun.
[00:00:31] Speaker 1: The budget is around 100 to 150 thousand euros a year, maximum.
[00:00:40] Speaker 1: They don't sponsor visas or relocation. It can be B2B or an employer of record in Switzerland, or you stay in Romania.
[00:00:58] Speaker 1: It's hands-on, really a senior-level SRE day to day.
[00:01:10] Speaker 1: I'd like another call to go through salary, the setup and relocation."""
QUESTIONS = [{'topic': 'Motivation', 'question': 'Why this role?', 'answer': 'Hands-on reliability work', 'quality': 'ok',
              'better': 'Tie it to finance-grade on-call'}]
FIRST_REVIEW = dict(RESULT, application=0, company='', round='Recruiter screen', questions=QUESTIONS, next_step='not stated',
                    overall='neutral', summary='A first screen for an unnamed finance client.')  # no 'facts': before 67484d8
HUXLEY_FACTS = [
    {'field': 'salary', 'value': 'EUR 100-150k/year (max)', 'quote': 'around 100 to 150 thousand euros a year, maximum'},
    {'field': 'contract', 'value': 'Employee or B2B', 'quote': 'It can be B2B or an employer of record in Switzerland'},
    {'field': 'location', 'value': 'Switzerland (EOR) or Romania', 'quote': 'in Switzerland, or you stay in Romania'},
    {'field': 'visa', 'value': 'No visa sponsorship', 'quote': "They don't sponsor visas or relocation"},
    {'field': 'relocation', 'value': 'No relocation support', 'quote': "They don't sponsor visas or relocation"},
    {'field': 'company_size', 'value': 'About 500 people', 'quote': 'about 500 people'}]
AGAIN_REVIEW = dict(FIRST_REVIEW, company='unnamed finance client', facts=HUXLEY_FACTS,
                    next_step='Another call about salary, setup and relocation',
                    summary='A screen for a finance client (HQ Greece, US office opening); hands-on senior SRE work.')


class ResultClient(FakeClient):
    def __init__(self, result=None, error=None):
        super().__init__()
        self.result, self.error = result, error

    def create(self, **params):
        self.calls.append(params)
        if self.error:
            raise self.error
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.result))],
                               usage=SimpleNamespace(input_tokens=15000, output_tokens=2000,
                                                     cache_read_input_tokens=0, cache_creation_input_tokens=0))


class LiveApps(NotionPages):
    """Applications and events that change as Notion's would, so a second run sees the first run's writes
    (the events database gets an id of its own: in tests every database id is empty)."""

    def query_database(self, database_id, filter_=None):
        if database_id == 'events-db':
            return getattr(self, 'events', [])
        return super().query_database(database_id, filter_)

    def update_page(self, page_id, properties):
        super().update_page(page_id, properties)
        for row in self.apps:
            if row['id'] == page_id:
                for name, value in properties.items():
                    kind = next(iter(value))
                    row['properties'][name] = (text(value['rich_text'][0]['text']['content']) if kind == 'rich_text'
                                               else {'type': kind, kind: value[kind]})

    def create_page(self, database_id, properties):
        self.events = getattr(self, 'events', []) + [{'id': f'e-{len(self.created)}', 'properties': {
            name: {'type': next(iter(value)), **value} for name, value in properties.items()}}]
        return super().create_page(database_id, properties)


def headings(tracker, page_id):
    return [interviews._plain_block(b) for b in tracker.blocks[page_id] if b['type'] == 'heading_3']
