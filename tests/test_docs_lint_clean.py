"""Guard: the user-docs corpus must lint clean.

Runs ``build/docs_lint.py`` as a subprocess and asserts exit 0.
Any lint error surfaces verbatim in the pytest failure message.
"""

import subprocess
import sys


def test_user_docs_lint_clean():
    r = subprocess.run(
        [sys.executable, "build/docs_lint.py"],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stdout + r.stderr
