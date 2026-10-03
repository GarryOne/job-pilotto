"""The user's own time zone: JOB_PILOTTO_TZ (the desktop app sets it from the computer), else the machine's, else UTC.
Never a fixed city: dates, "today" and interview times are the user's, wherever they live."""
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def zone_name():
    name = os.getenv('JOB_PILOTTO_TZ') or os.getenv('TZ', '').lstrip(':')
    if not name:
        try:
            target = os.path.realpath('/etc/localtime')
            name = target.split('zoneinfo/', 1)[1] if 'zoneinfo/' in target else ''
        except OSError:
            name = ''
    if not name and Path('/etc/timezone').is_file():
        name = Path('/etc/timezone').read_text().strip()
    try:
        ZoneInfo(name)
        return name
    except Exception:
        return 'UTC'


def local_zone():
    try:
        return ZoneInfo(zone_name())
    except Exception:  # noqa: BLE001 — no time-zone database at all (Windows without the tzdata package: not even "UTC" loads): the computer's own offset
        return datetime.now().astimezone().tzinfo
