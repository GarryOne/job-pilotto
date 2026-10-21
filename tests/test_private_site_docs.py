"""The public docs, rules and skills know the website lives in the private repo job-pilotto-site: they point there and never tell a session to run or edit public site/."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = [ROOT / 'CLAUDE.md', ROOT / 'AGENTS.md']   # the other top-level docs are on the gate cache's ignore list: no test may read them
DOCS += sorted((ROOT / 'docs' / 'rules').glob('*.md')) + sorted((ROOT / '.claude' / 'skills').rglob('*.md'))
STALE = [r'cd site\b', r'site\.yml', r'tests-site\.yml', r'preview\.yml', r'npx wrangler[^\n`]* --config site']


class PrivateSiteDocsTests(unittest.TestCase):
    def test_the_entry_docs_name_the_private_repo(self):
        for name in ('CLAUDE.md', 'AGENTS.md'):
            text = (ROOT / name).read_text()
            self.assertIn('job-pilotto-site', text, name)
            self.assertIn('private-site.md', text, name)

    def test_no_doc_or_skill_tells_a_session_to_work_in_a_public_site_folder(self):
        for path in DOCS:
            if path.name == 'private-site.md':
                continue
            text = path.read_text()
            for pattern in STALE:
                for hit in re.finditer(pattern, text):
                    line = text[:hit.start()].count('\n') + 1
                    self.assertTrue(False, f'{path.relative_to(ROOT)}:{line} still says "{hit.group(0)}": the site is in the private repo job-pilotto-site')

    def test_the_site_folder_is_not_in_this_repo(self):
        for name in ('site', 'web', 'admin', 'api', 'shared', 'workers', 'db', 'jobs', 'media', 'preview'):
            self.assertFalse((ROOT / name).exists() and any((ROOT / name).rglob('*.js')), f'public {name}/ must not come back: the site folders are in the private repo')


if __name__ == '__main__':
    unittest.main()
