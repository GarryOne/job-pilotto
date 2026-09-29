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

    def test_nothing_new_writes_nothing(self):
        tracker = FakeTracker()
        self.assertEqual(inbox._fill_gaps(tracker, {'id': 'x', 'properties': {'Company': text('Acme')}}, {'company': 'Other'}), [])
        self.assertEqual(tracker.updates, [])


if __name__ == '__main__':
    unittest.main()
