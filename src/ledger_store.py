"""The application ledger on the store (src/stores): stage events, the Applied mark and the frozen record, for every
adapter (sqlite, notion, memory). What src/notion/ledger.py does on a Notion `tracker`, written on records.

The rules are shared, not copied: when an event repeats one already there (src/stores/rules.py add_event), what a
record holds (build_fields) and its section's text (record_markdown) come from src/notion/ledger_events_util.py and
ledger_record.py, which the Notion path asks too. On Notion the section is today's "🗂 Application record" toggle
(the store's block codec). Callers that still hold a tracker keep src/notion/ledger.py until their lane moves.
Guarded by tests/test_ledger_store.py (memory store; Notion parity on the stand-in).
"""
import json
import re
from datetime import date, datetime, timezone

from .ai import kit as kit_module
from .notion import ledger
from .notion.ledger_record import RECORD_HEADING, build_fields, cv_version, record_markdown
from .sources import ats
from .stores import base, rules


def _tracker(stores):
    """The Notion client behind a notion store, for what its adapter doesn't serve yet (Job Matches, Agent Runs)."""
    return getattr(stores.applications, 'tracker', None)


def find(stores, url):
    app = stores.applications.get(url)
    if not app:
        raise LookupError(f'No Applications row for {url}')
    return app


# ---------- events ----------

def add_event(stores, app, kind, source, *, at=None, note='', source_id='', interview_at=''):
    """One event of the application `app` (its record), as src/notion/ledger.py add_event: the dedupe is
    rules.add_event's (one copy, above the interface); a repeat is returned as it is, marked `_existing`."""
    event, existing = rules.add_event(stores, app, kind, source, at=at, note=note, source_id=source_id,
                                      interview_at=interview_at)
    return {**event, '_existing': True} if existing else event


def archive_events(stores, app, kind):
    """This application's events of one kind leave its timeline (an Applied that never was); how many."""
    return stores.events.archive(app['id'], kind)


# ---------- the frozen record ----------

def _kit(stores, app_id):
    """The application kit: the JSON fence in the kit's section (the last one), or None."""
    text = stores.applications.section(app_id, kit_module.KIT_HEADING) or ''
    fences = re.findall(r'```json\n(.*?)\n```', text, re.S)
    try:
        return json.loads(fences[-1]) if fences else None
    except ValueError:
        return None


def match_of(stores, url, app):
    """The job's scores as src/notion/ledger_record.py match_for gives them ({'Score', 'Seniority', ...}): the 🎯 match
    when there is one, else the application's own fit columns (a job you added has no match)."""
    tracker = _tracker(stores)
    try:
        found = next((m for m in stores.matches.list() if base.url_key(m['url']) == base.url_key(url)), None)
        if found:
            return {k: v for k, v in {'Score': found['fit'], 'Work mode': found['work_mode'], 'Job': found['title'],
                                       'Company': found['company'], 'Location': found['location']}.items()
                    if v not in (None, '')}
    except NotImplementedError:  # the notion store serves no matches yet: its Job Matches row, as before
        from .notion import client as notion
        if tracker is not None and notion.MATCHES_DATABASE_ID:
            from .notion.ledger_blocks import plain
            rows = tracker.query_database(notion.MATCHES_DATABASE_ID, {'property': 'Job URL', 'url': {'equals': url}})
            if rows:
                return {name: plain(prop) for name, prop in rows[0]['properties'].items()}
    own = {'Score': app.get('fit'), 'Seniority': app.get('seniority'), 'Work mode': app.get('work_mode'),
           'Tier': app.get('tier'), 'Salary': app.get('salary')}
    if app.get('recruiter'):
        own['Recruiter'] = True
    return {name: value for name, value in own.items() if value not in (None, '')}


def run_of(stores, url, app, run_dir=None):
    """The form-filling run ({'agent', 'minutes', ...}): the local run file, else the latest agent run of the job."""
    run = ledger.run_state(url, run_dir)
    if run is not None:
        return run
    try:
        runs = [r for r in stores.agent_runs.list() if base.url_key(r['url']) == base.url_key(url)]
    except NotImplementedError:  # the notion store serves no agent runs yet: the row's 🤖 Agent runs links, as before
        tracker = _tracker(stores)
        if tracker is None or not hasattr(tracker, '_request'):
            return None
        return ledger.run_from_notion(tracker, tracker._request('GET', f"pages/{app['id']}"))
    fields = [r.get('fields') or {} for r in runs]
    latest = max(fields, key=lambda f: f.get('started') or '', default=None)
    if not latest or not latest.get('agent'):
        return None
    return {'agent': str(latest['agent']).lower(), 'minutes': latest.get('minutes'), 'status': latest.get('status')}


def record(stores, url, *, now=None, force=False, posting=ats.posting, cv_path=ledger.DEFAULT_CV,
           snapshot_dir=None, run_dir=None):
    """Freeze the application record: its columns on the application, its text as the "🗂 Application record"
    section. Returns (app, 'recorded' | 'exists'); an existing record is kept unless force, or only kit drafts were
    known and the submitted form now is."""
    now = now or datetime.now(timezone.utc)
    app = find(stores, url)
    form = ledger.form_snapshot(url, snapshot_dir)
    upgrade = form and app.get('answers_captured') != 'Form'
    if app.get('recorded') and not (force or upgrade):
        return app, 'exists'
    fields, data = build_fields(url, app, _kit(stores, app['id']), match_of(stores, url, app), posting(url), form,
                                run_of(stores, url, app, run_dir), cv_version(cv_path), now)
    app = stores.applications.update(app['id'], fields)
    stores.applications.set_section(app['id'], RECORD_HEADING, record_markdown(data))
    return app, 'recorded'


# ---------- stages ----------

def mark_applied(stores, url, source='CLI', today=None, **record_options):
    """Stage → Applied (rules.mark: never over a later stage), an Applied event, and the frozen record. The record
    never blocks the marking: a failure there is reported, and `record --force` can redo it. Same lines as
    src/notion/ledger.py mark_applied."""
    today = today or date.today()
    app, outcome = rules.mark(stores, {'url': url}, 'Applied', today)
    lines = [f'{url}: {outcome}']
    if outcome != base.UNCHANGED:
        add_event(stores, app, 'Applied', source)
    try:
        _, recorded = record(stores, url, **record_options)
        lines.append(f'application record: {recorded}')
    except Exception as error:  # noqa: BLE001 — marking must succeed even if the snapshot can't
        lines.append(f'application record skipped: {type(error).__name__}: {error}')
    return '\n'.join(lines)


def set_stage(stores, url, stage, source='CLI', note=''):
    """Move an application to an outcome stage and log the event (a reply is an event only)."""
    if stage not in ledger.EVENT_KINDS:
        raise ValueError(f'Stage must be one of: {", ".join(ledger.EVENT_KINDS)}')
    if stage == 'Applied':
        return mark_applied(stores, url, source)
    app = find(stores, url)
    if stage != ledger.REPLY:
        changes = {'stage': stage}
        if stage == 'Rejected' and not app.get('feedback_status'):
            from . import feedback
            history = stores.events.list(app_id=app['id'])
            if app.get('stage') in feedback.REACHED or feedback.eligible_status(app.get('feedback_status'), history):
                changes['feedback_status'] = 'Not asked'
        app = stores.applications.update(app['id'], changes)
    add_event(stores, app, stage, source, note=note)
    return f'{url}: {stage}'


# ---------- an application made elsewhere ----------

def _fields_of(props):
    """Application fields from Notion-shaped column values (src/ai/added.py application_columns still writes those)."""
    from .stores import notion_rows
    return {field: notion_rows.read(props[column], kind) for field, column, kind in notion_rows.APPLICATION_COLUMNS
            if column in props}


def add_application(stores, url, *, applied=None, approx=False, channel=None, via=None, source='CLI', meta=None,
                    today=None, origin=None, found=None):
    """Track an application made outside Job Pilotto (or before it): the application at Applied, an Applied event on
    its date, and the frozen record. Same arguments and summary line as src/notion/ledger.py add_application.
    found: a dict that gets the application record ('row') and whether it was created ('created')."""
    from .notion import origin as origin_rule
    today = today or date.today()
    applied = applied or today
    meta = dict(meta if meta is not None else ledger.page_meta(url))
    if not meta.get('company'):
        found_ats = ats.detect(url)
        meta['company'] = match_of(stores, url, {}).get('Company') or (
            found_ats[1].replace('-', ' ').title() if found_ats else '')
    guess_channel, guess_via = ledger.channel_for(url)
    channel, via = channel or guess_channel, via if via is not None else guess_via
    fields = {'stage': 'Applied', 'applied_on': applied.isoformat(), 'date_approximate': bool(approx), 'channel': channel}
    if via:
        fields['via'] = via
    columns = _fields_of(meta.get('application_columns') or {})
    app = stores.applications.get(url)
    existed = bool(app)
    if app:
        if app['stage'] in ledger.OUTCOME_STAGES and app['stage'] != 'Applied':
            return f'Already tracked at {app["stage"]}: {app["title"]}'
        fields.update({name: value for name, value in columns.items()
                       if name == 'fit' or app.get(name) in (None, '')})  # what you set stays
        app = stores.applications.update(app['id'], fields)
    else:
        posted = (meta.get('date_posted') or '')[:10]
        fields.update({'url': url, 'title': (meta.get('title') or url)[:200], 'company': meta.get('company') or '',
                       'location': meta.get('location') or '', 'source': 'Manual' if source == 'CLI' else source,
                       'origin': origin_rule.LABELS[origin_rule.stored(origin) or origin_rule.OUTBOUND]})
        if ledger._day(posted):
            fields['posted'] = posted
        fields.update(columns)
        app = stores.applications.create({k: v for k, v in fields.items() if k != 'stage'}, 'Applied')
    if found is not None:
        found.update(row=app, created=not existed)
    add_event(stores, app, 'Applied', source, at=applied.isoformat(),
              note='Applied outside Job Pilotto' + ('; date is an upper bound (on or before)' if approx else ''))
    try:
        _, recorded = record(stores, url, posting=lambda _url: meta)
    except Exception as error:  # noqa: BLE001
        recorded = f'record skipped: {type(error).__name__}'
    title = app.get('title') or meta.get('title') or url
    company = app.get('company') or meta.get('company') or '?'
    when = ('on or before ' if approx else '') + applied.isoformat()
    return f'Tracked: {title} — {company}, applied {when} ({channel}{f" via {via}" if via else ""}); {recorded}'


# ---------- the scheduled checks ----------

def latest_events(stores):
    """app id → {'kind', 'at'} of its latest stage event, 'last' (its latest event of any kind), 'replied' and
    'kinds', as src/notion/ledger.py latest_events gives them per Notion page."""
    from .notion.ledger_events_util import moment
    latest = {}
    for event in stores.events.list():
        at, kind = event['at'] or '', event['kind']
        item = latest.setdefault(event['app_id'], {'kind': None, 'at': '', 'last': '', 'replied': False})
        item['last'] = max(item['last'], at, key=moment) if item['last'] else at
        item['replied'] |= kind == ledger.REPLY
        item.setdefault('kinds', set()).add(kind)
        if kind in ledger.OUTCOME_STAGES and (not item['at'] or moment(at) >= moment(item['at'])):
            item.update(kind=kind, at=at)
    return latest


def sync(stores, now=None, no_response_days=ledger.NO_RESPONSE_DAYS, dry_run=False):
    """A stage set without an event (edited by hand) becomes one, dated by the row's last change; an application with
    no reply after no_response_days goes to No response. The same summary line as the Notion path."""
    from .notion.ledger_events_util import moment
    now = now or datetime.now(timezone.utc)
    apps = stores.applications.list(stages=list(ledger.OUTCOME_STAGES))
    latest = latest_events(stores)
    logged, silent = 0, 0
    for app in apps:
        stage = app['stage']
        info = latest.get(app['id'], {'kind': None, 'at': '', 'last': '', 'replied': False})
        last_at = info['last']
        if info['kind'] != stage and stage not in info.get('kinds', ()):
            when = app['applied_on'] if stage == 'Applied' else app.get('updated_at')
            if not dry_run:
                source, note = (('Backfill', 'First event for an application tracked before the ledger')
                                if info['kind'] is None else
                                ('Notion edit', 'Stage changed in Notion; time is when the row was last edited'))
                add_event(stores, app, stage, source, at=when or now.isoformat(timespec='seconds'), note=note)
            logged, last_at = logged + 1, max(last_at, when or '', key=moment)
        applied = ledger._day(app['applied_on'])
        last = ledger._day(last_at) or applied
        if (stage in ledger.WAITING_STAGES and not info['replied'] and applied and last
                and (now.date() - last).days >= no_response_days):
            if not dry_run:
                app = stores.applications.update(app['id'], {'stage': 'No response'})
                add_event(stores, app, 'No response', 'Auto rule',
                          note=f'No reply {(now.date() - applied).days} days after applying')
            silent += 1
    return f'Ledger sync: {len(apps)} applications, {logged} stage change(s) logged, {silent} moved to No response.'


def close_gone(stores, open_urls=None, dry_run=False):
    """Saved / Kit ready jobs whose posting was taken down → Closed (the kit stays). The job's own board decides; one
    that can't tell closes nothing. Returns (summary line, ["Title (Company)", …]) as the Notion path."""
    apps = stores.applications.list(stages=list(ledger.NOT_STARTED))
    closed = []
    for app in apps:
        url = (app['url'] or '').strip()
        if not url or (open_urls is not None and url in open_urls):
            continue
        if ats.is_live(url, app['company']) is not False:
            continue
        current = stores.applications.get(url)  # read again: the owner may have started applying since
        if (current or {}).get('stage') not in ledger.NOT_STARTED:
            continue
        name = f"{app['title'] or url} ({app['company'] or '?'})"
        print(f'Posting taken down, marked Closed: {url} · {name}')
        if not dry_run:
            stores.applications.update(current['id'], {'stage': 'Closed'})
        closed.append(name)
    return f'Taken-down postings: {len(apps)} saved/kit-ready job(s), {len(closed)} closed.', closed
