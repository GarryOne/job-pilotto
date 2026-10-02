"""Focus history: what you resolved (app events, rated insights), newest first, from Notion."""
import unittest
from unittest import mock

from src import focus


def event(kind, company, at, note=''):
    return {'url': f'https://notion.so/{kind[:3]}', 'properties': {
        'Kind': {'type': 'select', 'select': {'name': kind}}, 'Event': {'type': 'title', 'title': [{'plain_text': f'{kind} · {company}'}]},
        'At': {'type': 'date', 'date': {'start': at}}, 'Note': {'type': 'rich_text', 'rich_text': [{'plain_text': note}]}}}


class FocusHistoryTest(unittest.TestCase):
    def test_events_and_rated_insights_newest_first(self):
        insight = {'url': 'https://notion.so/ins', 'properties': {
            'Date': {'type': 'date', 'date': {'start': '2026-09-28'}}, 'Feedback': {'type': 'select', 'select': {'name': 'Useful'}},
            'Insight': {'type': 'title', 'title': [{'plain_text': 'Location limits your applications'}]}}}
        unrated = {'url': 'x', 'properties': {'Date': {'type': 'date', 'date': {'start': '2026-09-29'}}, 'Feedback': {'type': 'select', 'select': None}}}
        tracker = mock.Mock()
        tracker.query_database.side_effect = lambda db, filter_=None: (
            [event('Replied', 'Northwind', '2026-09-29T10:00:00+00:00', 'You answered (marked done in Focus)'),
             event('Feedback skipped', 'Zephyr AI', '2026-09-27T09:00:00+00:00')] if db == 'events' else [insight, unrated])
        with mock.patch.object(focus, 'EVENTS_DATABASE_ID', 'events'), mock.patch('src.ai.insights.INSIGHTS_DATABASE_ID', 'insights'):
            items = focus.history(tracker)
        self.assertEqual([i['title'] for i in items], ['Replied to Northwind', 'Insight: Useful', 'Skipped asking Zephyr AI for feedback'])
        self.assertEqual(items[1]['note'], 'Location limits your applications')


if __name__ == '__main__':
    unittest.main()
