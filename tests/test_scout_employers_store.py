"""Find employers on the store: a Notion user's Employers & Sources rows get exactly the properties they got before the store
(tests/fixtures/scout_employer_pages.json, captured from the old write_notion), and the crawl reads its own feeds from the store."""
import datetime
import json
import unittest
from pathlib import Path
from unittest import mock

from src import scout, scout_notion
from src.stores import memory, notion

PAGES = json.loads((Path(__file__).parent / 'fixtures' / 'scout_employer_pages.json').read_text())


class Tracker:
    """A Notion client that records each write; `existing` holds a row named like the candidate (in another case)."""

    def __init__(self, existing=None):
        self.existing, self.writes = existing, []

    def query_database(self, _db, filter_=None):
        if self.existing and filter_ and self.existing.casefold() in filter_['title']['contains'].casefold():
            return [{'id': 'row-1', 'properties': {'Company': {'title': [{'plain_text': self.existing}]}}}]
        return []

    def create_page(self, _db, properties):
        self.writes.append(('create', properties))
        return {'id': 'row-2', 'properties': {}}

    def update_page(self, _id, properties):
        self.writes.append(('update', properties))
        return {'id': 'row-1', 'properties': {}}


def plain(props):
    """Text parts without their optional 'type' key: Notion reads {'text': …} and {'type': 'text', 'text': …} alike."""
    def part(value):
        return {k: v for k, v in value.items() if k != 'type'} if isinstance(value, dict) else value
    return {name: {kind: [part(p) for p in value] if isinstance(value, list) else value for kind, value in prop.items()}
            for name, prop in props.items()}


class NotionPagesUnchanged(unittest.TestCase):
    def write(self, case, existing=None):
        tracker = Tracker(existing)
        stores = notion.open_store({'NOTION_TOKEN': 't', 'NOTION_EMPLOYERS_DB': 'employers-db'}, tracker=tracker)
        candidate, outcome = PAGES['cases'][case]
        with mock.patch.object(scout_notion, 'now', return_value=datetime.datetime.fromisoformat(PAGES['today'] + 'T12:00')):
            scout.write_employer(stores, candidate, outcome)
        return tracker.writes

    def test_a_new_employer_gets_todays_row(self):
        for case in PAGES['cases']:
            with self.subTest(case):
                [(kind, props)] = self.write(case)
                self.assertEqual((kind, plain(props)), ('create', PAGES['pages'][f'{case}:create']))

    def test_a_re_checked_employer_gets_todays_update(self):
        """The row keeps its name (matched in any case); every other column is written as before."""
        for case in PAGES['cases']:
            with self.subTest(case):
                name = PAGES['cases'][case][0]['name']
                [(kind, props)] = self.write(case, existing=name.upper())
                want = {k: v for k, v in PAGES['pages'][f'{case}:update'].items() if k != 'Company'}
                self.assertEqual((kind, plain(props)), ('update', want))

    def test_an_employer_without_a_feed_and_not_tier_1_is_not_written(self):
        tracker = Tracker()
        stores = notion.open_store({'NOTION_TOKEN': 't', 'NOTION_EMPLOYERS_DB': 'employers-db'}, tracker=tracker)
        scout.write_employer(stores, {'name': 'Nofeed', 'tier': 'Standard', 'origin': 'x'}, {'status': 'none'})
        self.assertEqual(tracker.writes, [])


class OwnFeedsFromTheStore(unittest.TestCase):
    def test_the_crawl_reads_active_employers_with_a_feed(self):
        stores = memory.open_store()
        stores.employers.add({'name': 'Mine', 'ats': 'greenhouse', 'slug': 'mine'})
        stores.employers.add({'name': 'Off', 'ats': 'lever', 'slug': 'off', 'active': False})
        stores.employers.add({'name': 'No slug', 'ats': 'greenhouse'})
        stores.employers.add({'name': 'Custom', 'ats': 'taleo', 'slug': 'x'})
        self.assertEqual(scout.own_feeds(stores), [('Mine', 'greenhouse', 'mine')])


if __name__ == '__main__':
    unittest.main()
