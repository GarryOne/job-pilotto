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
        self.assertEqual(tracker.updates[0][1], {'Reached via': {'select': {'name': 'LinkedIn'}}})
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
