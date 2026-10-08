"""📥 Log anything, part 2: dates as a chat writes them ("MONDAY 12:33 AM", "Sep 21") resolved against the day it is
logged, never guessed. Pure; re-exported by src/ai/inbox.py. Tests: tests/test_inbox.py, tests/test_inbox_confirm.py.
"""
import re
from datetime import date, datetime, timedelta

from . import mail


def _day(value):
    try:
        return date.fromisoformat((value or '')[:10])
    except ValueError:
        return None


def _this_year(value, now):
    """Chats show "Sep 21" without a year and the model guesses one (2024 on 29 Sep 2026): a date more than
    ~6 months back is moved to the latest year it could be, never into the future."""
    moment = mail._when(value or '')
    if not moment or (now - moment).days < 180:
        return value
    for year in (now.year, now.year - 1):
        try:
            moved = moment.replace(year=year)
        except ValueError:  # 29 Feb
            continue
        if moved <= now:
            return moved.isoformat()
    return value


def _years(value, now):
    """The years a date shown without one could be (never in the future): this year first, then last year."""
    moment = mail._when(value or '')
    years = []
    for year in (now.year, now.year - 1):
        try:
            if not moment or moment.replace(year=year) <= now:
                years.append(year)
        except ValueError:  # 29 Feb
            continue
    return years


WEEKDAYS = {'monday': 0, 'mon': 0, 'tuesday': 1, 'tues': 1, 'tue': 1, 'wednesday': 2, 'wed': 2, 'thursday': 3,
            'thurs': 3, 'thur': 3, 'thu': 3, 'friday': 4, 'fri': 4, 'saturday': 5, 'sat': 5, 'sunday': 6, 'sun': 6}
MONTHS = {name: number for number, names in enumerate(
    (('jan', 'january'), ('feb', 'february'), ('mar', 'march'), ('apr', 'april'), ('may',), ('jun', 'june'),
     ('jul', 'july'), ('aug', 'august'), ('sep', 'sept', 'september'), ('oct', 'october'), ('nov', 'november'),
     ('dec', 'december')), 1) for name in names}
MONTH_DAY_DAYS = 7  # "Sep 28" without a year: read only when it can only be this last week (else the year is asked)


def resolve_day(text, today):
    """A day and time as a chat or mail app writes them ("MONDAY 12:33 AM", "Today", "Yesterday 14:02", "Sep 28",
    "28 Sep 2026", "2026-09-28"), resolved against `today` (the day it's logged). Pure, never guesses:
    - TODAY / YESTERDAY; a weekday name = the most recent such day, not after today (today itself included);
    - a full date with its year = that date, as written (a numeric one only when day and month can't be swapped);
    - a month and day without the year = the most recent such day, only within MONTH_DAY_DAYS (else unknown).
    Returns {'date': date or None, 'time': 'HH:MM' or '', 'how': 'relative'|'full'|'month_day'|''}."""
    low = re.sub(r'\s+', ' ', (text or '').lower()).strip()
    out = {'date': None, 'time': '', 'how': ''}
    if not low:
        return out
    clock = re.search(r'\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s?m\b\.?', low) or re.search(r'\b(\d{1,2}):(\d{2})\b', low)
    if clock:
        hour, minute = int(clock.group(1)), int(clock.group(2) or 0)
        if clock.lastindex == 3 and clock.group(3):
            hour = hour % 12 + (12 if clock.group(3) == 'p' else 0)
        if hour < 24 and minute < 60:
            out['time'] = f'{hour:02d}:{minute:02d}'
        low = (low[:clock.start()] + ' ' + low[clock.end():]).strip()

    def day(year, month, number):
        try:
            return date(year, month, number)
        except ValueError:
            return None

    def done(found, how):
        if found and found <= today:
            out.update(date=found, how=how)
        return out

    if found := re.search(r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b', low):
        return done(day(int(found.group(1)), int(found.group(2)), int(found.group(3))), 'full')
    if found := re.search(r'\b(\d{1,2})([./])(\d{1,2})\2(\d{4}|\d{2})\b', low):
        first, second, year = int(found.group(1)), int(found.group(3)), int(found.group(4))
        year += 2000 if year < 100 else 0
        if found.group(2) == '.' or first > 12:  # 28.09.2026 (day first), 28/09/2026
            return done(day(year, second, first), 'full')
        if second > 12:  # 9/28/2026
            return done(day(year, first, second), 'full')
        return out if first != second else done(day(year, first, second), 'full')  # 03/04/2026: which is the month?
    month_words = '|'.join(sorted(MONTHS, key=len, reverse=True))
    written = (re.search(rf'\b(\d{{1,2}})(?:st|nd|rd|th)?\.? ({month_words})\b\.?,?(?: (\d{{4}}))?', low)
               or re.search(rf'\b({month_words})\b\.? (\d{{1,2}})(?:st|nd|rd|th)?\b,?(?: (\d{{4}}))?', low))
    if written:
        number, month = (written.group(1), written.group(2)) if written.group(1).isdigit() else (written.group(2), written.group(1))
        number, month = int(number), MONTHS[month]
        if written.group(3):
            return done(day(int(written.group(3)), month, number), 'full')
        found = day(today.year, month, number)
        if found and found > today:
            found = day(today.year - 1, month, number)
        out['how'] = 'month_day'
        return done(found, 'month_day') if found and (today - found).days <= MONTH_DAY_DAYS else out
    if re.search(r'\btoday\b', low):
        return done(today, 'relative')
    if re.search(r'\byesterday\b', low):
        return done(today - timedelta(days=1), 'relative')
    if found := re.search(rf"\b({'|'.join(sorted(WEEKDAYS, key=len, reverse=True))})\b", low):
        return done(today - timedelta(days=(today.weekday() - WEEKDAYS[found.group(1)]) % 7), 'relative')
    return out


def resolve_at(text, today, tz=None):
    """resolve_day() as an ISO moment in the owner's time zone ("2026-09-28T00:33:00+02:00"), a day ("2026-09-28")
    when no time is written, or '' when the day can't be told."""
    found = resolve_day(text, today)
    if not found['date']:
        return ''
    if not found['time']:
        return found['date'].isoformat()
    hour, minute = map(int, found['time'].split(':'))
    return datetime.combine(found['date'], datetime.min.time().replace(hour=hour, minute=minute), tz or mail.TZ).isoformat()


def _resolve_dates(item, now):
    """Dates the item writes as a chat does ("MONDAY"), resolved against the day it's logged: the last message's
    moment (item['last_message']['resolved'], '' = ask) and, when the first message's day is written that way, the
    conversation's start (item['first_contact'], flagged first_contact_resolved: no year question)."""
    today = now.astimezone(mail.TZ).date()
    started = resolve_day(item.get('first_contact_text'), today)
    if started['date']:
        item['first_contact'] = resolve_at(item.get('first_contact_text'), today) if started['time'] \
            else f"{started['date'].isoformat()}T12:00:00+00:00"
        item['first_contact_resolved'] = True
    last = dict(item.get('last_message') or {})
    if last.get('from') in ('you', 'them'):
        moment = resolve_at(last.get('at_text'), today)
        if not moment and (item.get('seen') or {}).get('year') == 'shown' and mail._when(last.get('at') or '') \
                and mail._when(last['at']) <= now:
            moment = last['at']  # a full date with its year, read from the item
        last['resolved'] = moment
        last['text_snippet'] = re.sub(r'\s+', ' ', last.get('text_snippet') or '').strip()[:120]
        item['last_message'] = last
    return item


def _in_year(value, start):
    """A year-less date read as ISO, moved to the year of the conversation's start (a day before it: the next year)."""
    moment = mail._when(value)
    try:
        moved = moment.replace(year=start.year)
        if moved.date() < start:
            moved = moved.replace(year=start.year + 1)
    except ValueError:
        return value
    return moved.isoformat()
