# Loaded first by every entry point: .env, then the Desktop App's workspace for anything .env doesn't set.
# run_result registers the process exit that writes the app's result file (one object per command).
from . import paths as _paths  # noqa: F401,E402
from . import run_result as _run_result  # noqa: F401,E402
