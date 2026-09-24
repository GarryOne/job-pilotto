"""Command line entry point: python -m src <command> [options].

Commands:
  daily     run a digest (modes: scheduled, run, today, more, apply)
  scout     probe a batch of candidate employers for job feeds
  discover  crawl jobs.ch and TechTree for Swiss employers
  feeds     crawl employer feeds only and write a local HTML report
  enrich    run AI stage 1 on pending jobs
"""
import sys


def main():
    commands = {
        'daily': 'src.daily', 'scout': 'src.scout', 'discover': 'src.sources.boards',
        'feeds': 'src.sources.feeds', 'enrich': 'src.ai.enrich',
    }
    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        print(__doc__)
        return 2
    name = sys.argv.pop(1)
    sys.argv[0] = f'python -m src {name}'
    import importlib
    return importlib.import_module(commands[name]).main() or 0


if __name__ == '__main__':
    raise SystemExit(main())
