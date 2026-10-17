"""Builds the hosted state tar the e2e puts in the fake R2 as if an earlier run had left it: two fixture employers in the SQLite store (a first run on our servers
reads the central index for these; a fixture run downloads nothing, so they are given). Usage: python3 tools/hosted-e2e/seed_state.py <out.tgz>. Guard: tools/hosted-e2e/run.mjs."""
import os
import sys
import tarfile
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
EMPLOYERS = [('E2E Acme', 'e2e-acme'), ('E2E Beta', 'e2e-beta')]


def main(out):
    with tempfile.TemporaryDirectory(prefix='jp-hosted-seed-') as folder:
        data = Path(folder) / 'data'
        data.mkdir()
        os.environ.update({'JOB_PILOTTO_STORE': 'sqlite', 'JOB_PILOTTO_DATA_DIR': str(data), 'JOB_PILOTTO_CONFIG_DIR': str(Path(folder) / 'config'), 'JOB_PILOTTO_NO_DOTENV': '1'})
        from src import store_access
        stores = store_access.open_run()
        for name, slug in EMPLOYERS:
            stores.employers.add({'name': name, 'ats': 'greenhouse', 'slug': slug, 'active': True})
        with tarfile.open(out, 'w:gz') as tar:
            tar.add(data, arcname='data')


if __name__ == '__main__':
    main(sys.argv[1])
