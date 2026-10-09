"""Interview prep kit: asks for the role when it's unknown, then builds a kit on the job (src/ai/prep.py), in the active
store. The memory store stands in for any adapter (sqlite on this Mac, Notion); that a Notion page shows the same blocks as
before is checked in tests/test_prep_store.py."""
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from src.ai import prep
from src.stores import base, memory
from src.stores.notion_blocks import to_blocks

NOW = datetime(2026, 9, 29, 14, 0, tzinfo=timezone.utc)
INVITE = """Subject: Connect Igor / Jaya - SRE
Microsoft Teams meeting
Join: https://teams.microsoft.com/meet/314
Meeting ID: 314 743 971 982 217
Passcode: bJ6Np22T"""
ROLE = """Principal SRE for a global AI company, remote. You own the reliability of large AWS and Kubernetes platforms that
serve model training and inference, lead incident management and postmortems, and build the observability stack.
Hands-on: Terraform, ArgoCD, Kafka, Prometheus and Grafana. You mentor a team of five SREs and work closely with the
ML platform engineers on capacity planning, SLOs and on-call. Experience running large production systems is a must."""
NO_STATS = {'topics_answered_weakly': {}, 'topics_asked': {}}


def job(recruiter=INVITE, description=''):
    """The Huxley job in a memory store: its recruiter message (and description) as sections, the Profile as a text."""
    stores = memory.open_store()
    stores.texts.set('profile', 'Igor: 10 years, SRE at Acme')
    record = stores.applications.create({'url': 'https://mail.google.com/mail/u/0/#all/h1', 'title': 'Principal SRE', 'company': '',
                                         'via': 'Huxley', 'contact': 'Jayantie Nejati', 'next_interview': '2026-09-30T08:30:00+02:00'},
                                        'Interview scheduled')
    stores.applications.set_section(record['id'], '🤝 Recruiter message', recruiter)
    if description:
        stores.applications.set_section(record['id'], prep.DESCRIPTION_HEADING, description)
    return stores, stores.applications.get(record['url'])


KIT = {'interview_type': 'recruiter screen', 'assess': ['motivation'], 'questions': [{'question': 'Why this role?', 'answer_with': 'Acme SRE work'}],
       'stories': ['Incident at Acme'], 'gaps': [], 'ask_them': ['Who is the client?'], 'plan': ['Read the description'], 'unknowns': ['salary']}


class Client:
    def __init__(self):
        self.messages, self.calls = self, []

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(KIT))],
                               usage=SimpleNamespace(input_tokens=4000, output_tokens=900, cache_read_input_tokens=0, cache_creation_input_tokens=0))


def stats(value=None):
    return mock.patch('src.ai.insights_data.interview_stats', lambda stores: value or NO_STATS)


class PrepTests(unittest.TestCase):
    def test_the_messages_you_logged_on_the_job_are_part_of_what_prep_knows(self):
        """A logged message (src/ai/inbox.py, base.LOGGED) tells prep about the role too, on every store."""
        stores, record = job()
        stores.applications.append_entry(record['id'], base.LOGGED, '📥 29 Sep 2026 · LinkedIn · Team and stack', '> Kubernetes, 6 SREs, on-call 1 week in 6.')
        self.assertIn('on-call 1 week in 6', prep.role_text(stores, record))

    def test_an_invite_alone_is_not_a_role_it_asks_for_the_description(self):
        stores, record = job()
        client = Client()
        result = prep.build(stores, record, client=client, now=NOW)
        self.assertTrue(result['needs_description'])
        self.assertEqual(client.calls, [])  # nothing spent

    def test_with_the_description_it_builds_the_kit_on_the_job(self):
        stores, record = job(description=ROLE)
        stores.applications.create({'url': 'https://grafana.example/1', 'company': 'Grafana Labs',
                                    'rejection_lesson': 'Lead with incident stories that show the outcome'}, 'Rejected')
        client = Client()
        with stats({'topics_answered_weakly': {'Kafka tuning': 2}, 'topics_asked': {'SLOs': 3}}):
            result = prep.build(stores, record, client=client, now=NOW)
        self.assertTrue(result['ok'], result)
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('Kafka tuning', prompt)
        self.assertIn('Topics interviewers asked most: SLOs', prompt)
        self.assertIn('Grafana Labs: Lead with incident stories that show the outcome', prompt)  # what it learned from you
        self.assertIn('ArgoCD', prompt)
        self.assertIn('16 h from now', prompt)  # Wed 08:30 CEST = 06:30 UTC
        self.assertIn('Via: Huxley (contact: Jayantie Nejati)', prompt)
        section = stores.applications.section(record['id'], prep.HEADING)
        self.assertIn('### Still unknown: ask the recruiter', section)
        self.assertNotIn(prep.EARLIER, section)  # a first kit: nothing folded
        self.assertNotIn('What already happened on THIS application', prompt)  # no earlier interview: a first-round kit
        # With the time: Focus compares it with the interviews reviewed since.
        self.assertEqual(stores.applications.get(record['url'])['interview_prep'], '2026-09-29T14:00:00+00:00')

    def test_screenshots_logged_on_the_job_are_read_instead_of_asking(self):
        # 29 Sep 2026: the Huxley chat was logged as 4 images before the Log box kept its text; the kit asked anyway.
        stores, record = job()
        stores.applications.attach(record['id'], 'shot-1.png', b'png1', 'image/png')
        stores.applications.attach(record['id'], 'chat.txt', b'not a picture', 'text/plain')
        stores.applications.attach(record['id'], 'shot-2.png', b'png2', 'image/png')

        class Reads(Client):
            def create(self, **params):
                if params['model'] == prep.READ_MODEL:
                    self.calls.append(params)
                    return SimpleNamespace(content=[SimpleNamespace(type='text', text=ROLE)],
                                           usage=SimpleNamespace(input_tokens=5000, output_tokens=300, cache_read_input_tokens=0, cache_creation_input_tokens=0))
                return super().create(**params)
        client = Reads()
        with stats():
            result = prep.build(stores, record, client=client, now=NOW)
        self.assertTrue(result['ok'], result)
        self.assertEqual(len([b for b in client.calls[0]['messages'][0]['content'] if b['type'] == 'image']), 2)  # the pictures only
        self.assertIn('ArgoCD', stores.applications.section(record['id'], prep.DESCRIPTION_HEADING))  # kept as the job's description
        self.assertIn('ArgoCD', client.calls[1]['messages'][0]['content'])

    def test_a_cut_off_answer_says_so_and_writes_nothing(self):
        stores, record = job(description=ROLE)
        client = Client()
        cut = SimpleNamespace(content=[SimpleNamespace(type='text', text='{"interview_type": "technical", "assess": ["SL')],
                              usage=SimpleNamespace(input_tokens=4000, output_tokens=8000, cache_read_input_tokens=0, cache_creation_input_tokens=0),
                              stop_reason='max_tokens')
        client.create = lambda **params: cut
        with stats(), self.assertRaisesRegex(RuntimeError, 'cut off'):
            prep.build(stores, record, client=client, now=NOW)
        self.assertIsNone(stores.applications.section(record['id'], prep.HEADING))

    def test_a_pasted_description_is_saved_on_the_job(self):
        stores, record = job()
        self.assertTrue(prep.describe(stores, record, text=ROLE)['ok'])
        self.assertIn('ArgoCD', stores.applications.section(record['id'], prep.DESCRIPTION_HEADING))
        self.assertFalse(prep.describe(stores, record, text='SRE role')['ok'])

    def test_a_described_role_keeps_the_blocks_it_always_had(self):
        """md_blocks' reading ("# Role Details" and a bold label alone on its line head what follows) survives the store."""
        from src.notion.ledger import md_blocks
        stores, record = job()
        body = '# Role Details\n\n**Position:** Principal SRE\n**Tech Stack:**\n- Deep AWS\n' + ROLE
        prep.describe(stores, record, text=body)
        kinds = lambda blocks: [b['type'] for b in blocks]
        self.assertEqual(kinds(to_blocks(stores.applications.section(record['id'], prep.DESCRIPTION_HEADING))), kinds(md_blocks(body)))


# The Huxley recruiter screen on 30 Sep 2026: its review as the store keeps it (src/ai/interviews.py, Markdown).
REVIEW = """🔗 Job: Huxley · Principal SRE

Friendly recruiter screen; motivation and remote setup went well, salary was left open.

### Signals from them
- Next call covers salary band and the contract setup (B2B via Huxley)

### Facts from the call
- Relocation: not needed, fully remote

### Questions
- ⚠️ [Salary] What are your expectations? — vague range → Better: give a number
- ✅ [Motivation] Why this role? — AI infra

### Transcript
- Interviewer: anything said here is never read"""


class FollowUpTests(unittest.TestCase):
    def huxley(self):
        stores, record = job(description=ROLE)
        stores.interviews.save(None, {'app_id': record['id'], 'title': 'Huxley screen', 'at': '2026-09-30', 'round': 'Recruiter screen',
                                      'overall': 'positive', 'next_step': 'Follow-up call Thu', 'weak_topics': 'Salary', 'review': REVIEW})
        stores.interviews.save(None, {'app_id': record['id'], 'title': 'Intro', 'at': '2026-09-25', 'round': 'Intro chat',
                                      'overall': ''})   # not reviewed: left out
        stores.events.add(record['id'], 'Reply received', '2026-09-30T16:10:00+02:00', source='Gmail',
                          note='Jaya asks to confirm Thu 08:30 for the follow-up on rates and contract')
        return stores, record

    def test_a_follow_up_kit_reads_what_happened_on_this_application(self):
        stores, record = self.huxley()
        client = Client()
        with stats():
            result = prep.build(stores, record, client=client, now=NOW)
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
        self.assertNotIn('never read', prompt)  # the transcript isn't
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
    def test_rebuilding_keeps_the_previous_kit_folded_below_the_new_one(self):
        stores, record = job(description=ROLE)
        older = prep.kit_markdown(KIT, datetime(2026, 9, 20, tzinfo=timezone.utc), 0.03)
        current = prep.kit_markdown(KIT, datetime(2026, 9, 29, tzinfo=timezone.utc), 0.04)
        stacked = prep.kit_markdown(dict(KIT, assess=['Stale point']), NOW, 0.02)   # stacked by an old rebuild: dropped
        stores.applications.set_section(record['id'], prep.HEADING, f"{current}\n\n▸ Earlier kit · built 20 Sep 2026\n"
                                        + '\n'.join(f'  {line}' for line in older.splitlines()) + f"\n\n{stacked}")
        new = prep.kit_markdown(dict(KIT, interview_type='recruiter follow-up'), NOW, 0.05)
        prep.write_kit(stores, record['id'], new, earlier_day='2026-09-29')
        section = stores.applications.section(record['id'], prep.HEADING)
        self.assertTrue(section.startswith(new.rstrip()))
        self.assertEqual(section.count('▸ Earlier kit'), 1)  # only the latest earlier kit
        self.assertIn('▸ Earlier kit · built 29 Sep 2026', section)
        self.assertNotIn('20 Sep 2026', section)
        self.assertNotIn('Stale point', section)
        self.assertIn(ROLE[:40], stores.applications.section(record['id'], prep.DESCRIPTION_HEADING))  # the other sections stay
        folded = [b for b in to_blocks(section) if b['type'] == 'toggle']
        self.assertEqual(len(folded), 1)
        self.assertIn('Recruiter screen · built 29 Sep 2026', json.dumps(folded[0], ensure_ascii=False))

    def test_a_first_kit_adds_the_section_without_an_earlier_toggle(self):
        stores, record = job()
        prep.write_kit(stores, record['id'], prep.kit_markdown(KIT, NOW, 0.04))
        self.assertNotIn('▸', stores.applications.section(record['id'], prep.HEADING))


class LoggedRunTests(unittest.TestCase):
    def test_a_kit_is_recorded_as_a_run_with_its_ai_cost(self):
        stores, record = job(description=ROLE)
        logged = []
        with stats(), mock.patch('src.run_log.begin', lambda s, run: None), \
                mock.patch('src.run_log.log_run', lambda s, run, failed=False: logged.append((run, failed))):
            result = prep.logged_build(stores, record, client=Client(), now=NOW)
        self.assertTrue(result['ok'])
        run, failed = logged[0]
        self.assertEqual((run['mode'], failed, run['application']), ('prep', False, record['id']))
        self.assertGreater(run['interview']['usd'], 0)  # counted in the month's AI budget
        self.assertIn('Huxley · Principal SRE', run['headline'])

    def test_the_row_opens_as_running_and_a_failure_is_recorded_with_its_error(self):
        stores, record = job(description=ROLE)
        opened, logged = [], []

        def broken(*a, **k):
            raise RuntimeError('the store refused the page')
        with mock.patch('src.run_log.begin', lambda s, run: opened.append(run['mode'])), \
                mock.patch('src.run_log.log_run', lambda s, run, failed=False: logged.append((run, failed))), \
                mock.patch.object(prep, 'build', broken):
            result = prep.logged_build(stores, record, client=Client(), now=NOW)
        self.assertEqual(opened, ['prep'])  # Recent activity shows it while it runs
        run, failed = logged[0]
        self.assertTrue(failed)
        self.assertIn('the store refused the page', run['headline'])  # the error is kept, not only in the dialog
        self.assertFalse(result['ok'])


class MainTests(unittest.TestCase):
    def test_build_and_describe_work_with_the_data_on_this_mac(self):
        stores, record = job()
        out = []
        with mock.patch.object(prep.notion.Tracker, 'from_env', return_value=None), mock.patch.object(prep, 'open_stores', return_value=stores), \
                mock.patch('builtins.print', lambda *a, **k: out.append(a[0] if a else '')):
            self.assertEqual(prep.main(['describe', record['id'], '--text', ROLE]), 0)
            self.assertEqual(prep.main(['build', 'gone-id']), 1)
        self.assertTrue(json.loads(out[0])['ok'])
        self.assertEqual(json.loads(out[-1])['text'], 'That job is no longer tracked.')


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


class PrepEffortTests(unittest.TestCase):
    """Haiku 4.5 rejects the `effort` setting with a 400; the end-to-end journey runs every step on it."""

    def effort_for(self, model):
        stores, record = job(description=ROLE)
        client = Client()
        with stats():
            prep.build(stores, record, client=client, model=model, now=NOW)
        return client.calls[0]['output_config'].get('effort')

    def test_haiku_gets_no_effort_and_other_models_keep_medium(self):
        self.assertIsNone(self.effort_for('claude-haiku-4-5'))
        self.assertEqual(self.effort_for('claude-sonnet-5-5'), 'medium')


if __name__ == '__main__':
    unittest.main()
