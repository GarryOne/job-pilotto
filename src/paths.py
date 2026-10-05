"""Repository paths shared by every module."""
import contextlib
import json
import os
import re
import sys
import time
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


def app_folder():
    """The Desktop App's data folder (its settings, Notion IDs, job cache), or JOB_PILOTTO_APP_DIR."""
    if os.getenv('JOB_PILOTTO_APP_DIR'):
        return Path(os.environ['JOB_PILOTTO_APP_DIR'])
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'Job Pilotto'
    if sys.platform == 'win32':
        return Path(os.getenv('APPDATA') or Path.home() / 'AppData' / 'Roaming') / 'Job Pilotto'
    return Path(os.getenv('XDG_CONFIG_HOME') or Path.home() / '.config') / 'Job Pilotto'


def workspace_repo(folder=None):
    """The repository that holds the workspace: 'owner/job-pilotto-private', or how far the Desktop App got.

    The scheduled runs and a Gmail check need this repo's NOTION_* variables and secrets (the app writes them
    when Always on is set up); this engine repo has none. Anything that dispatches a workflow or asks GitHub
    about a run must use this, never the engine checkout it happens to be running from (1 Oct 2026: the
    post-application watcher dispatched mail.yml here, and every submitted application queued a run that could
    only fail — no NOTION_APPLICATIONS_DB, so Notion answered 400).
    JOB_PILOTTO_CLOUD_REPO overrides (tests, CI). '' when nothing is set up."""
    given = (os.getenv('JOB_PILOTTO_CLOUD_REPO') or '').strip()
    if given:
        return given
    folder = Path(folder) if folder else app_folder()
    try:
        settings = json.loads((folder / 'settings.json').read_text())
    except (OSError, ValueError):
        return ''
    return str((settings.get('cloud') or {}).get('repo') or '').strip()


def follow_app(env=os.environ, folder=None):
    """The terminal follows the Desktop App: same Notion workspace, same job cache and search settings.

    When the app is set up on this computer, every NOTION_* ID the environment (or .env) doesn't set comes from
    the app's settings, and the data and config folders are the app's. If .env sets a NOTION_* ID of another
    workspace (a test one, on purpose), nothing is taken: that run keeps its own workspace and job cache. Off when the app itself runs the pipeline
    (it passes everything), in tests, or with JOB_PILOTTO_FOLLOW_APP=0. -> what was taken ({} = nothing)."""
    if env.get('JOB_PILOTTO_NO_DOTENV') or env.get('JOB_PILOTTO_FOLLOW_APP') == '0' or 'unittest' in sys.modules:
        return {}
    folder = Path(folder) if folder else app_folder()
    try:
        settings = json.loads((folder / 'settings.json').read_text())
    except (OSError, ValueError):
        return {}
    if not settings.get('setupDone') or not settings.get('notionIds'):
        return {}
    ids = {name: str(value) for name, value in settings['notionIds'].items() if value and name.startswith('NOTION_')}
    other = sorted(name for name in ids if env.get(name) and env[name].replace('-', '') != ids[name].replace('-', ''))
    if other:  # .env points at another workspace on purpose: that run keeps its own job cache too (never mixed)
        print(f'Not using the Desktop App\'s workspace: .env sets {", ".join(other)}', file=sys.stderr)
        return {}
    taken = {}
    for name, value in ids.items():
        if not env.get(name):
            env[name] = taken[name] = value
    for name, sub in (('JOB_PILOTTO_DATA_DIR', 'data'), ('JOB_PILOTTO_CONFIG_DIR', 'config')):
        if not env.get(name) and (folder / sub).is_dir():
            env[name] = taken[name] = str(folder / sub)
    if taken:
        print(f'Using the Desktop App\'s Notion workspace and job data ({folder})', file=sys.stderr)
    return taken


FOLLOWED = follow_app()

# The desktop app keeps each user's settings and data in its own folder (Application Support), so the
# same code runs from the repo (defaults below) or from the app, which sets these variables.
# Tests read their own example user (an SRE in Zurich, tests/fixtures/config), never the shipped example defaults.
CONFIG = (Path(os.environ['JOB_PILOTTO_CONFIG_DIR']) if os.getenv('JOB_PILOTTO_CONFIG_DIR')
          else ROOT / 'tests' / 'fixtures' / 'config' if 'unittest' in sys.modules else ROOT / 'config')
DATA = Path(os.environ['JOB_PILOTTO_DATA_DIR']) if os.getenv('JOB_PILOTTO_DATA_DIR') else ROOT / 'data'
REPORTS = DATA / 'reports' if os.getenv('JOB_PILOTTO_DATA_DIR') else ROOT / 'reports'
JOBS_DB = DATA / 'jobs.sqlite'


@contextlib.contextmanager
def run_lock(folder=None, on_wait=lambda: print('Another Job Pilotto search is running (app or terminal): waiting for it…',
                                                file=sys.stderr), poll=5, name='run'):
    """One search at a time per data folder, whether the app or the terminal started it (they share the cache). name: another
    job that must take turns the same way, with its own lock (e.g. 'insights': one interview-insights refresh at a time)."""
    folder = Path(folder or DATA)
    folder.mkdir(parents=True, exist_ok=True)
    handle = open(folder / f'{name}.lock', 'a+')
    try:
        if sys.platform == 'win32':
            import msvcrt
            lock = lambda: msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            unlock = lambda: msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            lock = lambda: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            unlock = lambda: fcntl.flock(handle, fcntl.LOCK_UN)
        told = False
        while True:
            try:
                lock()
                break
            except OSError:
                if not told:
                    on_wait()
                    told = True
                time.sleep(poll)
        try:
            yield
        finally:
            unlock()
    finally:
        handle.close()


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
    config = json.loads((CONFIG / 'search.json').read_text())
    # The central scout (private repo job-pilotto-internal) judges feeds for everyone in engineering and IT, worldwide, not
    # by one user's example profile: a file named in JOB_PILOTTO_LOCATIONS_FILE replaces those parts of this config.
    override = os.getenv('JOB_PILOTTO_LOCATIONS_FILE')
    if override:
        extra = json.loads(Path(override).read_text())
        config.update({k: extra[k] for k in ('locations', 'remote_excluded_regions', 'role_keywords', 'title_exclude_keywords',
                        'quality_stack_keywords') if k in extra})
    return with_matching_words(config)


def with_matching_words(config):
    """The settings as the crawl matches them: a region word in the places (Romandie, Switzerland) stands for its cities (src/regions.py), and a
    level (junior, mid, senior, lead) adds the titles that plainly name another level to the skipped titles (src/levels.py). In memory only:
    config/search.json and the Notion page keep what the user wrote."""
    from . import levels, regions
    places = config.get('locations') or {}
    from . import places as ai_places
    cache = ai_places.load()   # place words worked out by AI once and kept (src/places.py): no call here
    config['locations'] = {**places, **{key: ai_places.expand(regions.expand(places[key]), cache) for key in ('top_tier', 'country_wide', 'abroad') if key in places}}
    skips = levels.title_skips(config.get('level'))
    if skips:
        config['title_exclude_keywords'] = [*(config.get('title_exclude_keywords') or []), *[s for s in skips if s not in (config.get('title_exclude_keywords') or [])]]
    return config


def keyword_regex(fragments):
    """Case-insensitive regex matching any of these already-regex fragments (word boundaries,

    optional chars etc. are the fragment author's choice — see config/search.json)."""
    import re
    return re.compile('|'.join(fragments), re.I)
