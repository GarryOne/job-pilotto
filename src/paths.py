"""Repository paths shared by every module."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'config'
DATA = ROOT / 'data'
REPORTS = ROOT / 'reports'
CANONICAL_DB = DATA / 'canonical.sqlite'
