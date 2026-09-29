"""docs/notion-schema.md documents every column of config/notion_schema.json (fix: python3 tools/notion_schema.py docs).

A new user's workspace is built from the schema at connect and start-up (desktop/lib/schema.js), and
test_notion_schema_coverage.py fails when the code uses a column the schema lacks; this keeps the docs in step too."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import notion_schema  # noqa: E402


class DocsCoverageTest(unittest.TestCase):
    def test_every_schema_column_is_documented(self):
        missing = notion_schema.undocumented(notion_schema.load(), notion_schema.DOCS.read_text())
        self.assertEqual(missing, [], 'Run: python3 tools/notion_schema.py docs (then write their Notes)')

    def test_the_sync_adds_a_missing_column_to_its_own_table(self):
        schema = {'databases': {'X': {'title': '📈 Application Events', 'columns': {'At': {'type': 'date'}, 'Needs you': {'type': 'checkbox'}}}}}
        text = '## 📈 Application Events (database)\n\n| Property | Type | Notes |\n|---|---|---|\n| At | Date | |\n\n## Next (database)\n'
        after = notion_schema.document(schema, text)
        self.assertIn('| At | Date | |\n| Needs you | Checkbox |  |\n\n## Next', after)
        self.assertEqual(notion_schema.undocumented(schema, after), [])


if __name__ == '__main__':
    unittest.main()
