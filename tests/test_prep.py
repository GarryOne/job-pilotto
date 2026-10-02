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
    tracker = SimpleNamespace(written=[], updates=[], requests=[], page_text=lambda page_id='profile': page_text if page_id == 'h1' else 'Igor: 10 years, SRE at Acme',
                              replace_after_heading=lambda *a: tracker.written.append(a), update_page=lambda *a: tracker.updates.append(a),
                              _children=lambda block_id: [], _request=lambda *a: tracker.requests.append(a))
    return tracker, row


def kit_written(tracker):
    """The blocks the last kit write added to the job's page."""
    return [r for r in tracker.requests if r[0] == 'PATCH'][-1][2]['children']


KIT = {'interview_type': 'recruiter screen', 'assess': ['motivation'], 'questions': [{'question': 'Why this role?', 'answer_with': 'Acme SRE work'}],
       'stories': ['Incident at Acme'], 'gaps': [], 'ask_them': ['Who is the client?'], 'plan': ['Read the description'], 'unknowns': ['salary']}


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
        tracker._children = lambda block_id: []  # no screenshots on the page either
        client = Client()
        result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['needs_description'])
        self.assertEqual(client.calls, [])  # nothing spent

    def test_with_the_description_it_builds_the_kit_on_the_job(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        tracker.database_id = 'apps'
        past = {'id': 'r1', 'last_edited_time': '2026-09-20', 'properties': {'Company': text('Grafana Labs'), 'Via': text(''),
                'Rejection lesson': text('Lead with incident stories that show the outcome'), 'Employer feedback': text('')}}
        tracker.query_database = lambda db, filter_=None: [past]
        client = Client()
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {'Kafka tuning': 2}, 'topics_asked': {'SLOs': 3}}):
            result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['ok'], result)
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('Kafka tuning', prompt)
        self.assertIn('Topics interviewers asked most: SLOs', prompt)
        self.assertIn('Grafana Labs: Lead with incident stories that show the outcome', prompt)  # what it learned from you
        self.assertIn('ArgoCD', prompt)
        self.assertIn('16 h from now', prompt)  # Wed 08:30 CEST = 06:30 UTC
        blocks = kit_written(tracker)
        self.assertEqual(blocks[0]['heading_2']['rich_text'][0]['text']['content'], prep.HEADING)  # a new section
        self.assertIn('Still unknown: ask the recruiter', [b[b['type']]['rich_text'][0]['text']['content'] for b in blocks if b['type'] == 'heading_3'])
        self.assertNotIn('What already happened on THIS application', prompt)  # no earlier interview: a first-round kit
        # With the time: Focus compares it with the interviews reviewed since.
        self.assertEqual(tracker.updates[0][1], {'Interview prep': {'date': {'start': '2026-09-29T14:00:00+00:00'}}})

    def test_screenshots_logged_on_the_job_are_read_instead_of_asking(self):
        # 29 Sep 2026: the Huxley chat was logged as 4 images before the Log box kept its text; the kit asked anyway.
        tracker, row = job(INVITE)
        folded = {'id': 'log1', 'type': 'toggle', 'has_children': True}
        image = lambda n: {'id': f'i{n}', 'type': 'image', 'image': {'type': 'file', 'file': {'url': f'https://files.test/{n}.png'}}}
        tracker._children = lambda block_id: [image(1), folded] if block_id == 'h1' else [image(2)]
        read = ROLE.split('\n', 1)[1]

        class Reads(Client):
            def create(self, **params):
                if params['model'] == prep.READ_MODEL:
                    self.calls.append(params)
                    return SimpleNamespace(content=[SimpleNamespace(type='text', text=read)],
                                           usage=SimpleNamespace(input_tokens=5000, output_tokens=300, cache_read_input_tokens=0, cache_creation_input_tokens=0))
                return super().create(**params)

        class Image:
            headers = {'Content-Type': 'image/png'}
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'png'
        client = Reads()
        with mock.patch('urllib.request.urlopen', lambda url, timeout=30: Image()), \
                mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['ok'], result)
        self.assertEqual(len([b for b in client.calls[0]['messages'][0]['content'] if b['type'] == 'image']), 2)  # both, the folded one too
        self.assertEqual(tracker.written[0][1], prep.DESCRIPTION_HEADING)  # kept as the job's description
        self.assertIn('ArgoCD', client.calls[1]['messages'][0]['content'])

    def test_a_cut_off_answer_says_so_and_writes_nothing(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        tracker.database_id = 'apps'
        tracker.query_database = lambda db, filter_=None: []
        client = Client()
        cut = SimpleNamespace(content=[SimpleNamespace(type='text', text='{"interview_type": "technical", "assess": ["SL')],
                              usage=SimpleNamespace(input_tokens=4000, output_tokens=8000, cache_read_input_tokens=0, cache_creation_input_tokens=0),
                              stop_reason='max_tokens')
        client.create = lambda **params: cut
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {}):
            with self.assertRaisesRegex(RuntimeError, 'cut off'):
                prep.build(tracker, row, client=client, now=NOW)
        self.assertEqual(tracker.written, [])

    def test_a_pasted_description_is_saved_on_the_job(self):
        tracker, row = job(INVITE)
        self.assertTrue(prep.describe(tracker, row, text=ROLE.split('\n', 1)[1])['ok'])
        self.assertEqual(tracker.written[0][1], prep.DESCRIPTION_HEADING)
        self.assertFalse(prep.describe(tracker, row, text='SRE role')['ok'])


def read_block(block_id, kind, value):
    """A block as Notion returns it (plain_text), for a page's children."""
    return {'id': block_id, 'type': kind, kind: {'rich_text': [{'plain_text': value, 'annotations': {'bold': False}}]}}


def interview_row(page_id, app_id, day, round_, overall='positive', next_step='', weak='', created=None):
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'created_time': created or f'{day}T12:00:00.000Z',
            'properties': {'Date': {'type': 'date', 'date': {'start': day}}, 'Round': text(round_),
                           'Overall': {'type': 'select', 'select': {'name': overall} if overall else None},
                           'Next step': text(next_step), 'Weak topics': text(weak),
                           'Application': {'type': 'relation', 'relation': [{'id': app_id}]}}}


# The Huxley recruiter screen on 30 Sep 2026, as its review sits on the 🎤 Interviews page (interviews.analysis_blocks).
REVIEW = [read_block('b0', 'paragraph', '🔗 Job: Huxley · Principal SRE'),
          read_block('b1', 'paragraph', 'Friendly recruiter screen; motivation and remote setup went well, salary was left open.'),
          read_block('b2', 'heading_3', 'Signals from them'),
          read_block('b3', 'bulleted_list_item', 'Next call covers salary band and the contract setup (B2B via Huxley)'),
          read_block('b4', 'heading_3', 'Facts from the call'),
          read_block('b5', 'bulleted_list_item', 'Relocation: not needed, fully remote'),
          read_block('b6', 'heading_3', 'Questions'),
          read_block('b7', 'bulleted_list_item', '⚠️ [Salary] What are your expectations? — vague range → Better: give a number'),
          read_block('b8', 'bulleted_list_item', '✅ [Motivation] Why this role? — AI infra'),
          read_block('b9', 'heading_3', 'Transcript')]


class FollowUpTests(unittest.TestCase):
    def setUp(self):
        from src.ai import interviews
        from src.notion import ledger
        patches = [mock.patch.object(interviews, 'INTERVIEWS_DATABASE_ID', 'ivdb'), mock.patch.object(ledger, 'EVENTS_DATABASE_ID', 'evdb'),
                   mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}})]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def huxley(self, reviews, events=()):
        tracker, row = job(INVITE + '\n' + ROLE)
        tracker.database_id = 'apps'
        tracker.query_database = lambda db, filter_=None: {'ivdb': list(reviews), 'evdb': list(events)}.get(db, [])
        tracker._children = lambda block_id: REVIEW if block_id == 'iv1' else []
        return tracker, row

    def test_a_follow_up_kit_reads_what_happened_on_this_application(self):
        mail = {'properties': {'Kind': {'type': 'select', 'select': {'name': 'Reply received'}},
                               'At': {'type': 'date', 'date': {'start': '2026-09-30T16:10:00+02:00'}},
                               'Note': text('Jaya asks to confirm Thu 08:30 for the follow-up on rates and contract'),
                               'Application': {'type': 'relation', 'relation': [{'id': 'h1'}]}}}
        tracker, row = self.huxley([interview_row('iv1', 'h1', '2026-09-30', 'Recruiter screen', next_step='Follow-up call Thu',
                                                  weak='Salary'),
                                    interview_row('iv2', 'h1', '2026-09-25', 'Intro chat', overall='')],  # not reviewed: left out
                                   [mail])
        client = Client()
        result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['ok'], result)
        self.assertIn('after 1 earlier interview', result['text'])
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('What already happened on THIS application', prompt)
        self.assertIn('2026-09-30 · Recruiter screen · went positive', prompt)
        self.assertIn('salary was left open', prompt)  # the review's summary
        self.assertIn('Next step they said: Follow-up call Thu', prompt)
        self.assertIn('Topics answered weakly: Salary', prompt)
        self.assertIn('⚠️ [Salary] What are your expectations?', prompt)  # the weak answer, not the strong one
        self.assertNotIn('✅ [Motivation]', prompt)
        self.assertIn('contract setup (B2B via Huxley)', prompt)  # what they said comes next
        self.assertIn('Relocation: not needed', prompt)
        self.assertIn('confirm Thu 08:30 for the follow-up', prompt)  # the recruiter's latest message
        self.assertNotIn('Intro chat', prompt)
        self.assertIn('FOLLOW-UP', client.calls[0]['system'])
        self.assertIn('since_last_call', client.calls[0]['output_config']['format']['schema']['required'])

    def test_a_follow_up_kit_opens_with_what_the_last_call_established(self):
        kit = dict(KIT, interview_type='recruiter follow-up', since_last_call=['Remote confirmed; salary left open'],
                   do_differently=['Give a number for salary'])
        titles = [b[b['type']]['rich_text'][0]['text']['content'] for b in prep.blocks(kit, NOW, 0.04) if b['type'] == 'heading_3']
        self.assertEqual(titles[:3], ['Since your last call', 'Do differently this time', 'What they will likely assess'])
        first = [b['type'] for b in prep.blocks(dict(KIT, since_last_call=[], do_differently=[]), NOW, 0.04)]
        self.assertNotIn('Since your last call', str(prep.blocks(dict(KIT, since_last_call=[], do_differently=[]), NOW, 0.04)))
        self.assertEqual(first[0], 'paragraph')


class EarlierKitTests(unittest.TestCase):
    def page(self, children):
        tracker = SimpleNamespace(requests=[], _children=lambda block_id: children)
        tracker._request = lambda *a: tracker.requests.append(a)
        return tracker

    def test_rebuilding_keeps_the_previous_kit_folded_below_the_new_one(self):
        old_toggle = {'id': 'old', 'type': 'toggle', 'toggle': {'rich_text': [{'plain_text': 'Earlier kit · built 20 Sep 2026'}]}}
        children = [read_block('d', 'heading_2', '🧾 Job description'), read_block('d1', 'paragraph', 'Principal SRE…'),
                    read_block('h', 'heading_2', prep.HEADING),
                    read_block('k0', 'paragraph', 'Recruiter screen · built 29 Sep 2026 · $0.04'),
                    read_block('k1', 'heading_3', 'What they will likely assess'), read_block('k2', 'bulleted_list_item', 'Motivation'),
                    old_toggle,
                    read_block('s1', 'heading_3', 'What they will likely assess'),  # stacked by an old rebuild: dropped
                    read_block('s2', 'bulleted_list_item', 'Stale point'),
                    read_block('l', 'heading_2', '📥 Logged'), read_block('l1', 'paragraph', 'Chat with Jaya')]
        tracker = self.page(children)
        new = prep.blocks(dict(KIT, interview_type='recruiter follow-up'), NOW, 0.05)
        prep.write_kit(tracker, 'h1', new, earlier_day='2026-09-29')
        deleted = [path.split('/')[1] for method, path, *_ in tracker.requests if method == 'DELETE']
        self.assertEqual(deleted, ['k0', 'k1', 'k2', 'old', 's1', 's2'])  # the description and the log stay
        method, path, body = [r for r in tracker.requests if r[0] == 'PATCH'][0]
        self.assertEqual((path, body['after']), ('blocks/h1/children', 'h'))
        self.assertEqual(body['children'][:len(new)], new)
        toggle = body['children'][-1]
        self.assertEqual(toggle['type'], 'toggle')
        self.assertEqual(toggle['toggle']['rich_text'][0]['text']['content'], 'Earlier kit · built 29 Sep 2026')
        self.assertEqual([c[c['type']]['rich_text'][0]['text']['content'] for c in toggle['toggle']['children']],
                         ['Recruiter screen · built 29 Sep 2026 · $0.04', 'What they will likely assess', 'Motivation'])
        self.assertLessEqual(len(body['children']), 100)  # Notion's limit per request
        self.assertLessEqual(len(toggle['toggle']['children']), 100)

    def test_a_first_kit_adds_the_section_without_an_earlier_toggle(self):
        tracker = self.page([read_block('l', 'heading_2', '📥 Logged')])
        new = prep.blocks(KIT, NOW, 0.04)
        prep.write_kit(tracker, 'h1', new)
        (method, path, body), = tracker.requests
        self.assertEqual(body['children'][1:], new)
        self.assertNotIn('toggle', [b['type'] for b in body['children']])


class LoggedRunTests(unittest.TestCase):
    def test_a_kit_is_recorded_as_a_run_with_its_ai_cost(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        logged = []
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}), \
                mock.patch('src.notion.cron_runs.begin', lambda t, run: None), \
                mock.patch('src.notion.cron_runs.log_run', lambda t, run, failed=False: logged.append((run, failed))):
            result = prep.logged_build(tracker, row, client=Client(), now=NOW)
        self.assertTrue(result['ok'])
        run, failed = logged[0]
        self.assertEqual((run['mode'], failed), ('prep', False))
        self.assertGreater(run['interview']['usd'], 0)  # counted in the month's AI budget
        self.assertIn('Huxley · Principal SRE', run['headline'])

    def test_the_row_opens_as_running_and_a_failure_is_recorded_with_its_error(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        opened, logged = [], []

        def broken(*a, **k):
            raise RuntimeError('Notion refused the page')
        with mock.patch('src.notion.cron_runs.begin', lambda t, run: opened.append(run['mode'])), \
                mock.patch('src.notion.cron_runs.log_run', lambda t, run, failed=False: logged.append((run, failed))), \
                mock.patch.object(prep, 'build', broken):
            result = prep.logged_build(tracker, row, client=Client(), now=NOW)
        self.assertEqual(opened, ['prep'])  # Recent activity shows it while it runs
        run, failed = logged[0]
        self.assertTrue(failed)
        self.assertIn('Notion refused the page', run['headline'])  # the error is kept, not only in the dialog
        self.assertFalse(result['ok'])


class MarkdownTests(unittest.TestCase):
    def test_an_ai_answer_in_markdown_becomes_headings_bullets_and_bold(self):
        # 29 Sep 2026: the Huxley description showed "# Role Details" and "**Position:**" as plain text.
        from src.notion.ledger import md_blocks
        blocks = md_blocks('# Role Details\n\n**Position:** Principal SRE\n**Company/Client:** Rapidly growing AI company\n'
                           '\nThey are building their SRE team.\n- AWS, Kubernetes\n1. Screening call')
        kinds = [b['type'] for b in blocks]
        self.assertEqual(kinds, ['heading_3', 'bulleted_list_item', 'bulleted_list_item', 'paragraph', 'bulleted_list_item', 'numbered_list_item'])
        position = blocks[1]['bulleted_list_item']['rich_text']
        self.assertEqual((position[0]['text']['content'], position[0]['annotations']['bold']), ('Position:', True))
        self.assertNotIn('#', blocks[0]['heading_3']['rich_text'][0]['text']['content'])

    def test_a_bold_label_alone_on_its_line_heads_the_list_below_it(self):
        # "**Tech Stack:**" then bullets: it showed as one more bullet, so the list had no heading.
        from src.notion.ledger import md_blocks
        blocks = md_blocks('**Tech Stack:**\n- Deep AWS\n**Team**\n- Building out SRE')
        self.assertEqual([b['type'] for b in blocks], ['heading_3', 'bulleted_list_item', 'heading_3', 'bulleted_list_item'])
        self.assertEqual(blocks[0]['heading_3']['rich_text'][0]['text']['content'], 'Tech Stack')

if __name__ == '__main__':
    unittest.main()
