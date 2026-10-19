"""The product is called Jobadabra on every screen, message and page a user sees (19 Oct 2026); "Job Pilotto" survives only where it is an internal name.

Fails with file:line when a user-facing file says "Job Pilotto" again. Comment lines are skipped; the lines below are the kept internal names
(the data folder, the stored event source, old extension and export names that must still be recognised, the Google app's own name).
The backend renames (data folder, appId, Keychain, env, repos, Workers) are a later, step-by-step plan.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
USER_FACING = [
    'desktop/renderer/**/*.html', 'desktop/renderer/**/*.js', 'desktop/lib/**/*.js', 'desktop/main.js', 'desktop/preload.cjs', 'desktop/start.js',
    'extension/*.html', 'extension/*.js', 'extension/manifest.json',
    'site/public/*.html', 'site/src/mail*.js', 'site/src/install.js', 'site/src/notion.js', 'site/src/linkedin.js', 'site/src/free-ai.js',
    'worker/src/*.js', 'src/tgcard.py', 'src/digest.py', 'src/notify.py', 'src/doctor.py', 'src/focus_items.py', 'src/ai/mail_lines.py',
]
# Internal names that stay (backend, moved later): a line is allowed when it matches one of these.
KEPT = [
    r"Application Support|APPDATA|Job Pilotto backup|Job Pilotto Backups|\.app\b|/Job Pilotto",          # the real data folder and the bundle's file name
    r"'Job Pilotto app'|manifest\??\.app|app: 'Job Pilotto'",       # stored event source, export manifest id
    r"\[NAME, 'Job Pilotto'\]|LEGACY_NAME|!== 'Job Pilotto'",       # an install from before the rename is still recognised
    r"Job Pilotto Brain|Job Pilotto – Live Test|archived 28 Sep",   # owner-only bot, the twin's mirror, an old Notion page name
    r"# Job Pilotto|GitHub App|job-pilotto",                        # a repo file header written by older versions; identifiers
    r"before the rename|Job Pilotto QA|missing: \['Job Pilotto'\]",  # old-name recognisers, the QA pool's name
    r"quit app \"Job Pilotto\"|extension installed and the person",  # the bundle's name for osascript; an agent-only twin brief
]


class BrandWording(unittest.TestCase):
    def test_user_facing_files_say_jobadabra(self):
        kept = re.compile('|'.join(KEPT))
        bad = []
        for pattern in USER_FACING:
            for path in sorted(ROOT.glob(pattern)):
                if 'node_modules' in path.parts:
                    continue
                for number, line in enumerate(path.read_text(errors='ignore').splitlines(), 1):
                    if 'Job Pilotto' not in line or line.lstrip().startswith(('//', '#', '*', '/*', '<!--')) or kept.search(line):
                        continue
                    bad.append(f'{path.relative_to(ROOT)}:{number}: {line.strip()[:110]}')
        self.assertEqual(bad, [], 'say "Jobadabra" (or add the kept internal name to KEPT):\n' + '\n'.join(bad[:40]))


if __name__ == '__main__':
    unittest.main()
