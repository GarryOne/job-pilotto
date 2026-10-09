"""Logging a conversation that began before a tracked job's first contact asks "Who reached out first?" (fields['origin']),
and your answer, not a silent rule, decides the job's Origin: they wrote first = Inbound, you did = it stays Outbound.
What a log changed on an existing job (Origin, Source, Stage) is said in its reply and on the job's page."""
import unittest

from src.ai import inbox
from tests.test_inbox import SHOT, job, row
from tests.mail_fakes import stores_for
from tests.test_inbox_confirm import NOW, Writes, chat
from tests.test_inbox_gaps import EventsTracker
from tests.test_opportunity import Client

URL = 'https://x.test/zephyr'


def zephyr(origin='Outbound', source='Manual', stage='Rejected', created='2026-09-26T15:00:00Z'):
    """The Zephyr AI row: applied on TechTree, a manual add, Origin stamped Outbound at creation."""
    page = row('p1', URL, 'Infrastructure Engineer', 'Zephyr AI', stage)
    page['created_time'] = created
    page['properties'].update({'Origin': {'type': 'select', 'select': {'name': origin} if origin else None},
                               'Source': {'type': 'select', 'select': {'name': source}}, 'Reached via': {'type': 'select', 'select': None},
                               'Notes': {'type': 'rich_text', 'rich_text': []}})
    return page


def tracker_for(page):
    tracker = Writes([page], [dict(job(URL, 'Infrastructure Engineer', 'Zephyr AI', page['properties']['Stage']['select']['name']),
                                   origin=(page['properties']['Origin']['select'] or {}).get('name') or '')])
    rows = tracker.query_database  # the job itself is found by a query too (the Notion store); only its events are none
    tracker.query_database = lambda database_id, filter_=None: rows(database_id, filter_) if database_id == tracker.database_id else []
    return tracker


def conversation(**fields):
    """A LinkedIn chat that began 11 Sep, on the tracked job."""
    fields.setdefault('kind', inbox.UPDATE)
    return chat(match=0, platform='LinkedIn', when='2026-09-11T10:16:00+00:00', first_contact='2026-09-11T10:16:00+00:00', **fields)


class AskedTests(unittest.TestCase):
    def test_a_conversation_from_before_the_first_contact_on_an_outbound_job_asks_who_reached_out_first(self):
        proposal = inbox.propose(stores_for(tracker_for(zephyr())), image=SHOT, client=Client(conversation()), now=NOW)
        asked = proposal['fields']['origin']
        self.assertEqual((asked['state'], asked['question']), ('ask', 'Who reached out first?'))
        self.assertEqual((asked['current'], asked['first_known'][:10]), ('Outbound', '2026-09-26'))
        self.assertEqual(proposal['fields']['channel']['value'], 'LinkedIn')

    def test_the_row_as_it_is_now_comes_with_the_proposal_for_the_will_change_box(self):
        proposal = inbox.propose(stores_for(tracker_for(zephyr())), image=SHOT, client=Client(conversation()), now=NOW)
        self.assertEqual(proposal['current'], {'Origin': 'Outbound', 'Source': 'Manual', 'Reached via': '', 'Stage': 'Rejected'})
        self.assertEqual(proposal['first_known'][:10], '2026-09-26')  # the box compares the conversation's start with it

    def test_not_asked_for_a_new_job_an_inbound_job_or_nothing_known(self):
        new = inbox.propose(stores_for(Writes()), image=SHOT, client=Client(chat(when='2026-09-11T10:00:00+00:00')), now=NOW)
        self.assertNotIn('origin', new['fields'])
        already = inbox.propose(stores_for(tracker_for(zephyr(origin='Inbound'))), image=SHOT, client=Client(conversation()), now=NOW)
        self.assertNotIn('origin', already['fields'])


class AnswerTests(unittest.TestCase):
    def confirmed(self, page, answer, started='2026-09-11', **more):
        tracker = tracker_for(page)
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=Client(conversation()), now=NOW)
        return tracker, inbox.confirm(proposal, channel='LinkedIn', started=started, origin=answer, **more)

    def test_they_wrote_first_sets_inbound_with_the_source_and_says_so(self):
        page = zephyr()
        tracker, proposal = self.confirmed(page, 'inbound')
        line = inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=proposal)
        sent = {name: value for _, changes in tracker.updates for name, value in changes.items()}
        self.assertEqual(sent['Origin'], {'select': {'name': 'Inbound'}})
        self.assertEqual(sent['Source'], {'select': {'name': 'LinkedIn'}})
        self.assertIn('Changed: Origin Outbound → Inbound; Source Manual → LinkedIn', line)

    def test_the_change_is_written_on_the_jobs_page_too(self):
        tracker, proposal = self.confirmed(zephyr(), 'inbound')
        inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=proposal)
        entry = tracker.appended[0][1][-1]['toggle']['children']
        texts = [part['paragraph']['rich_text'][0]['text']['content'] for part in entry if part['type'] == 'paragraph']
        self.assertIn('Changed: Origin Outbound → Inbound; Source Manual → LinkedIn', texts)

    def test_i_reached_out_first_keeps_outbound(self):
        tracker, proposal = self.confirmed(zephyr(), 'outbound')
        line = inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=proposal)
        self.assertNotIn('Origin', {name for _, changes in tracker.updates for name in changes})
        self.assertNotIn('Origin', line)

    def test_no_answer_never_changes_the_origin(self):
        # Telegram and the terminal don't ask: the row keeps what it had.
        tracker = tracker_for(zephyr())
        inbox.log(stores_for(tracker), image=SHOT, client=Client(conversation()), now=NOW)
        self.assertNotIn('Origin', {name for _, changes in tracker.updates for name in changes})

    def test_a_conversation_later_than_the_first_contact_never_flips_it(self):
        tracker, proposal = self.confirmed(zephyr(), 'inbound', started='2026-09-28')
        inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=proposal)
        self.assertNotIn('Origin', {name for _, changes in tracker.updates for name in changes})

    def test_an_answer_needs_a_known_value(self):
        proposal = inbox.propose(stores_for(tracker_for(zephyr())), image=SHOT, client=Client(conversation()), now=NOW)
        with self.assertRaisesRegex(ValueError, 'Unknown origin'):
            inbox.confirm(proposal, origin='maybe')


class StageChangeIsSaidTests(unittest.TestCase):
    def test_a_stage_change_names_where_it_came_from(self):
        page = zephyr(stage='Applied')
        tracker = tracker_for(page)
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=Client(conversation(kind='Rejected')), now=NOW)
        line = inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=inbox.confirm(proposal, channel='LinkedIn', started='2026-09-28', kind='Rejected'))
        self.assertIn('Changed: Stage Applied → Rejected', line)

    def test_a_kind_that_moves_nothing_is_not_reported_as_a_stage_change(self):
        # "Interview scheduled" on a job already Interviewing: the stage stays (forward only), so nothing is said.
        page = zephyr(stage='Interviewing')
        tracker = tracker_for(page)
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=Client(conversation(kind='Interview scheduled')), now=NOW)
        line = inbox.log(stores_for(tracker), image=SHOT, now=NOW, proposal=inbox.confirm(
            proposal, channel='LinkedIn', started='2026-09-28', kind='Interview scheduled', interview_at='2026-10-03T15:00'))
        self.assertNotIn('Changed: Stage', line)


if __name__ == '__main__':
    unittest.main()
