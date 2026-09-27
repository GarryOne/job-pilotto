"""Repository paths shared by every module."""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv():
    """Fill os.environ from a root .env file, without overriding anything already set.

    Not a replacement for the macOS Keychain (still the primary local secret store here — see
    CLAUDE.md), just a fallback so a fork on Linux/CI/another machine has something to copy
    .env.example into and just run, instead of needing Keychain or manual `export` every session.
    Runs once at import time so every entry point picks it up without calling anything extra."""
    env_file = ROOT / '.env'
    # The desktop app passes every setting itself; the repo's .env belongs to the developer.
    if not env_file.exists() or os.getenv('JOB_PILOTTO_NO_DOTENV'):
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

# The desktop app keeps each user's settings and data in its own folder (Application Support), so the
# same code runs from the repo (defaults below) or from the app, which sets these variables.
CONFIG = Path(os.environ['JOB_PILOTTO_CONFIG_DIR']) if os.getenv('JOB_PILOTTO_CONFIG_DIR') else ROOT / 'config'
DATA = Path(os.environ['JOB_PILOTTO_DATA_DIR']) if os.getenv('JOB_PILOTTO_DATA_DIR') else ROOT / 'data'
REPORTS = DATA / 'reports' if os.getenv('JOB_PILOTTO_DATA_DIR') else ROOT / 'reports'
JOBS_DB = DATA / 'jobs.sqlite'


def local_text(variable):
    """Text of a local file named by an environment variable (the desktop app's Profile and
    standard answers), or None. When set, it replaces the Notion page of the same role."""
    path = os.getenv(variable)
    if not path or not Path(path).is_file():
        return None
    return Path(path).read_text(encoding='utf-8').strip() or None


def local_profile():
    return local_text('JOB_PILOTTO_PROFILE_FILE')


def local_answers():
    return local_text('JOB_PILOTTO_ANSWERS_FILE')


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
