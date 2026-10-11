"""Every Notion column the Python code reads or writes is in config/notion_schema.json, so every workspace can be
built and repaired with it (docs/rules/data-ownership.md). A new field = a Notion column + the schema, never a
cache-only field: this test fails when code uses a column the schema doesn't have."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = 'title|rich_text|select|multi_select|number|date|url|checkbox|relation|people|email|phone_number|status|files'
USES = re.compile(r"""(?:props|properties|page\['properties'\])(?:\.get\(|\[)'([^']+)'|'([^'\n]{2,40})':\s*\{'(?:%s)'""" % TYPES)
NOT_COLUMNS = {'heading_2', 'paragraph', 'code', 'bulleted_list_item', 'numbered_list_item', 'toggle', 'job', 'text', 'link'}  # block types and Notion payload keys the pattern also matches


class SchemaCoverageTests(unittest.TestCase):
    def test_every_column_the_code_uses_is_in_the_schema(self):
        schema = json.loads((ROOT / 'config' / 'notion_schema.json').read_text())
        columns = {name for db in schema['databases'].values() for name in db['columns']}
        used = {}
        for file in (ROOT / 'src').rglob('*.py'):
            for match in USES.finditer(file.read_text()):
                name = match.group(1) or match.group(2)
                used.setdefault(name, set()).add(file.relative_to(ROOT).as_posix())
        missing = {name: sorted(files) for name, files in used.items() if name not in columns and name not in NOT_COLUMNS}
        self.assertEqual(missing, {}, 'Add these columns to Notion and config/notion_schema.json (tools/notion_schema.py snapshot)')
        self.assertIn('First seen', used)  # the scan sees real uses


if __name__ == '__main__':
    unittest.main()
