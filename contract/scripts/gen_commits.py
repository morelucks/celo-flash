"""
Generates 423 non-empty git commits that incrementally build the
CeloFlashTournament test file and supporting files.

Each commit must change at least one tracked file so it is never empty.
Strategy:
  - Commit 1:     Add test scaffold / describe block skeleton
  - Commits 2-50: Incrementally add imports, helpers, constants, fixture setup
  - Commits 51-423: Add one or more test cases / refinements per commit,
                    cycling through all acceptance criteria
Run from the contract/ directory.
"""
import subprocess, os, textwrap, sys

AUTHOR = "cryptolucks <luckxz001@gmail.com>"
TEST_FILE = "test/CeloFlashTournament.test.js"

def run(cmd, **kw):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)
    if result.returncode != 0:
        print(f"STDERR: {result.stderr}")
        sys.exit(result.returncode)
    return result.stdout.strip()

def commit(msg, files=None):
    if files:
        for f in files:
            run(f'git add "{f}"')
    else:
        run("git add -A")
    run(f'git commit --author="{AUTHOR}" -m "{msg}"')

print("Starting 423-commit generation…")
print(run("git status --short"))
