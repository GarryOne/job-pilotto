"""📥 Log anything, part 3: what a log writes in Notion: the job's page entry with its screenshots, a new Applications row,
the gaps a message fills, when the first contact happened. Re-exported by src/ai/inbox.py.
Tests: tests/test_inbox.py, tests/test_inbox_gaps.py, tests/test_origin_column.py.
"""
import re
import sys
from datetime import datetime

from ..notion import cron_runs, ledger
from ..notion import origin as origin_rule, titles
from ..notion.ledger import _block, add_event, plain
from . import mail, opportunity
from .inbox_dates import _day
from .inbox_reading import APPLIED, images_of, step


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


def _place_screenshots(tracker, image, summary):
    """Where a log's screenshots go: on the run that logged them (Logged activity in ⏱️ Search runs), small, side by side.
    Returns (blocks for the job's page: a link to that run, screenshots for the job's page: only when no run is open, e.g.
    a terminal log: they stay on the job then)."""
    shots = _image_blocks(tracker, image)
    if not shots:
        return [], []
    url = cron_runs.attach([_block('heading_3', f'📥 {summary}'[:200])] + _thumbnails(shots))
    if url is None:
        return [], shots
    if not url:
        return [], []
    said = {'content': 'Screenshots: saved with this run'}
    said['link'] = {'url': url}  # Notion's text link, not a column
    return [{'object': 'block', 'type': 'paragraph', 'paragraph': {'rich_text': [{'type': 'text', 'text': said}]}}], []


def _thumbnails(blocks):
    """Screenshots side by side in columns: small on the page, full size in Notion's viewer when clicked."""
    if len(blocks) < 2:
        return blocks
    return [{'object': 'block', 'type': 'column_list', 'column_list': {'children': [
        {'object': 'block', 'type': 'column', 'column': {'children': [block]}} for block in blocks]}}]


def _keep(tracker, row, text, image, summary, when, platform=None, check=(), changes=()):
    """What was logged, on the job's page: one folded entry per log ("📥 29 Sep · what it said"), with the message
    inside and the screenshots as a row of thumbnails, so the page stays readable however many you log."""
    try:
        day = datetime.fromisoformat(when.replace('Z', '+00:00')).strftime('%d %b %Y')
    except ValueError:
        day = when[:10]
    if platform and _platform_named(summary) != platform:
        summary = f'{platform} · {summary}'  # the entry says where it came from
    inside = [_block('quote', part) for part in re.split(r'\n\s*\n', text.strip())[:40] if part.strip()] if text else []
    head = []
    if check:  # logged without your confirmation (Telegram): what to check, on the page itself
        head.append(_block('paragraph', f"⚠️ Check these details: {'; '.join(check)}."))
    if changes:  # a value this log replaced, before → after: a job's big changes leave a trail
        head.append(_block('paragraph', f"Changed: {'; '.join(changes)}"))
    inside = head + inside
    # The job's page keeps the words and a link to the run that holds the screenshots.
    linked, shots = _place_screenshots(tracker, image, summary)
    inside += linked
    if len(shots) < 2:
        inside += shots
    entry = {'object': 'block', 'type': 'toggle', 'toggle': {
        'rich_text': [{'type': 'text', 'text': {'content': f'📥 {day} · {summary}'[:1900]}, 'annotations': {'bold': True}}],
        'children': inside or [_block('paragraph', summary)]}}
    try:
        added = tracker.append_blocks(row['id'], [entry])
        if len(shots) > 1:  # columns inside the fold: a second call (Notion nests only two levels per call)
            toggle = ((added or {}).get('results') or [{}])[0].get('id')
            if toggle:
                tracker.append_blocks(toggle, _thumbnails(shots))
    except Exception as error:  # noqa: BLE001
        print(f'Warning: not copied to the page: {type(error).__name__}: {error}', file=sys.stderr)


def _channel_named(item):
    """What a log entry names as its channel: a known one (LinkedIn, Email, a confirmed Phone), or what you typed
    for Other (WhatsApp); None when unknown (then the entry says nothing about it)."""
    platform = item.get('platform')
    if platform == 'Other':
        return item.get('channel_other') or None
    return platform if platform in opportunity.CHANNEL_SOURCE else None


def _new_row(tracker, item, url, source, event_source, when, note):
    """A role not known anywhere, applied elsewhere: Applications row at Applied (date approximate) + its event."""
    props = opportunity.properties(item, url, APPLIED, source, origin='Logged from a paste')
    props['Recruiter'] = {'checkbox': bool(item.get('recruiter_name')) and not item.get('in_house')}
    if not item.get('recruiter_name'):
        props['Channel'] = {'select': {'name': 'Direct'}}
    day = _day(when)
    if day:
        props.update({'Applied on': {'date': {'start': day.isoformat()}}, 'Date approximate': {'checkbox': True}})
    # Applied elsewhere: you went after it (Outbound, src/notion/origin.py).
    row = tracker.create_page(tracker.database_id, origin_rule.stamp(props, origin_rule.OUTBOUND))
    known = row.setdefault('properties', {})
    for name, value in (('Company', {'rich_text': [{'plain_text': item.get('company') or ''}]}),
                        ('Job', {'title': [{'plain_text': opportunity.title(item)}]}), ('Job URL', {'url': url}),
                        ('Stage', {'select': {'name': APPLIED}})):
        known.setdefault(name, value)
    add_event(tracker, row, APPLIED, event_source, at=day.isoformat() if day else None,
              note=f'Applied outside Job Pilotto; {note} (date is an upper bound)'[:300])
    return row


def _row_for(tracker, url):
    row = tracker.find(url)
    if row is not None:
        row.setdefault('url', '')
    return row


GAPS = {'Company': 'company', 'Location': 'location', 'Salary': 'salary'}
DESCRIPTION_HEADING = '🧾 Job description'  # on the job's page: what messages and screenshots said about the role
MIN_ABOUT = 80


def _fill_gaps(tracker, row, item, report=None):
    """What a job was missing (the employer behind an agency's invitation, where, the pay) from the pasted message.
    Only empty fields are filled: nothing you or an earlier message wrote is replaced. And where you first talked:
    a conversation (e.g. a LinkedIn chat) that began before the job was tracked (e.g. from the later email invite)
    becomes its Reached via. Returns what was filled. report: a list that gets each value this replaced, "Source Manual
    → LinkedIn" (for the reply and the job's page). And who reached out first, when you answered it: "they did" makes
    a job whose conversation began before its first contact Inbound (src/notion/origin.py); nothing else does."""
    changes = {name: {'rich_text': [{'text': {'content': str(item[key])[:200]}}]}
               for name, key in GAPS.items() if item.get(key) and not plain(row['properties'].get(name))}
    # A job known only from an invitation ("SRE"): the fuller title the message gives ("Principal SRE"), when it
    # contains the one there (never a different role).
    props = row['properties']
    title, current = (item.get('role') or item.get('title') or '').strip(), plain(props.get('Job')) or ''
    company, via = plain(props.get('Company')) or '', plain(props.get('Via')) or ''
    role = titles.role_of(current, company, via)
    words = lambda text: set(re.findall(r'[a-z0-9]+', text.lower()))
    fuller = title if title and role and len(title) > len(role) and words(role) <= words(title) else ''
    if origin_rule.row_origin(row) == origin_rule.INBOUND:
        # It found you: its title names who it is for, now the employer is known ("Principal SRE · Acme"), unless
        # you edited it (src/notion/titles.py).
        known = changes['Company']['rich_text'][0]['text']['content'] if 'Company' in changes else company
        new = titles.retitled(current, known, via, was=(company, via), role=fuller or None)
        if new:
            changes['Job'] = titles.title_property(new)
    elif fuller:
        changes['Job'] = titles.title_property(fuller)
    platform = item.get('platform')
    began = mail._when(item.get('first_contact') or '') or mail._when(item.get('when') or '')
    tracked = mail._when(row.get('created_time') or '')
    if began and tracked and began < tracked:  # before the row was tracked: was it before its first contact too?
        first = _origin(tracker, row)
        changes.update(opportunity.first_contact_changes(row, platform, began, first))
        if item.get('origin_answer') == origin_rule.INBOUND and first and began < first \
                and origin_rule.row_origin(row) == origin_rule.OUTBOUND:
            changes['Origin'] = {'select': {'name': origin_rule.LABELS[origin_rule.INBOUND]}}
    if report is not None:
        for name in ('Origin', 'Source', 'Reached via'):
            was = plain(row['properties'].get(name)) or (origin_rule.LABELS[origin_rule.row_origin(row)] if name == 'Origin' else '')
            if name in changes and was and was != changes[name]['select']['name']:
                report.append(f"{name} {was} → {changes[name]['select']['name']}")
    if changes:
        tracker.update_page(row['id'], changes)
        for name, value in changes.items():
            row['properties'][name] = ({'type': 'select', 'select': value['select']} if 'select' in value else
                                       {'type': 'title', 'title': [{'plain_text': value['title'][0]['text']['content']}]} if 'title' in value else
                                       {'type': 'rich_text', 'rich_text': [{'plain_text': value['rich_text'][0]['text']['content']}]})
    named = {'Job': f'the title "{title}"'} if fuller else {}
    filled = [GAPS.get(name) or named[name] for name in changes if name in GAPS or name in named]
    return filled + ([f'first contact on {platform}'] if set(changes) & FIRST_CONTACT else [])


FIRST_CONTACT = {'Source', 'Reached via', 'Notes'}


def _origin(tracker, row):
    """When the row's first contact happened: the earliest of its creation, its events from the same Source
    (e.g. the Gmail check's events carry the email's date; logged pastes carry their own) and its "Recruiter lead"
    event (a job tracked from a paste is dated when the conversation began, as you confirmed it in the app)."""
    moments = [mail._when(row.get('created_time') or '')]
    source = plain(row['properties'].get('Source'))
    if ledger.EVENTS_DATABASE_ID and hasattr(tracker, 'query_database'):
        # By the Application relation only: the Source and Kind are compared here. The row's Source ("Manual",
        # "Telegram") need not be an option of the events' Source, and Notion answers 400 to a select filter on a
        # value its column doesn't have (30 Sep 2026: "events not read: HTTP Error 400").
        try:
            events = tracker.query_database(ledger.EVENTS_DATABASE_ID, {'property': 'Application', 'relation': {'contains': row['id']}})
        except Exception as error:  # noqa: BLE001 — the row's creation time still tells
            print(f'Warning: events not read: {type(error).__name__}: {error}', file=sys.stderr)
            events = []
        events = [e for e in events if plain(e['properties'].get('Kind')) == opportunity.LEAD_STAGE
                  or (source and plain(e['properties'].get('Source')) == source)]
        moments += [mail._when(plain(e['properties'].get('At')) or '') for e in events]
    moments = [m for m in moments if m]
    return min(moments) if moments else None


def _platform_named(text):
    lower = (text or '').lower()
    if lower.startswith('phone · '):  # a call you confirmed ("Phone · …"); "call" in a summary alone isn't one
        return 'Phone'
    return 'LinkedIn' if 'linkedin' in lower else 'Email' if re.search(r'\b(e-?mail|gmail)\b', lower) else None
