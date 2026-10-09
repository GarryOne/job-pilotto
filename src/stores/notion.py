"""The notion store: the user's data in their Notion workspace (today's databases and pages), behind src/stores/base.py.

Rows ↔ records through src/stores/notion_rows.py (column names), page bodies through src/stores/notion_blocks.py
(Markdown ↔ blocks). Interviews and insights are their own modules (notion_interviews.py, notion_insights.py).
Every request goes through one `Tracker` (src/notion/client.py: retries, pacing, the request log).
Guarded by tests/test_store_notion.py: the store contract against the Notion stand-in (desktop/e2e/lib/notion-fake.mjs).
"""
import os
import urllib.request
from datetime import datetime, timezone

from ..notion import titles
from ..notion.client import Tracker, _rich
from . import base
from . import notion_rows as rows
from .notion_insights import NotionInsights
from .notion_interviews import NotionInterviews

# Where each entity lives: the variable naming its database (the app and the workspace repo set them).
DATABASES = {'applications': 'NOTION_APPLICATIONS_DB', 'events': 'NOTION_EVENTS_DB', 'matches': 'NOTION_MATCHES_DB',
             'interviews': 'NOTION_INTERVIEWS_DB', 'insights': 'NOTION_INSIGHTS_DB', 'employers': 'NOTION_EMPLOYERS_DB',
             'agent_runs': 'NOTION_AGENT_RUNS_DB', 'cron_runs': 'NOTION_CRON_RUNS_DB'}
FILE_BLOCKS = ('file', 'pdf', 'image')


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _known(fields, values):
    unknown = set(values) - set(fields)
    if unknown:
        raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
    return values


def _text_of(block):
    return _rich((block.get(block['type']) or {}).get('rich_text'))


class _Database:
    """One Notion database as a table of records: query, create, update, archive, with the columns `columns`.
    A column the workspace doesn't have (an older workspace before the app repaired it) is left out of writes."""
    fields, columns = (), ()

    def __init__(self, tracker, database_id):
        self.tracker, self.database_id = tracker, database_id
        self._have = None

    def _existing(self):
        if self._have is None:
            schema = self.tracker._request('GET', f'databases/{self.database_id}')
            self._have = set(schema.get('properties') or {})
        return self._have

    def _writable(self, props):
        have = self._existing()
        return {name: value for name, value in props.items() if name in have}

    def _record(self, page):
        return rows.to_record(page, self.columns, self.fields)

    def _query(self, filter_=None):
        return [page for page in self.tracker.query_database(self.database_id, filter_) if not page.get('archived')]

    def _page(self, row_id):
        try:
            page = self.tracker._request('GET', f'pages/{row_id}')
        except Exception as error:  # noqa: BLE001 (a missing or foreign id: Notion answers 400/404)
            raise KeyError(row_id) from error
        if page.get('archived') or (page.get('parent') or {}).get('database_id', '').replace('-', '') != \
                self.database_id.replace('-', ''):
            raise KeyError(row_id)
        return page

    def _create(self, values, extra=None):
        props = {**rows.to_properties(values, self.columns), **(extra or {})}
        page = self.tracker.create_page(self.database_id, self._writable(props))
        return self._record(page)

    def _update(self, row_id, fields, extra=None):
        page = self._page(row_id)
        values = _known(self.fields, {k: v for k, v in fields.items() if k not in ('id', 'created_at')})
        props = {**rows.to_properties(values, self.columns, page.get('properties')), **(extra or {})}
        return self._record(self.tracker.update_page(row_id, self._writable(props)) if props else page)

    def _new_values(self, values):
        return {**values, 'created_at': values.get('created_at') or _now()}

    def put(self, record):
        """A record copied from another store, its dates too, under this workspace's own id."""
        values = _known(self.fields, dict(record))
        return self._create(self._new_values({k: v for k, v in values.items() if k != 'id'}))


class Applications(_Database):
    """📮 Job Tracker. A job is found by its Job URL; an Inbound row's title also names who it is for
    (src/notion/titles.py), so the record's title is the role alone and the page title is rebuilt on write."""
    fields, columns = base.APPLICATION_FIELDS, rows.APPLICATION_COLUMNS

    def _record(self, page):
        found = super()._record(page)
        found['title'] = titles.role_of(found['title'], found['company'], found['via'])
        return found

    def _title(self, values, current=None):
        merged = {**(current or {}), **values}
        if 'title' not in values or (merged.get('origin') or '').lower() != 'inbound':
            return {}
        title = titles.job_title(values['title'], merged.get('company', ''), merged.get('via', ''))
        return {'Job': titles.title_property(title)} if title else {}

    def _create(self, values, extra=None):
        return super()._create(values, {**self._title(values), **(extra or {})})

    def update(self, app_id, fields):
        current = self._record(self._page(app_id)) if 'title' in fields else None
        return self._update(app_id, fields, self._title(fields, current))

    def list(self, stages=None):
        if stages is not None and not list(stages):
            return []
        filter_ = {'or': [{'property': 'Stage', 'select': {'equals': stage}} for stage in stages]} if stages else None
        return [self._record(page) for page in self._query(filter_)]

    def _find(self, url):
        url, key = (url or '').strip(), base.url_key(url)
        if not url:
            return None
        forms = list(dict.fromkeys((url, url.rstrip('/'), url.rstrip('/') + '/')))
        pages = self._query({'or': [{'property': 'Job URL', 'url': {'equals': form}} for form in forms]})
        return next((page for page in pages if base.url_key(rows.read(page['properties'].get('Job URL'), 'url')) == key), None)

    def get(self, url):
        page = self._find(url)
        return self._record(page) if page else None

    def stages(self):
        found = {}
        for page in self._query():
            url = rows.read(page['properties'].get('Job URL'), 'url')
            if url:
                found[base.url_key(url)] = rows.read(page['properties'].get('Stage'), 'select')
        return found

    def create(self, job, stage):
        found = self.get(job.get('url'))
        if found:
            return self.update(found['id'], {'stage': stage})
        return self._create(self._new_values({**_known(self.fields, job), 'stage': stage}))

    def set_stage(self, job, stage, today=None):
        found = self.get(job.get('url'))
        if found and found['stage'] == stage:
            return found, base.UNCHANGED
        stamp = {'applied_on': today or _now()[:10]} if stage == 'Applied' and not (found or {}).get('applied_on') else {}
        if found:
            return self.update(found['id'], {'stage': stage, **stamp}), base.CHANGED
        return self.create({**job, **stamp}, stage), base.CREATED

    def delete(self, app_id):
        """To Notion's trash, with its page (sections and files): restorable there for 30 days."""
        self._page(app_id)
        self.tracker.trash_page(app_id)

    # Sections: a toggle heading named after the section, its Markdown as the toggle's children. A page written
    # before the stores (a plain heading with blocks after it) is read and rewritten in place, as it is.

    def _children(self, block_id):
        return [block for block in self.tracker._children(block_id) if not block.get('archived')]

    def _sections(self, app_id):
        """[(name, heading block, body blocks)] of the page's sections, in page order."""
        found, current = [], None
        for block in self._children(app_id):
            kind = block['type']
            level = int(kind[-1]) if kind.startswith('heading_') else None
            if level and level <= 2:
                current = None
                if (block[kind] or {}).get('is_toggleable'):
                    found.append((_text_of(block), block, None))
                else:
                    current = (_text_of(block), block, [])
                    found.append(current)
            elif kind == 'child_database':
                current = None
            elif current is not None:
                current[2].append(block)
        return found

    def _body(self, heading, blocks):
        from .notion_blocks import to_markdown
        if blocks is None:
            blocks = self._children(heading['id']) if heading.get('has_children') else []
        return to_markdown(blocks, children=self._children)

    def section(self, app_id, name):
        try:
            self._page(app_id)  # a trashed job's page keeps its blocks: its sections are gone with it
        except KeyError:
            return None
        found = next(((heading, body) for title, heading, body in self._sections(app_id) if title == name), None)
        return self._body(*found) if found else None

    def set_section(self, app_id, name, markdown):
        from .notion_blocks import to_blocks
        self._page(app_id)
        blocks = to_blocks(markdown)
        found = next(((heading, body) for title, heading, body in self._sections(app_id) if title == name), None)
        if found is None:
            heading = {'object': 'block', 'type': 'heading_2', 'heading_2': {
                'rich_text': [{'type': 'text', 'text': {'content': name}}], 'is_toggleable': True}}
            created = self.tracker._request('PATCH', f'blocks/{app_id}/children', {'children': [heading]})['results'][0]
            self._append(created['id'], blocks)
            return
        heading, body = found
        old = body if body is not None else self._children(heading['id'])
        for block in old:
            self.tracker._request('DELETE', f"blocks/{block['id']}")
        if body is None:
            self._append(heading['id'], blocks)
        else:
            self._append(app_id, blocks, after=heading['id'])

    def _append(self, parent_id, blocks, after=None):
        for start in range(0, len(blocks), 100):  # Notion takes 100 blocks a request
            chunk = blocks[start:start + 100]
            made = self.tracker._request('PATCH', f'blocks/{parent_id}/children',
                                         {'children': chunk, **({'after': after} if after else {})})['results']
            after = made[-1]['id'] if after and made else after

    def sections(self, app_id):
        return {name: self._body(heading, body) for name, heading, body in self._sections(app_id)}

    def attach(self, app_id, name, data, content_type):
        """Uploads the bytes to Notion and adds them to the job's page as a file block; returns the upload's id."""
        self._page(app_id)
        upload = self.tracker.upload_file(name, bytes(data), content_type)
        self.tracker.append_blocks(app_id, [{'object': 'block', 'type': 'file', 'file': {
            'type': 'file_upload', 'file_upload': {'id': upload}, 'name': name}}])
        return upload

    def files(self, app_id):
        """[(name, bytes, content_type)] of the files on the job's page (downloaded from Notion's storage)."""
        found = []
        for block in self._children(app_id):
            if block['type'] not in FILE_BLOCKS:
                continue
            body = block[block['type']]
            url = (body.get(body.get('type')) or {}).get('url')
            if not url:
                continue
            with urllib.request.urlopen(url, timeout=60) as response:
                found.append((body.get('name') or url.rsplit('/', 1)[-1], response.read(),
                              response.headers.get_content_type()))
        return found


class Events(_Database):
    """📈 Application Events, each linked to its job's row."""
    fields, columns = base.EVENT_FIELDS, rows.EVENT_COLUMNS

    def list(self, app_id=None, kind=None, source_id=None):
        parts = [part for part in (
            app_id is not None and {'property': 'Application', 'relation': {'contains': app_id}},
            kind is not None and {'property': 'Kind', 'select': {'equals': kind}},
            source_id is not None and {'property': 'Source ID', 'rich_text': {'equals': source_id}}) if part]
        filter_ = {'and': parts} if len(parts) > 1 else (parts[0] if parts else None)
        found = [self._record(page) for page in self._query(filter_)]
        return sorted(found, key=lambda event: event['created_at'])

    def _title(self, app_id, kind):
        """'Kind · Company' and the job's URL, from the job's row (as src/notion/ledger.py has always titled them)."""
        try:
            props = self.tracker._request('GET', f'pages/{app_id}')['properties'] if app_id else {}
        except Exception:  # noqa: BLE001 (an event of a job in another store: no title to borrow)
            props = {}
        company = rows.read(props.get('Company'), 'rich_text') or rows.read(props.get('Job'), 'title') or 'application'
        extra = {'Event': {'title': [{'type': 'text', 'text': {'content': f'{kind} · {company}'[:200]}}]}}
        url = rows.read(props.get('Job URL'), 'url')
        return {**extra, 'Job URL': {'url': url}} if url else extra

    def add(self, app_id, kind, at, **fields):
        same = fields.get('source_id') and self.list(app_id=app_id, source_id=fields['source_id'])
        if same:
            return same[0]
        values = self._new_values({**_known(self.fields, fields), 'app_id': app_id, 'kind': kind, 'at': at})
        return self._create(values, self._title(app_id, kind))

    def put(self, record):
        values = _known(self.fields, dict(record))
        return self._create(self._new_values({k: v for k, v in values.items() if k != 'id'}),
                            self._title(values.get('app_id'), values.get('kind')))

    def archive(self, app_id, kind):
        found = self.list(app_id=app_id, kind=kind)
        for event in found:
            self.tracker.trash_page(event['id'])
        return len(found)


class _NotYet:
    """An entity whose Notion side hasn't landed yet: every call says so (the contract test skips it)."""

    def __init__(self, entity):
        self.entity = entity

    def __getattr__(self, name):
        raise NotImplementedError(f'the notion store has no {self.entity} yet')


PENDING = ('matches', 'employers', 'agent_runs', 'cron_runs', 'texts')


class NotionStores(base.Stores):
    def link(self, record_id):
        return f"https://www.notion.so/{str(record_id).replace('-', '')}" if record_id else None


def tracker_for(env):
    token = env.get('NOTION_TOKEN')
    if not token:
        raise LookupError('the notion store needs NOTION_TOKEN')
    return Tracker(token, env.get(DATABASES['applications'], ''))


def open_store(env=None, tracker=None):
    env = os.environ if env is None else env
    tracker = tracker or tracker_for(env)
    ids = {entity: env.get(variable, '') for entity, variable in DATABASES.items()}
    return NotionStores(name='notion', applications=Applications(tracker, ids['applications']),
                        events=Events(tracker, ids['events']),
                        interviews=NotionInterviews(tracker, ids['interviews']),
                        insights=NotionInsights(tracker, ids['insights']),
                        **{entity: _NotYet(entity) for entity in PENDING},
                        caps=frozenset({base.LINKS, base.CLOUD, base.FILES}))
