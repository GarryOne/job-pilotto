"""Descriptions for jobs that arrived without one.

Some boards list postings without their text (SmartRecruiters), and a job board's detail page can fail on the day a
job is found (jobs.ch). Without a description a job never gets stage 1 facts or a fit score, and nothing tried
again: it sat in the list with "–". Each run fetches the missing ones from the posting itself, newest first, a few
at a time (the importer keeps them: it only ever writes a real description over an empty one).
"""
from collections import Counter
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import re
from urllib.parse import urlsplit

from . import ats, boards

SMARTRECRUITERS = re.compile(r'jobs\.smartrecruiters\.com/([^/?#]+)/(\d+)')


class _Prose(HTMLParser):
    """The HTML inside a page's first `prose` block (TechTree's posting text), tags kept so boards.text spaces it."""
    VOID = {'br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.depth, self.parts = 0, []

    def handle_starttag(self, tag, attrs):
        if self.depth:
            self.parts.append(self.get_starttag_text() or '')
            if tag not in self.VOID:
                self.depth += 1
        elif 'prose' in (dict(attrs).get('class') or '').split() and tag not in self.VOID:
            self.depth = 1

    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
            if self.depth:
                self.parts.append(f'</{tag}>')

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)

    def handle_entityref(self, name):
        if self.depth:
            self.parts.append(f'&{name};')

    def handle_charref(self, name):
        if self.depth:
            self.parts.append(f'&#{name};')


def techtree_text(html):
    """A TechTree posting page's own text (its list page, which the board reader uses, has none)."""
    reader = _Prose()
    reader.feed(html or '')
    return boards.text(' '.join(reader.parts))[:12000]


def readable(url):
    """Whether fetch() knows how to read this posting's text."""
    host = (urlsplit(url or '').hostname or '')
    return bool(SMARTRECRUITERS.search(url or '')) or host.endswith('jobs.ch') or host.endswith('techtree.dev')


def fetch(url, client=None):
    """The posting's text, from its own API or page; '' when this kind of posting can't be read."""
    match = SMARTRECRUITERS.search(url or '')
    if match:
        return ats.smartrecruiters_detail(match.group(1), match.group(2))
    if (urlsplit(url or '').hostname or '').endswith('jobs.ch'):
        page = (client or boards.Client()).get(url)
        posting = next(boards.walk(boards.Page(page['html']).schemas, 'JobPosting'), {})
        return boards.text(posting.get('description', ''))[:12000]
    if (urlsplit(url or '').hostname or '').endswith('techtree.dev'):   # 6 Oct 2026: every TechTree job stayed unscored, "–"
        return techtree_text((client or boards.Client()).get(url)['html'])
    return ''


def backfill(db, limit=20, days=14, fetcher=fetch):
    """Fill in up to `limit` open jobs (seen in the last `days`) that have no description. Returns a log line."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec='seconds')
    rows = db.execute("SELECT id, url FROM jobs WHERE state='open' AND coalesce(description, '') = '' AND first_seen_at >= ? "
                      "ORDER BY first_seen_at DESC LIMIT ?", (since, limit)).fetchall()
    filled = failed = gone = 0
    unreadable = Counter()   # sites fetch() has no reader for: said in the log line, so "0 of 2 fetched" has a reason
    for job_id, url in rows:
        if fetcher is fetch and not readable(url):
            unreadable[urlsplit(url or '').hostname or '?'] += 1
            continue
        try:
            text = fetcher(url)
        except Exception as error:
            if getattr(error, 'code', None) in (404, 410):  # the posting was taken down: the job is closed, not unscored
                db.execute("UPDATE jobs SET state='closed' WHERE id=?", (job_id,))
                gone += 1
            else:  # one posting failing must not stop the others; it's tried again next run
                failed += 1
            continue
        if text:
            db.execute('UPDATE jobs SET description=? WHERE id=?', (text, job_id))
            filled += 1
    db.commit()
    return (f'Descriptions: {filled} of {len(rows)} missing fetched' + (f', {gone} posting(s) taken down (closed)' if gone else '')
            + (f', {failed} failed' if failed else '')
            + (f", {sum(unreadable.values())} can't be read from " + ', '.join(sorted(unreadable)) if unreadable else '')) if rows else ''
