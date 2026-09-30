"""Logging a message on a job fills what the job was missing, and never replaces what's there."""
import unittest

from src.ai import inbox


class FakeTracker:
    def __init__(self):
        self.updates = []

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


class FillGapsTest(unittest.TestCase):
    def test_only_empty_fields_are_filled(self):
        row = {'id': 'h1', 'properties': {'Company': text(''), 'Location': text('Zurich'), 'Salary': text('')}}
        tracker = FakeTracker()
        filled = inbox._fill_gaps(tracker, row, {'company': 'Acme Bank', 'location': 'Geneva', 'salary': 'CHF 160k'})
        self.assertEqual(filled, ['company', 'salary'])
        self.assertEqual(set(tracker.updates[0][1]), {'Company', 'Salary'})
        self.assertEqual(inbox.plain(row['properties']['Company']), 'Acme Bank')

    def test_a_chat_that_began_before_the_job_was_tracked_becomes_where_you_were_reached(self):
        row = {'id': 'h1', 'created_time': '2026-09-29T12:41:00Z',
               'properties': {'Company': text('Acme'), 'Reached via': {'type': 'select', 'select': {'name': 'Email'}}}}
        tracker = FakeTracker()
        filled = inbox._fill_gaps(tracker, row, {'platform': 'LinkedIn', 'first_contact': '2026-09-22T10:00:00+02:00'})
        self.assertEqual(filled, ['first contact on LinkedIn'])
        self.assertEqual(tracker.updates[0][1]['Reached via'], {'select': {'name': 'LinkedIn'}})
        later = {**row, 'properties': {**row['properties'], 'Reached via': {'type': 'select', 'select': {'name': 'Email'}}}}
        self.assertEqual(inbox._fill_gaps(FakeTracker(), later, {'platform': 'LinkedIn', 'first_contact': '2026-09-30'}), [])


    def test_the_fuller_title_replaces_an_invitations_short_one_never_another_role(self):
        row = {'id': 'h1', 'properties': {'Job': {'type': 'title', 'title': [{'plain_text': 'SRE'}]}}}
        tracker = FakeTracker()
        self.assertEqual(inbox._fill_gaps(tracker, row, {'role': 'Principal SRE'}), ['the title "Principal SRE"'])
        self.assertEqual(inbox._fill_gaps(FakeTracker(), row, {'role': 'Data Engineer'}), [])

    def test_a_date_shown_without_its_year_is_this_years(self):
        from datetime import datetime, timezone
        now = datetime(2026, 9, 29, 13, 0, tzinfo=timezone.utc)
        self.assertEqual(inbox._this_year('2024-09-21T10:00:00+00:00', now)[:10], '2026-09-21')
        self.assertEqual(inbox._this_year('2024-12-21T10:00:00+00:00', now)[:10], '2025-12-21')  # never in the future
        self.assertEqual(inbox._this_year('2026-09-20T10:00:00+00:00', now), '2026-09-20T10:00:00+00:00')

    def test_nothing_new_writes_nothing(self):
        tracker = FakeTracker()
        self.assertEqual(inbox._fill_gaps(tracker, {'id': 'x', 'properties': {'Company': text('Acme')}}, {'company': 'Other'}), [])
        self.assertEqual(tracker.updates, [])


def select(value):
    return {'type': 'select', 'select': {'name': value} if value else None}


def gmail_lead(**extra):
    """The Huxley row: tracked from the Gmail check's call invite on 29 Sep."""
    return {'id': 'h1', 'created_time': '2026-09-29T13:09:00Z', 'properties': {
        'Company': text(''), 'Source': select('Gmail'), 'Reached via': select('Email'),
        'Notes': text('Recruiter message (Email)'), **extra}}


class EventsTracker(FakeTracker):
    def __init__(self, events=()):
        super().__init__()
        self.events, self.queries = list(events), []

    def query_database(self, database_id, filter_=None):
        self.queries.append(filter_)
        return self.events


class SourceIsTheEarliestContactTest(unittest.TestCase):
    """Source = where the contact started: a later channel never replaces it, an earlier one logged later does."""

    def test_email_first_then_linkedin_later_stays_gmail(self):
        tracker = EventsTracker()
        self.assertEqual(inbox._fill_gaps(tracker, gmail_lead(), {'platform': 'LinkedIn', 'when': '2026-09-30T09:00:00Z',
                                                                 'first_contact': '2026-09-30T09:00:00Z'}), [])
        self.assertEqual(tracker.updates, [])

    def test_linkedin_logged_later_but_dated_earlier_becomes_the_source(self):
        row, tracker = gmail_lead(), EventsTracker()
        filled = inbox._fill_gaps(tracker, row, {'platform': 'LinkedIn', 'first_contact': '2026-09-21T14:36:00Z'})
        self.assertEqual(filled, ['first contact on LinkedIn'])
        self.assertEqual(tracker.updates, [('h1', {
            'Source': {'select': {'name': 'LinkedIn'}}, 'Reached via': {'select': {'name': 'LinkedIn'}},
            'Notes': {'rich_text': [{'text': {'content': 'Recruiter message (LinkedIn)'}}]}})])
        self.assertEqual(inbox.plain(row['properties']['Source']), 'LinkedIn')

    def test_the_messages_own_date_counts_when_the_chat_start_isnt_shown(self):
        tracker = EventsTracker()
        inbox._fill_gaps(tracker, gmail_lead(), {'platform': 'LinkedIn', 'first_contact': '', 'when': '2026-09-21T14:36:00Z'})
        self.assertEqual(tracker.updates[0][1]['Source'], {'select': {'name': 'LinkedIn'}})

    def test_the_same_channel_twice_changes_nothing(self):
        row = gmail_lead(Source=select('LinkedIn'), **{'Reached via': select('LinkedIn')},
                         Notes=text('Recruiter message (LinkedIn)'))
        tracker = EventsTracker()
        self.assertEqual(inbox._fill_gaps(tracker, row, {'platform': 'LinkedIn', 'first_contact': '2026-09-21T10:00:00Z'}), [])
        self.assertEqual(tracker.updates, [])
        tracker = EventsTracker()
        self.assertEqual(inbox._fill_gaps(tracker, gmail_lead(), {'platform': 'Email', 'first_contact': '2026-09-21'}), [])
        self.assertEqual(tracker.updates, [])

    def test_an_email_older_than_the_row_itself_still_came_first(self):
        # The Gmail check tracked on 29 Sep an email from 20 Sep: a LinkedIn chat from the 21st is later.
        from unittest import mock
        email = {'properties': {'At': {'type': 'date', 'date': {'start': '2026-09-20T09:00:00Z'}}}}
        tracker = EventsTracker([email])
        with mock.patch.object(inbox.ledger, 'EVENTS_DATABASE_ID', 'events-db'):
            self.assertEqual(inbox._fill_gaps(tracker, gmail_lead(), {'platform': 'LinkedIn', 'first_contact': '2026-09-21'}), [])
        self.assertEqual(tracker.queries[0]['and'][1]['or'][0], {'property': 'Source', 'select': {'equals': 'Gmail'}})

    def test_a_logged_entry_names_its_channel(self):
        appended = []

        class Tracker:
            def append_blocks(self, parent, blocks):
                appended.append(blocks)
        inbox._keep(Tracker(), {'id': 'job'}, 'hi', None, 'Call booked', '2026-09-21T10:00:00Z', 'LinkedIn')
        inbox._keep(Tracker(), {'id': 'job'}, 'hi', None, 'LinkedIn chat', '2026-09-21T10:00:00Z', 'LinkedIn')
        titles = [b[0]['toggle']['rich_text'][0]['text']['content'] for b in appended]
        self.assertEqual(titles, ['📥 21 Sep 2026 · LinkedIn · Call booked', '📥 21 Sep 2026 · LinkedIn chat'])



class DescriptionTest(unittest.TestCase):
    def test_a_chat_describing_the_role_becomes_the_jobs_description(self):
        import json
        from types import SimpleNamespace
        from unittest import mock
        row = {'id': 'h1', 'created_time': '2026-09-29T12:41:00Z', 'properties': {
            'Job': {'type': 'title', 'title': [{'plain_text': 'SRE'}]}, 'Stage': {'type': 'select', 'select': {'name': 'Interview scheduled'}},
            'Job URL': {'type': 'url', 'url': 'https://mail.google.com/mail/u/0/#all/h1'}, 'Company': text(''), 'Via': text('Huxley')}}
        about = 'Principal SRE for a global AI company. Own AWS and Kubernetes reliability, incident management, Kafka, ArgoCD.'
        reading = {'kind': 'Reply received', 'match': 0, 'role': 'Principal SRE', 'when': '', 'first_contact': '', 'interview_at': '',
                   'feedback': '', 'job_description': about, 'summary': 'hands-on SRE', 'platform': 'LinkedIn'}
        saved, scored = [], []

        class Tracker(FakeTracker):
            def replace_after_heading(self, page_id, heading, blocks):
                saved.append((heading, blocks))

            def append_blocks(self, *args):
                pass
        with mock.patch.object(inbox, 'candidates', lambda t: [{'url': 'https://mail.google.com/mail/u/0/#all/h1', 'stage': 'Interview scheduled'}]), \
                mock.patch.object(inbox, 'read', lambda *a, **k: reading), \
                mock.patch.object(inbox, '_row_for', lambda t, url: row), \
                mock.patch.object(inbox.mail, '_events_index', lambda t: (set(), {})), \
                mock.patch.object(inbox.mail, 'record', lambda *a, **k: None):
            line = inbox.log(Tracker(), text='x' * 50, client=object(), target='https://mail.google.com/mail/u/0/#all/h1',
                             on_new=lambda url, job, r=None: scored.append(job['description']) or '78/100')
        self.assertEqual(saved[0][0], inbox.DESCRIPTION_HEADING)
        self.assertEqual(scored, [about])
        self.assertIn('the job description', line)



class ThumbnailTest(unittest.TestCase):
    def test_several_screenshots_become_a_row_of_thumbnails_inside_the_fold(self):
        from unittest import mock
        appended = []

        class Tracker:
            def upload_file(self, name, data, kind):
                return f'up-{name}'

            def append_blocks(self, parent, blocks):
                appended.append((parent, blocks))
                return {'results': [{'id': 'toggle-1'}]}
        shots = [(f's{n}.png', b'x', 'image/png') for n in range(4)]
        inbox._keep(Tracker(), {'id': 'job'}, '', shots, 'LinkedIn chat', '2026-09-21T10:00:00+00:00')
        (page, [entry]), (inside, [row]) = appended
        self.assertEqual((page, entry['type']), ('job', 'toggle'))
        self.assertEqual(entry['toggle']['rich_text'][0]['text']['content'], '📥 21 Sep 2026 · LinkedIn chat')
        self.assertEqual((inside, row['type'], len(row['column_list']['children'])), ('toggle-1', 'column_list', 4))


if __name__ == '__main__':
    unittest.main()
