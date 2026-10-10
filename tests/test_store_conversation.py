"""The 💬 Conversation port (src/stores/notion_conversation.py) gives exactly the app's blocks and read-back
(desktop/lib/transcript.js) for one shared sample, tests/fixtures/stores/conversation.json (made in TZ=UTC)."""
import json
import os
import time
import unittest
from pathlib import Path
from unittest import mock

from src.stores import notion_conversation as conversation

SAMPLE = json.loads((Path(__file__).resolve().parent / 'fixtures' / 'stores' / 'conversation.json').read_text())


def as_notion_returns(blocks):
    """Blocks as a read gives them: ids, and plain_text on every rich-text part."""
    return [{**block, 'id': f'b{i}', block['type']: {**block[block['type']], 'rich_text': [
        {**part, 'plain_text': part['text']['content']} for part in block[block['type']].get('rich_text', [])]}}
        for i, block in enumerate(blocks)]


@unittest.skipUnless(hasattr(time, 'tzset'), 'time.tzset is Unix only: these tests pin the time zone through TZ')
class ConversationTests(unittest.TestCase):
    def setUp(self):
        patch = mock.patch.dict(os.environ, {'TZ': 'UTC'})
        patch.start()
        time.tzset()
        self.addCleanup(time.tzset)
        self.addCleanup(patch.stop)

    def test_the_blocks_are_the_apps(self):
        self.assertEqual(conversation.blocks(SAMPLE['talk']), SAMPLE['blocks'])

    def test_reading_them_back_gives_what_the_app_reads(self):
        self.assertEqual(conversation.load(as_notion_returns(SAMPLE['blocks'])), SAMPLE['loaded'])

    def test_the_toggle_names_its_count(self):
        self.assertEqual(conversation.toggle_title(SAMPLE['talk']), '💬 Conversation · 5 messages and steps')


if __name__ == '__main__':
    unittest.main()
