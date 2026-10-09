"""📥 Log anything, part 3: what a log writes through the active store (src/stores): the job's logged entry (base.LOGGED) with
its screenshots, a new application, the gaps a message fills, when the first contact happened. Re-exported by src/ai/inbox.py.
On Notion every entry is the page's folded toggle as before (applications.append_entry); this Mac's stores keep a section.
Tests: tests/test_inbox.py, tests/test_inbox_gaps.py, tests/test_origin_column.py, tests/test_inbox_store.py.
"""
import re
import sys
from datetime import datetime

from ..notion import cron_runs
from ..notion import origin as origin_rule, titles
from ..notion.ledger import _block
from ..stores import base, rules
from . import mail, opportunity
from .inbox_dates import _day
from .inbox_reading import APPLIED, images_of, step


def _tracker(stores):
    """Notion's client when the store is Notion (screenshots on the run's page, today's job list); None on this Mac."""
    return getattr(stores.applications, 'tracker', None)


def _image_blocks(tracker, image):
    """The screenshots as Notion image blocks (uploaded); one that fails to upload is left out."""
    blocks, shots = [], images_of(image)
    for number, shot in enumerate(shots, 1):
        step(f"Saving screenshot {number} of {len(shots)} in Notion" if len(shots) > 1 else "Saving the screenshot in Notion")
        try:
            upload = tracker.upload_file(*(shot[3] if len(shot) > 3 else shot[:3]))  # the small copy when the app made one
        except Exception as error:  # noqa: BLE001 — the update matters more than the picture
            print(f'Warning: screenshot not uploaded to Notion: {type(error).__name__}: {error}', file=sys.stderr)
            continue
        blocks.append({'object': 'block', 'type': 'image', 'image': {'type': 'file_upload', 'file_upload': {'id': upload}}})
    return blocks


def _place_screenshots(stores, image, summary):
    """Where a log's screenshots go on Notion: on the run that logged them (Logged activity in ⏱️ Search runs), small, side
    by side. Returns the Markdown line for the job's entry (a link to that run), or '' (no screenshot, not Notion, or no
    run open: then _attach_screenshots keeps them as the job's files)."""
    tracker = _tracker(stores)
    if tracker is None or not images_of(image) or not cron_runs.running():  # uploaded only when a run will hold them
        return ''
    shots = _image_blocks(tracker, image)
    if not shots:
        return ''
    url = cron_runs.attach([_block('heading_3', f'📥 {summary}'[:200])] + _thumbnails(shots))
    return f'[Screenshots: saved with this run]({url})' if url else ''


def _files(image):
    """The screenshots to keep with the job: (name, bytes, type), the small copy when the app made one."""
    return [tuple(shot[3] if len(shot) > 3 else shot[:3]) for shot in images_of(image)]


def _attach_screenshots(stores, app_id, image):
    """A recruiter pitch's screenshots with no run open (a terminal log) or on this Mac: the job's own files
    (applications.attach). Returns how many were kept."""
    kept = 0
    for name, data, kind in _files(image):
        try:
            stores.applications.attach(app_id, name, data, kind)
            kept += 1
        except Exception as error:  # noqa: BLE001 — the update matters more than the picture
            print(f'Warning: screenshot not kept: {type(error).__name__}: {error}', file=sys.stderr)
    return kept


def _thumbnails(blocks):
    """Screenshots side by side in columns: small on the page, full size in Notion's viewer when clicked."""
    if len(blocks) < 2:
        return blocks
    return [{'object': 'block', 'type': 'column_list', 'column_list': {'children': [
        {'object': 'block', 'type': 'column', 'column': {'children': [block]}} for block in blocks]}}]


def _quote(part):
    return '\n'.join(f'> {line}' if line.strip() else '>' for line in part.strip().split('\n'))


def _keep(stores, app, text, image, summary, when, platform=None, check=(), changes=()):
    """What was logged, on the job: one entry per log ("📥 29 Sep 2026 · what it said") with the message as quotes, what to
    check, what it changed and its screenshots (base.LOGGED; on Notion the page's folded toggle as before)."""
    try:
        day = datetime.fromisoformat(when.replace('Z', '+00:00')).strftime('%d %b %Y')
    except ValueError:
        day = when[:10]
    if platform and _platform_named(summary) != platform:
        summary = f'{platform} · {summary}'  # the entry says where it came from
    lines = []
    if check:  # logged without your confirmation (Telegram): what to check, on the job itself
        lines.append(f"⚠️ Check these details: {'; '.join(check)}.")
    if changes:  # a value this log replaced, before → after: a job's big changes leave a trail
        lines.append(f"Changed: {'; '.join(changes)}")
    lines += [_quote(part) for part in re.split(r'\n\s*\n', text.strip())[:40] if part.strip()] if text else []
    linked = _place_screenshots(stores, image, summary)  # on Notion with a run open: the run holds them, the entry links it
    if linked:
        lines.append(linked)
    try:
        stores.applications.append_entry(app['id'], base.LOGGED, f'📥 {day} · {summary}'[:1900], '\n\n'.join(lines) or summary,
                                         files=[] if linked else _files(image))
    except Exception as error:  # noqa: BLE001
        print(f'Warning: not copied to the job: {type(error).__name__}: {error}', file=sys.stderr)


def _channel_named(item):
    """What a log entry names as its channel: a known one (LinkedIn, Email, a confirmed Phone), or what you typed
    for Other (WhatsApp); None when unknown (then the entry says nothing about it)."""
    platform = item.get('platform')
    if platform == 'Other':
        return item.get('channel_other') or None
    return platform if platform in opportunity.CHANNEL_SOURCE else None


def _new_row(stores, item, url, source, event_source, when, note):
    """A role not known anywhere, applied elsewhere: an application at Applied (date approximate) + its event."""
    fields = opportunity.fields(item, url, APPLIED, source, origin='Logged from a paste')
    fields.update(recruiter=bool(item.get('recruiter_name')) and not item.get('in_house'),
                  origin=origin_rule.LABELS[origin_rule.OUTBOUND])  # applied elsewhere: you went after it (src/notion/origin.py)
    if not item.get('recruiter_name'):
        fields['channel'] = 'Direct'
    day = _day(when)
    if day:
        fields.update(applied_on=day.isoformat(), date_approximate=True)
    record = stores.applications.create(fields, APPLIED)
    rules.add_event(stores, record, APPLIED, event_source, at=day.isoformat() if day else None,
                    note=f'Applied outside Job Pilotto; {note} (date is an upper bound)'[:300])
    return record


def _row_for(stores, url):
    return stores.applications.get(url)


GAPS = {'company': 'company', 'location': 'location', 'salary': 'salary'}   # record field: the item's key
DESCRIPTION_HEADING = '🧾 Job description'  # on the job: what messages and screenshots said about the role
MIN_ABOUT = 80
LABELS = {'origin': 'Origin', 'source': 'Source', 'reached_via': 'Reached via'}   # in the reply and the entry: "Source Manual → LinkedIn"


def _origin_of(record):
    return origin_rule.origin(source=record.get('source') or '', stage=record.get('stage') or '', notes=record.get('notes') or '',
                              origin=record.get('origin') or '')


def _fill_gaps(stores, app, item, report=None):
    """What a job was missing (the employer behind an agency's invitation, where, the pay) from the pasted message.
    Only empty fields are filled: nothing you or an earlier message wrote is replaced. And where you first talked:
    a conversation (e.g. a LinkedIn chat) that began before the job was tracked (e.g. from the later email invite)
    becomes its Reached via. Returns what was filled. report: a list that gets each value this replaced, "Source Manual
    → LinkedIn" (for the reply and the job's entry). And who reached out first, when you answered it: "they did" makes
    a job whose conversation began before its first contact Inbound (src/notion/origin.py); nothing else does."""
    changes = {field: str(item[key])[:200] for field, key in GAPS.items() if item.get(key) and not app.get(field)}
    # A job known only from an invitation ("SRE"): the fuller title the message gives ("Principal SRE"), when it
    # contains the one there (never a different role).
    title, current = (item.get('role') or item.get('title') or '').strip(), app.get('title') or ''
    company, via = app.get('company') or '', app.get('via') or ''
    role = titles.role_of(current, company, via)
    words = lambda text: set(re.findall(r'[a-z0-9]+', text.lower()))
    fuller = title if title and role and len(title) > len(role) and words(role) <= words(title) else ''
    if _origin_of(app) == origin_rule.INBOUND:
        # It found you: its title names who it is for, now the employer is known ("Principal SRE · Acme"), unless
        # you edited it (src/notion/titles.py).
        new = titles.retitled(current, changes.get('company', company), via, was=(company, via), role=fuller or None)
        if new:
            changes['title'] = new
    elif fuller:
        changes['title'] = fuller
    platform = item.get('platform')
    began = mail._when(item.get('first_contact') or '') or mail._when(item.get('when') or '')
    tracked = mail._when(app.get('created_at') or '')
    if began and tracked and began < tracked:  # before the job was tracked: was it before its first contact too?
        first = _origin(stores, app)
        changes.update(opportunity.first_contact_fields(app, platform, began, first))
        if item.get('origin_answer') == origin_rule.INBOUND and first and began < first \
                and _origin_of(app) == origin_rule.OUTBOUND:
            changes['origin'] = origin_rule.LABELS[origin_rule.INBOUND]   # stored as its label, as every writer does
    if report is not None:
        for field, label in LABELS.items():
            was = (origin_rule.LABELS[_origin_of(app)] if field == 'origin' else app.get(field)) or ''
            now = changes.get(field)
            if field in changes and was and was != now:
                report.append(f'{label} {was} → {now}')
    if changes:
        app.update(stores.applications.update(app['id'], changes))
    named = {'title': f'the title "{title}"'} if fuller else {}
    filled = [GAPS.get(field) or named[field] for field in changes if field in GAPS or field in named]
    return filled + ([f'first contact on {platform}'] if set(changes) & FIRST_CONTACT else [])


FIRST_CONTACT = {'source', 'reached_via', 'notes'}


def _origin(stores, app):
    """When the job's first contact happened: the earliest of its creation, its events from the same Source (e.g. the Gmail
    check's events carry the email's date; logged pastes carry their own) and its "Recruiter lead" event (a job tracked
    from a paste is dated when the conversation began, as you confirmed it in the app)."""
    moments = [mail._when(app.get('created_at') or '')]
    source = app.get('source') or ''
    try:
        events = stores.events.list(app_id=app['id'])
    except Exception as error:  # noqa: BLE001 — the job's creation time still tells
        print(f'Warning: events not read: {type(error).__name__}: {error}', file=sys.stderr)
        events = []
    moments += [mail._when(e.get('at') or '') for e in events
                if e.get('kind') == opportunity.LEAD_STAGE or (source and e.get('source') == source)]
    moments = [m for m in moments if m]
    return min(moments) if moments else None


def _platform_named(text):
    lower = (text or '').lower()
    if lower.startswith('phone · '):  # a call you confirmed ("Phone · …"); "call" in a summary alone isn't one
        return 'Phone'
    return 'LinkedIn' if 'linkedin' in lower else 'Email' if re.search(r'\b(e-?mail|gmail)\b', lower) else None
