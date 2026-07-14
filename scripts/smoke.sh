#!/usr/bin/env bash
# Smoke test for ctxpack: exercises the real CLI end to end against the
# committed example specs. No network, idempotent, runs from a clean
# checkout (after `npm install`). Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

CHAT=examples/agent-chat.json
BRIEF=examples/doc-brief.json

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every command.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in pack explain check fingerprint --allow --budget "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Error handling: bad flags, bad specs and missing files exit 2.
set +e
$CLI pack "$CHAT" --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI pack >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing spec should exit 2"; }
$CLI pack does-not-exist.json >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing file should exit 2"; }
echo '{"budget": 0, "sections": []}' | $CLI pack - >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "bad budget should exit 2"; }
echo '{"budget": 10, "sections": [{"id":"a","text":"x","prioritiy":1}]}' | $CLI pack - >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "typo'd key should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 4. The flagship pack: pins survive, low-priority chatter does not.
PACKED="$($CLI pack "$CHAT")" || fail "pack should exit 0"
echo "$PACKED" | grep -q "You answer only from the provided context" || fail "pinned system prompt missing"
echo "$PACKED" | grep -q "rotation attempts fail" || fail "pinned question missing"
echo "$PACKED" | grep -q "role=owner" || fail "tool logs missing"
echo "$PACKED" | grep -q "note to self" && fail "evicted scratch leaked into the pack"
echo "[smoke] pack ok (pins kept, scratch evicted)"

# 5. explain is the audit trail: all three blocks with reasons.
EXPLAIN="$($CLI explain "$CHAT")" || fail "explain should exit 0"
for want in "packing decisions" "KEPT (3)" "TRUNCATED (1)" "EVICTED (2)" "[group-quota]" "[budget]" "fingerprint"; do
  echo "$EXPLAIN" | grep -qF "$want" || fail "explain output missing: $want"
done
echo "[smoke] explain ok (kept/truncated/evicted with reasons)"

# 6. Reproducibility: fingerprints are stable, and overrides change them.
FP1="$($CLI fingerprint "$CHAT")"
FP2="$($CLI fingerprint "$CHAT")"
[ "$FP1" = "$FP2" ] || fail "fingerprint is not deterministic"
echo "$FP1" | grep -qE '^[0-9a-f]{16}$' || fail "fingerprint is not 16 hex chars: $FP1"
FP3="$($CLI fingerprint "$CHAT" --budget 400)"
[ "$FP1" != "$FP3" ] || fail "budget override should change the fingerprint"
FP4="$($CLI fingerprint - < "$CHAT")"
[ "$FP1" = "$FP4" ] || fail "stdin spec should fingerprint identically"
echo "[smoke] fingerprint ok ($FP1)"

# 7. check is a CI gate: fails closed, --allow opens it deliberately.
set +e
$CLI check "$CHAT" >/dev/null; [ $? -eq 1 ] || { set -e; fail "check should fail closed"; }
$CLI check "$CHAT" --allow truncate >/dev/null; [ $? -eq 1 ] || { set -e; fail "evictions should still fail with --allow truncate"; }
set -e
$CLI check "$CHAT" --allow truncate,evict >/dev/null || fail "check --allow truncate,evict should pass"
$CLI check "$CHAT" --allow truncate,evict --json | node -e "
  const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (r.pass !== true) throw new Error('pass');
  if (r.evicted !== 2 || r.truncated !== 1) throw new Error('counts');
" || fail "check --json is not structurally intact"
echo "[smoke] check gate ok (1 closed / 0 allowed)"

# 8. pack --json round-trips and agrees with the fingerprint command.
$CLI pack "$CHAT" --json > "$WORKDIR/layout.json" || fail "pack --json failed"
node -e "
  const l = JSON.parse(require('fs').readFileSync('$WORKDIR/layout.json', 'utf8'));
  if (l.fingerprint !== '$FP1') throw new Error('fingerprint mismatch');
  if (!l.fits) throw new Error('fits');
  if (l.tokens.used > l.tokens.capacity) throw new Error('over capacity');
  if (l.decisions.length !== 6) throw new Error('decisions');
" || fail "pack --json disagrees with fingerprint/check"
echo "[smoke] pack --json ok (agrees with fingerprint)"

# 9. The second example: word counter, priority order, truncate-middle.
BRIEF_OUT="$($CLI pack "$BRIEF")" || fail "doc-brief pack should exit 0"
echo "$BRIEF_OUT" | head -1 | grep -q "Summarize the incident" || fail "priority order should put the task first"
echo "$BRIEF_OUT" | grep -qF " […] " || fail "truncate-middle marker missing"
echo "[smoke] doc-brief ok (priority order + truncate-middle)"

# 10. Pinned overflow never crashes: exit 1 with the pins intact.
set +e
OVERFLOW="$(printf '{"budget": 8, "sections": [{"id": "pin", "text": "cannot possibly fit in eight tokens, ever", "pinned": true}]}' | $CLI explain -)"
CODE=$?
set -e
[ "$CODE" -eq 1 ] || fail "pinned overflow should exit 1, got $CODE"
echo "$OVERFLOW" | grep -q "OVERFLOW: pinned sections alone exceed capacity" || fail "overflow warning missing"
echo "[smoke] pinned overflow ok (exit 1, no crash)"

echo "SMOKE OK"
