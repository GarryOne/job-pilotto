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

    def test_nothing_new_writes_nothing(self):
        tracker = FakeTracker()
        self.assertEqual(inbox._fill_gaps(tracker, {'id': 'x', 'properties': {'Company': text('Acme')}}, {'company': 'Other'}), [])
        self.assertEqual(tracker.updates, [])


if __name__ == '__main__':
    unittest.main()
