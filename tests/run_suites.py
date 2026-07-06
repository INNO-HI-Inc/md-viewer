#!/usr/bin/env python3
"""Run every editing-stability suite in tests/suites/ plus the core
verify.py regression, and fail if any suite fails. Used locally and in CI."""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SUITES = [ROOT / 'verify.py'] + sorted((ROOT / 'suites').glob('test_*.py'))

failed = []
for suite in SUITES:
    print('\n' + '=' * 60)
    print('RUNNING', suite.name)
    print('=' * 60, flush=True)
    r = subprocess.run([sys.executable, str(suite)])
    if r.returncode != 0:
        failed.append(suite.name)

print('\n' + '=' * 60)
if failed:
    print('FAILED SUITES:', ', '.join(failed))
    sys.exit(1)
print('ALL SUITES PASSED (%d)' % len(SUITES))
