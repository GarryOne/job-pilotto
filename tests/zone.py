"""Pins the time zone the product reads (src/tz.py: the user's own zone) to Zurich for tests whose expected times are Zurich's, so they pass on a laptop and on CI (UTC) alike.
Use:  setUpModule, tearDownModule = zone.pinned()"""
from unittest import mock
from zoneinfo import ZoneInfo

ZURICH = ZoneInfo('Europe/Zurich')


def pinned():
    from src import focus
    from src.ai import mail
    from src.notion import cron_runs
    patches = [mock.patch('src.tz.zone_name', return_value='Europe/Zurich'), *(mock.patch.object(module, 'TZ', ZURICH) for module in (focus, mail, cron_runs))]

    def set_up():
        for patch in patches:
            patch.start()

    def tear_down():
        for patch in reversed(patches):
            patch.stop()
    return set_up, tear_down
