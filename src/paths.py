"""Repository paths shared by every module."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'config'
DATA = ROOT / 'data'
REPORTS = ROOT / 'reports'
CANONICAL_DB = DATA / 'canonical.sqlite'


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
