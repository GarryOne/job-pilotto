"""Focus history: what you resolved (app events, rated insights), newest first, from the store."""
import unittest

from src import focus
from src.stores import memory


class FocusHistoryTest(unittest.TestCase):
    def test_events_and_rated_insights_newest_first(self):
        stores = memory.open_store()
        north = stores.applications.create({'url': 'https://x.test/n', 'company': 'Northwind'}, 'Screening')
        zephyr = stores.applications.create({'url': 'https://x.test/z', 'title': 'Zephyr AI'}, 'Rejected')
        stores.events.add(north['id'], 'Replied', '2099-09-29T10:00:00+00:00', source='Job Pilotto app',
                          note='You answered (marked done in Focus)')
        stores.events.add(zephyr['id'], 'Feedback skipped', '2099-09-27T09:00:00+00:00', source='Job Pilotto app')
        stores.events.add(north['id'], 'Screening', '2099-09-28T09:00:00+00:00', source='Gmail')  # not from the app
        stores.insights.save('2099-09-28', 'Location', 'Location limits your applications', '', {'feedback': 'Useful'})
        stores.insights.save('2099-09-29', 'Skills', 'Not rated', '')
        items = focus.history(stores)
        self.assertEqual([i['title'] for i in items], ['Replied to Northwind', 'Insight: Useful', 'Skipped asking Zephyr AI for feedback'])
        self.assertEqual(items[1]['note'], 'Location limits your applications')
        self.assertEqual(items[0]['note'], 'You answered (marked done in Focus)')


if __name__ == '__main__':
    unittest.main()
