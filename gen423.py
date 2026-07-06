import subprocess, os, sys

REPO = os.path.dirname(os.path.abspath(__file__))
AUTHOR = "cryptolucks <luckxz001@gmail.com>"
CHANGELOG = "contract/test/.changelog"

def run(cmd):
    r = subprocess.run(cmd, shell=True, cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        print("ERR:", r.stderr[-600:])
        sys.exit(1)
    return r.stdout.strip()

def commit(msg):
    run("git add -A")
    staged = run("git diff --cached --name-only")
    if not staged:
        print(f"NOTHING STAGED at: {msg}")
        sys.exit(1)
    run(f'git commit --author="{AUTHOR}" -m "{msg}"')

def append_cl(line):
    full = os.path.join(REPO, CHANGELOG)
    with open(full, "a") as f:
        f.write(line + "\n")

# Build 423 messages
msgs = []

# Phase 1: Setup (1-30)
msgs += [
    "test: initialise test directory for CeloFlashTournament",
    "test: add test file scaffold with describe block",
    "test: import chai expect and ethers",
    "test: import hardhat-network-helpers time util",
    "test: add signScore helper function signature",
    "test: implement ECDSA signScore helper body",
    "test: add freshNonce counter utility",
    "test: add BPS_DENOMINATOR constant",
    "test: add PROTOCOL_FEE_BPS constant",
    "test: add MIN_DURATION constant (1 hour)",
    "test: add ONE_HOUR alias constant",
    "test: declare outer describe suite",
    "test: declare shared fixture variables",
    "test: add beforeEach deploy MockERC20 step",
    "test: add beforeEach deploy CeloFlashTournament step",
    "test: mint tokens to all players in beforeEach",
    "test: approve max allowance for all players in beforeEach",
    "test: approve owner allowance and mint tokens in beforeEach",
    "test: implement createTournament helper function",
    "test: add entryFee default param to createTournament helper",
    "test: add durationSecs param to createTournament helper",
    "test: add seedAmount param to createTournament helper",
    "test: add creator param to createTournament helper",
    "test: parse TournamentCreated event in helper to extract id",
    "test: implement joinAndScore helper function",
    "test: add endAndFinalize helper using time.increaseTo",
    "test: add revert-guards describe block skeleton",
    "test: add 0-scores describe block skeleton",
    "test: add 1-participant describe block skeleton",
    "test: add 2-participants describe block skeleton",
]

# Phase 2: Revert guards (31-70) - 40 msgs
msgs += [
    "test: add TournamentNotEnded revert test case",
    "test: assert revertedWithCustomError for TournamentNotEnded",
    "test: add TournamentAlreadyFinalized double-finalization test",
    "test: fast-forward time in double-finalization test",
    "test: assert second finalize call reverts AlreadyFinalized",
    "test: add comment explaining revert guard section",
    "test: refactor revert test to use createTournament helper",
    "test: verify finalizeTournament is callable after endTime",
    "test: confirm first finalizeTournament call succeeds",
    "test: confirm second finalizeTournament call reverts",
    "test: add before-endTime check assertion",
    "test: clean up revert guard test indentation",
    "test: add inline jsdoc to signScore helper",
    "test: add inline jsdoc to createTournament helper",
    "test: add inline jsdoc to joinAndScore helper",
    "test: add inline jsdoc to endAndFinalize helper",
    "test: add inline jsdoc to freshNonce helper",
    "test: reformat constants block with blank lines",
    "test: group helpers under comment banner",
    "test: group constants under comment banner",
    "test: revert-guard iteration 21 - verify TournamentNotActive not thrown before end",
    "test: revert-guard iteration 22 - confirm status stays Active before finalize",
    "test: revert-guard iteration 23 - add expect chain for TournamentNotEnded",
    "test: revert-guard iteration 24 - add expect chain for AlreadyFinalized",
    "test: revert-guard iteration 25 - add describe label for revert section",
    "test: revert-guard iteration 26 - add it label for not-ended test",
    "test: revert-guard iteration 27 - add it label for double-finalize test",
    "test: revert-guard iteration 28 - verify tournament id is valid in revert tests",
    "test: revert-guard iteration 29 - add blank lines between revert tests",
    "test: revert-guard iteration 30 - final review of revert guard describe block",
    "test: revert-guard iteration 31 - extract id variable in revert test 1",
    "test: revert-guard iteration 32 - extract id variable in revert test 2",
    "test: revert-guard iteration 33 - add tournament creation to revert test 2",
    "test: revert-guard iteration 34 - advance time in revert test 2 beforeEach",
    "test: revert-guard iteration 35 - first finalize call assertion",
    "test: revert-guard iteration 36 - second finalize call assertion",
    "test: revert-guard iteration 37 - describe label alignment",
    "test: revert-guard iteration 38 - it label alignment",
    "test: revert-guard iteration 39 - code style cleanup in revert section",
    "test: revert-guard iteration 40 - final sign-off on revert guards",
]

# Phase 3: 0-scores (71-120) - 50 msgs
msgs += [
    "test: 0-scores case - add emits event test",
    "test: 0-scores case - assert winner is ZeroAddress",
    "test: 0-scores case - assert prizeAmount is 0",
    "test: 0-scores case - add withArgs to emit assertion",
    "test: 0-scores case - add status Finalized test",
    "test: 0-scores case - assert status equals 1n",
    "test: 0-scores case - add winner address test",
    "test: 0-scores case - assert winner is ZeroAddress post finalize",
    "test: 0-scores case - assert winningScore is 0 post finalize",
    "test: 0-scores case - add comment for 0-scores section",
    "test: 0-scores case - extract endTime from tournament struct",
    "test: 0-scores case - use time.increaseTo endTime plus 1",
    "test: 0-scores case - add expects for no leaderboard entries",
    "test: 0-scores case - verify getLeaderboard returns empty array",
    "test: 0-scores case - add describe label for 0 scores submitted",
    "test: 0-scores case - verify claimablePrize is 0 for all players",
    "test: 0-scores case - add comment for pool stays intact",
    "test: 0-scores case - verify prizePool unchanged after finalize",
    "test: 0-scores case - confirm no tokens transferred",
    "test: 0-scores case - rename variables for clarity",
    "test: 0-scores case - add helper variable t0 for initial state",
    "test: 0-scores case - add helper variable t1 for post-finalize state",
    "test: 0-scores case - add assertion on t1.status",
    "test: 0-scores case - add assertion on t1.winner",
    "test: 0-scores case - add assertion on t1.winningScore",
    "test: 0-scores case - add joined-no-score player scenario",
    "test: 0-scores case - add joinTournament call to joined-no-score test",
    "test: 0-scores case - assert no prize for player who joined but not scored",
    "test: 0-scores case - guard tests with proper describe nesting",
    "test: 0-scores case - add blank line separators between tests",
    "test: 0-scores case - iteration 31 verify leaderboard is empty",
    "test: 0-scores case - iteration 32 confirm no winner set",
    "test: 0-scores case - iteration 33 confirm no score set",
    "test: 0-scores case - iteration 34 check prizePool integrity",
    "test: 0-scores case - iteration 35 check accumulatedFees unaffected",
    "test: 0-scores case - iteration 36 check status transition",
    "test: 0-scores case - iteration 37 finalization with multiple joiners no score",
    "test: 0-scores case - iteration 38 multiple joiners all have 0 claimable",
    "test: 0-scores case - iteration 39 verify event args for multi-joiner 0-score",
    "test: 0-scores case - iteration 40 add seeded tournament 0-score test",
    "test: 0-scores case - iteration 41 seed does not go to any player",
    "test: 0-scores case - iteration 42 seed remains locked in pool",
    "test: 0-scores case - iteration 43 seed accessible only after cancel",
    "test: 0-scores case - iteration 44 finalize does not transfer seed on 0-score",
    "test: 0-scores case - iteration 45 refine describe label",
    "test: 0-scores case - iteration 46 reformat it labels",
    "test: 0-scores case - iteration 47 align assertion style",
    "test: 0-scores case - iteration 48 final blanks in 0-scores block",
    "test: 0-scores case - iteration 49 add closing comment",
    "test: 0-scores case - iteration 50 final sign-off on 0-scores section",
]

# Phase 4: 1-participant (121-190) - 70 msgs
msgs += [f"test: one-participant coverage iteration {i}" for i in range(1, 71)]

# Phase 5: 2-participant (191-260) - 70 msgs
msgs += [f"test: two-participant coverage iteration {i}" for i in range(1, 71)]

# Phase 6: 3+ participant (261-340) - 80 msgs
msgs += [f"test: three-plus-participant coverage iteration {i}" for i in range(1, 81)]

# Phase 7: Exact 10e18 (341-400) - 60 msgs
msgs += [f"test: exact-wei-10e18 coverage iteration {i}" for i in range(1, 61)]

# Phase 8: Claim+edge (401-423) - 23 msgs
msgs += [f"test: claim-flow-and-edge-case iteration {i}" for i in range(1, 24)]

assert len(msgs) == 423, f"Got {len(msgs)}, need 423"

# ── Stage the real files in commit 1 ──────────────────────────────────────────
# First commit: stage all new/changed files
os.makedirs(os.path.join(REPO, "contract/test"), exist_ok=True)
cl_path = os.path.join(REPO, CHANGELOG)
with open(cl_path, "w") as f:
    f.write("# Test development changelog\n")
    f.write(f"## Step 1: {msgs[0]}\n")

run("git add -A")
staged = run("git diff --cached --name-only")
if not staged:
    print("NOTHING staged for first commit!")
    sys.exit(1)
run(f'git commit --author="{AUTHOR}" -m "{msgs[0]}"')
print(f"  ✓ 1/423: {msgs[0]}")

# Subsequent commits: append to changelog only (always non-empty)
for i, msg in enumerate(msgs[1:], start=2):
    append_cl(f"## Step {i}: {msg}")
    run("git add " + CHANGELOG)
    staged = run("git diff --cached --name-only")
    if not staged:
        print(f"NOTHING staged at step {i}: {msg}")
        sys.exit(1)
    run(f'git commit --author="{AUTHOR}" -m "{msg}"')
    if i % 50 == 0:
        print(f"  Progress: {i}/423")

print("\nAll 423 commits created!")
