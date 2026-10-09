"""The store interface: one Protocol per entity of the user's data, plain dicts in and out (never Notion JSON).

Every adapter (memory, sqlite, notion, later others) implements these and passes tests/store_contract.py.
Spec: docs/superpowers/specs/2026-10-09-store-adapters.md. Ids are adapter-opaque strings; a job is found by
its URL (normalised by `url_key`). Records carry the keys listed in the *_FIELDS tuples; a missing value is ''
or None, never an absent key.
"""
from dataclasses import dataclass, field
from typing import Optional, Protocol

from ..notion.dedupe import normalize_url

# Kinds of text the user writes and the app reads whole (each Markdown): the Profile, the standard answers and
# form knowledge. ⚙️ Search settings are not a text: their home stays config/search.json + preferences.json on
# the Mac, rendered to a Notion page by src/notion/search_settings.py when the store is Notion (one copy each).
TEXTS = ('profile', 'answers', 'knowledge')

# set_stage outcomes.
CREATED, CHANGED, UNCHANGED = 'created', 'changed', 'unchanged'

# What an adapter can do beyond the contract. The UI asks a capability, never an adapter's name.
LINKS = 'links'      # records have a page the user can open elsewhere (link() returns a URL)
CLOUD = 'cloud'      # reachable from GitHub runners and the Telegram worker (Always on)
FILES = 'files'      # attach() keeps the bytes in the store itself (else a path on this Mac)

APPLICATION_FIELDS = ('id', 'url', 'title', 'company', 'location', 'work_mode', 'stage', 'fit', 'next_step',
                      'next_interview', 'applied_on', 'via', 'contact', 'origin', 'source', 'notes', 'kit_inputs',
                      'rejection', 'rejection_lesson', 'feedback_status', 'employer_feedback', 'salary', 'contract',
                      'call_facts', 'created_at')
EVENT_FIELDS = ('id', 'app_id', 'kind', 'at', 'source', 'note', 'source_id', 'interview_at', 'created_at')
MATCH_FIELDS = ('url', 'title', 'company', 'location', 'work_mode', 'fit', 'reason', 'fit_detail', 'status',
                'first_seen')
INTERVIEW_FIELDS = ('id', 'app_id', 'title', 'at', 'input', 'round', 'overall', 'questions', 'weak_answers', 'topics',
                    'weak_topics', 'next_step', 'cost', 'model', 'notes', 'transcript', 'review', 'created_at')
INSIGHT_FIELDS = ('id', 'day', 'category', 'title', 'body', 'fields', 'created_at')
EMPLOYER_FIELDS = ('id', 'name', 'website', 'careers_url', 'feed', 'active', 'created_at')
AGENT_RUN_FIELDS = ('id', 'url', 'ats', 'outcome', 'fields', 'learnings', 'transcript', 'created_at')
CRON_RUN_FIELDS = ('id', 'kind', 'where', 'status', 'started_at', 'finished_at', 'summary', 'report', 'result',
                   'log', 'progress', 'trigger', 'mode', 'run_url', 'application', 'stats')
# A run's numbers (`stats`, a dict): what Recent activity and Telegram /status show. Keys are these; the Notion adapter maps each to its
# ⏱️ Search runs column (New jobs, Scored, AI cost (USD)…). A key not set is absent from the dict.
RUN_STATS = ('new_jobs', 'changed_jobs', 'scored', 'kits', 'emails', 'updates', 'closed_stale', 'feeds', 'feed_errors',
             'top_new_score', 'duration_s', 'ai_cost_usd', 'tokens_total', 'billed_to', 'telegram')


# Every entity with ids also has `put(record) -> record`: store a record copied from another store as it is (its
# fields and timestamps; a new id of this store). Only the move between stores (src/stores/copy.py) calls it; the
# caller maps ids that point at other records (app_id).


def ref(entity, record_id):
    """How a record is named outside the store when the adapter has no LINKS (the engine's `Cronjob run logged: <link>`
    line, the desktop's run list): `store:<entity>/<id>`. `Stores.link_or_ref` gives the link when there is one."""
    return f'store:{entity}/{record_id}'


def parse_ref(text):
    """(entity, id) from a ref, else None."""
    if not str(text or '').startswith('store:') or '/' not in text:
        return None
    entity, record_id = text[len('store:'):].split('/', 1)
    return (entity, record_id) if entity and record_id else None


def url_key(url):
    """The one key a job is matched by in every adapter."""
    return normalize_url((url or '').strip())


def record(fields, values):
    """A record with exactly `fields`, missing ones ''. Adapters build every record through this."""
    return {name: values.get(name, '') for name in fields}


class Applications(Protocol):
    """Every job the user pursues (📮 Applications in Notion)."""
    def list(self, stages=None) -> list: ...
    def get(self, url) -> Optional[dict]: ...
    def create(self, job: dict, stage: str) -> dict: ...
    def stages(self) -> dict: ...  # {url_key: stage}, the hot path: no full records
    def set_stage(self, job: dict, stage: str, today=None) -> tuple: ...
    # → (record, CREATED | CHANGED | UNCHANGED). Creates the row from `job` (needs 'url') when missing; writes
    # nothing when the stage is already `stage`; stamps applied_on (today, ISO date) on the first 'Applied'.
    def update(self, app_id: str, fields: dict) -> dict: ...
    def delete(self, app_id: str) -> None: ...  # with its sections and files
    # Named Markdown sections of a job's page: the kit, prep, rejection review, the frozen record.
    def section(self, app_id: str, name: str) -> Optional[str]: ...
    def set_section(self, app_id: str, name: str, markdown: str) -> None: ...
    def attach(self, app_id: str, name: str, data: bytes, content_type: str) -> str: ...
    def sections(self, app_id: str) -> dict: ...  # {name: markdown}
    def files(self, app_id: str) -> list: ...     # [(name, bytes, content_type)]
    def put(self, record: dict) -> dict: ...


class Events(Protocol):
    """The outcome history of applications (📈 Application Events)."""
    def list(self, app_id=None, kind=None, source_id=None) -> list: ...
    def add(self, app_id: str, kind: str, at: str, **fields) -> dict: ...
    # Idempotent: with a non-empty source_id (a mail id, a Telegram tap), an event of that app with that
    # source_id is returned as it is instead of a second one.
    def archive(self, app_id: str, kind: str) -> int: ...  # archived events leave list()
    def put(self, record: dict) -> dict: ...


class Matches(Protocol):
    """What a search found and scored (🎯 Job Matches)."""
    def list(self, status=None) -> list: ...
    def upsert(self, job: dict) -> dict: ...
    def set_status(self, url: str, status: str) -> None: ...
    def remove(self, url: str) -> None: ...


class Interviews(Protocol):
    """🎤 Interviews. `transcript` and `review` are whole Markdown fields: an adapter with pages rewrites
    that section whole; a block-level patch is the adapter's own business."""
    def list(self, app_id=None) -> list: ...
    def get(self, interview_id: str) -> Optional[dict]: ...
    def save(self, interview_id: Optional[str], fields: dict) -> dict: ...
    def archive(self, interview_id: str) -> None: ...
    def put(self, record: dict) -> dict: ...


class Insights(Protocol):
    """💡 Insights. `fields` holds the extras (basis, confidence, sample_size, evidence, action, feedback, cost, …)."""
    def list(self, since=None, category=None, limit=None) -> list: ...
    # The daily insight and weekly report: one per day+category, a second save that day replaces it.
    def save(self, day: str, category: str, title: str, body: str, fields=None) -> dict: ...
    # Rows of their own: several a day (learning's issues), or one kept and updated in place (Interview patterns).
    def add(self, record: dict) -> dict: ...
    def update(self, insight_id: str, fields: dict) -> dict: ...
    def put(self, record: dict) -> dict: ...


class Employers(Protocol):
    def list(self, active=True) -> list: ...
    def add(self, employer: dict) -> dict: ...  # one per name
    def put(self, record: dict) -> dict: ...


class AgentRuns(Protocol):
    """Form fills and Apply sessions (🤖 Agent Runs)."""
    def add(self, run: dict) -> dict: ...
    def update(self, run_id: str, fields: dict) -> dict: ...
    def list(self, ats=None, limit=None) -> list: ...
    def put(self, record: dict) -> dict: ...


class CronRuns(Protocol):
    """Every run's row (⏱️ Search runs): the one run history."""
    def begin(self, kind: str, where: str, fields=None) -> dict: ...  # fields: trigger, mode, run_url, application
    def progress(self, run_id: str, line: str) -> None: ...
    def finish(self, run_id: str, status: str, summary='', report='', result='', log='', stats=None) -> dict: ...
    def get(self, run_id: str) -> Optional[dict]: ...
    def list(self, since=None, kind=None) -> list: ...
    def put(self, record: dict) -> dict: ...


class Texts(Protocol):
    def get(self, name: str) -> str: ...
    def set(self, name: str, markdown: str) -> None: ...


@dataclass
class Stores:
    """One adapter's entities, as the rest of the code sees them."""
    name: str
    applications: Applications
    events: Events
    matches: Matches
    interviews: Interviews
    insights: Insights
    employers: Employers
    agent_runs: AgentRuns
    cron_runs: CronRuns
    texts: Texts
    caps: frozenset = field(default_factory=frozenset)

    def link(self, record_id) -> Optional[str]:
        """A URL the user can open for a record, when the adapter has LINKS; else None."""
        return None

    def link_or_ref(self, entity, record_id) -> str:
        return self.link(record_id) or ref(entity, record_id)
