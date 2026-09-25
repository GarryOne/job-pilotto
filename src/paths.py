"""Repository paths shared by every module."""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'config'
DATA = ROOT / 'data'
REPORTS = ROOT / 'reports'
JOBS_DB = DATA / 'jobs.sqlite'


def _load_dotenv():
    """Fill os.environ from a root .env file, without overriding anything already set.

    Not a replacement for the macOS Keychain (still the primary local secret store here — see
    CLAUDE.md), just a fallback so a fork on Linux/CI/another machine has something to copy
    .env.example into and just run, instead of needing Keychain or manual `export` every session.
    Runs once at import time so every entry point picks it up without calling anything extra."""
    env_file = ROOT / '.env'
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.match(r'^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line)
        if not match:
            continue
        key, value = match.group(1), match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_dotenv()


def load_search_config():
    """config/search.json: role/location/stack keywords, as regex fragments. Edit to change what

    this project searches for and where — role_keywords/board_discovery_keywords/
    jobs_board_search_queries/quality_stack_keywords/locations.{top_tier,country_wide,abroad}/
    remote_excluded_regions. See README.md's Configuration section."""
    return json.loads((CONFIG / 'search.json').read_text())


def keyword_regex(fragments):
    """Case-insensitive regex matching any of these already-regex fragments (word boundaries,

    optional chars etc. are the fragment author's choice — see config/search.json)."""
    import re
    return re.compile('|'.join(fragments), re.I)
