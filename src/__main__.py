"""Command line entry point: python -m src <command> [options].

Commands:
  check     check for new jobs: crawl your sources, read and score new jobs, send the digest
            (modes: scheduled, run, today, more, apply); "daily" is the old name and still works
  scout     find new employers: probe a batch of candidate employers for public job feeds
  discover  crawl the Swiss job boards (jobs.ch, TechTree) for employers, when your places include Switzerland
  feeds     crawl employer feeds only and write a local HTML report
  enrich    run AI stage 1 on pending jobs
  doctor    readiness checklist and the one next step (--next, --json)
  contribute  what "Help the pool grow" would send (--show); nothing is sent by this command
"""
import sys


def main():
    from . import crash_reporting
    crash_reporting.install()  # unhandled errors to Sentry, only when the app turned reports on (JOB_PILOTTO_SENTRY_DSN)
    commands = {
        'check': 'src.daily', 'daily': 'src.daily', 'scout': 'src.scout', 'discover': 'src.sources.boards',
        'feeds': 'src.sources.feeds', 'enrich': 'src.ai.enrich', 'doctor': 'src.doctor', 'contribute': 'src.contribute',
    }
    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        print(__doc__)
        return 2
    name = sys.argv.pop(1)
    sys.argv[0] = f'python -m src {name}'
    import importlib
    if name in ('check', 'daily', 'scout', 'discover', 'feeds'):
        # One search at a time: the app and the terminal share the job cache (src/paths.py run_lock).
        from .paths import run_lock
        with run_lock():
            # ⚙️ Search settings in Notion are the source of truth: refresh the cached config before it's imported.
            from .notion import search_settings
            search_settings.sync_quietly()
            return importlib.import_module(commands[name]).main() or 0
    return importlib.import_module(commands[name]).main() or 0


if __name__ == '__main__':
    raise SystemExit(main())
