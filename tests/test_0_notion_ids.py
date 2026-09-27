"""Fake Notion IDs for the whole suite. The code has no built-in IDs (each user's come from their
environment: the Desktop App, .env or repository variables), and modules copy them at import, so
they're set here: unittest discovery loads this file first (sorted names), before anything imports src."""
import os
import unittest

IDS = {name: f'test-{name.lower().replace("_", "-")}' for name in (
    'NOTION_APPLICATIONS_DB', 'NOTION_MATCHES_DB', 'NOTION_EVENTS_DB', 'NOTION_INSIGHTS_DB',
    'NOTION_INTERVIEWS_DB', 'NOTION_EMPLOYERS_DB', 'NOTION_AGENT_RUNS_DB', 'NOTION_CRON_RUNS_DB',
    'NOTION_PROFILE_PAGE_ID', 'NOTION_ANSWERS_PAGE_ID', 'NOTION_PIPELINE_PAGE')}
for name, value in IDS.items():
    os.environ[name] = value


class NotionIdTests(unittest.TestCase):
    def test_every_database_and_page_has_its_own_id(self):
        from src.notion import client, ledger
        self.assertEqual(len(set(IDS.values())), len(IDS))
        self.assertNotEqual(client.PROFILE_PAGE_ID, ledger.EVENTS_DATABASE_ID)
