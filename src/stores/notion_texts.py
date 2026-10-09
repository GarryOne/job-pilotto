"""The notion store's Texts: the Profile, the standard answers and 🧠 Form knowledge, each a Notion page read and written whole as Markdown.

A page's other blocks (its child pages such as ⚙️ Search settings, the 📎 CV file, a linked database) are not text:
reading leaves them out and writing keeps them. Markdown ↔ blocks: src/stores/notion_blocks.py (tables included,
for a Profile's experience table). Guarded by tests/test_store_notion.py (the store contract on the Notion stand-in).
"""
from . import base
from .notion_blocks import to_blocks, to_markdown

# Which page holds each text (the app and the workspace repo set these variables).
PAGES = {'profile': 'NOTION_PROFILE_PAGE_ID', 'answers': 'NOTION_ANSWERS_PAGE_ID', 'knowledge': 'NOTION_KNOWLEDGE_PAGE'}
# Blocks that are not the page's text: never read into it, never deleted when it is rewritten.
KEPT = ('child_page', 'child_database', 'link_to_page', 'file', 'pdf', 'image', 'video', 'audio', 'embed', 'bookmark',
        'synced_block', 'column_list', 'table_of_contents', 'breadcrumb')


class NotionTexts:
    def __init__(self, tracker, env):
        self.tracker = tracker
        self.pages = {name: env.get(variable, '') for name, variable in PAGES.items()}

    def _page(self, name):
        if name not in base.TEXTS:
            raise KeyError(name)
        return self.pages.get(name, '')

    def _blocks(self, page_id):
        return [block for block in self.tracker._children(page_id) if not block.get('archived')]

    def _children(self, block_id):
        return self._blocks(block_id)

    def get(self, name):
        page_id = self._page(name)
        if not page_id:
            return ''
        text = [block for block in self._blocks(page_id) if block['type'] not in KEPT]
        return to_markdown(text, children=self._children)

    def plain(self, name):
        """The page as Tracker.page_text reads it (headings, paragraphs, lists, table rows): what scoring and kits have always read."""
        page_id = self._page(name)
        return self.tracker.page_text(page_id) if page_id else ''

    def set(self, name, markdown):
        page_id = self._page(name)
        if not page_id:
            raise LookupError(f'this workspace has no {name} page ({PAGES[name]})')
        for block in self._blocks(page_id):
            if block['type'] not in KEPT:
                self.tracker._request('DELETE', f"blocks/{block['id']}")
        blocks = to_blocks(markdown)
        for start in range(0, len(blocks), 100):  # Notion takes 100 blocks a request
            self.tracker.append_blocks(page_id, blocks[start:start + 100])
        self.tracker.__dict__.pop('_page_texts', None)  # Tracker.page_text's copy of this run is stale now
