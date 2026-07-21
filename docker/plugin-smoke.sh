#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   docker/plugin-smoke.sh <slug> [--host-ref <ref>] [--port <n>]
#   docker/plugin-smoke.sh <slug> --down
#
# Builds this plugin, spins up a real claude4spec host (sibling checkout, or
# a `--host-ref` worktree) with this plugin's dist/ read-only bind-mounted
# into a seeded project, polls until the contributed entity type(s) are
# `active`, then leaves it running and prints the URL. Scoped end-to-end by
# <slug> (C4S_ENV, PORT_HOST, any host-side smoke worktree) so concurrent
# worktrees/briefs never collide. Never touches the host's own working tree.
#
# Every invocation recreates the container from scratch (--force-recreate) —
# don't rely on hot-reload across the bind mount (Docker Desktop file-watch
# propagation isn't guaranteed); re-run this script after every rebuild.

cd "$(dirname "$0")/.."   # this plugin's invoking checkout (worktree or main)
PLUGIN_PKG_ROOT="$(pwd)"

SLUG="${1:?usage: docker/plugin-smoke.sh <slug> [--host-ref <ref>] [--port <n>] | <slug> --down}"
shift
DOWN=0
HOST_REF=""
PORT_HOST="${PORT_HOST:-3000}"
while [ $# -gt 0 ]; do
  case "$1" in
    --down) DOWN=1 ;;
    --host-ref) HOST_REF="${2:?--host-ref needs a value}"; shift ;;
    --port) PORT_HOST="${2:?--port needs a value}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

PLUGIN_NAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).name)")"

# ─── resolve host checkout ──────────────────────────────────────────────────

# Worktree-safe: same value whether invoked from the main checkout or a
# nested .worktrees/<slug>/ worktree (mirrors docker/setup-env.sh's own
# MAIN_ROOT convention in the host repo).
PLUGIN_MAIN_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"

# Two distinct outcomes on auto-detect failure — "nothing found" vs "found a
# host checkout but it's missing plugin-mount support" — get different error
# messages, so this returns via two separate globals rather than mixing
# stdout/stderr in one function.
FOUND_HOST_DIR=""
FOUND_WRONG_VERSION=""
find_host_dir() {
  local anc candidate
  for anc in "$(dirname "$PLUGIN_MAIN_ROOT")" "$(dirname "$(dirname "$PLUGIN_MAIN_ROOT")")"; do
    [ -d "$anc" ] || continue
    for candidate in "$anc"/claude4spec*; do
      [ -d "$candidate" ] || continue
      if [ -f "$candidate/docker-compose.yml" ]; then
        if [ -f "$candidate/docker-compose.plugin.yml" ]; then
          FOUND_HOST_DIR="$candidate"
          return 0
        fi
        FOUND_WRONG_VERSION="$candidate"
      fi
    done
  done
  return 1
}

HOST_DIR="${C4S_HOST_DIR:-}"
if [ -z "$HOST_DIR" ]; then
  if find_host_dir; then
    HOST_DIR="$FOUND_HOST_DIR"
  elif [ -n "$FOUND_WRONG_VERSION" ]; then
    cat >&2 <<EOF
ERROR: found a claude4spec host checkout at:
  $FOUND_WRONG_VERSION
...but it's missing docker-compose.plugin.yml — that checkout predates
plugin-mount smoke-test support (wrong branch, or not merged yet there).
Check out the branch/PR that adds it, or pass:
  --host-ref <branch-or-pr-number-or-sha>
to test against it in an isolated worktree without touching your checkout.
EOF
    exit 1
  else
    cat >&2 <<EOF
ERROR: could not find a claude4spec host checkout with plugin-mount support.
Searched for a 'claude4spec*' directory containing both docker-compose.yml
and docker-compose.plugin.yml at its root, under:
  $(dirname "$PLUGIN_MAIN_ROOT")
  $(dirname "$(dirname "$PLUGIN_MAIN_ROOT")")

If you already have a checkout elsewhere:
  export C4S_HOST_DIR=/path/to/claude4spec
Otherwise, clone it yourself (never done automatically by this script):
  git clone <remote-url> ../../claude4spec
EOF
    exit 1
  fi
  # Persist only if absent — mirrors docker/setup-env.sh's own
  # AGENT_ADAPTERS_DIR/AGENT_CHAT_DIR default-persistence convention.
  if [ ! -f .env ] || ! grep -q "^C4S_HOST_DIR=" .env 2>/dev/null; then
    if [ -s .env ] && [ -n "$(tail -c1 .env 2>/dev/null)" ]; then printf '\n' >> .env; fi
    printf 'C4S_HOST_DIR=%s\n' "$HOST_DIR" >> .env
  fi
fi

# A smoke worktree, once created by an earlier --host-ref run, is always
# targeted by its slug alone from here on — including on `--down` and on a
# later `up` that omits --host-ref — so tearing down never depends on the
# caller remembering to repeat --host-ref.
SMOKE_WORKTREE="$HOST_DIR/.worktrees/plugin-smoke-$SLUG"
if [ -n "$HOST_REF" ]; then
  if [[ "$HOST_REF" =~ ^#?[0-9]+$ ]]; then
    PR_NUM="${HOST_REF#\#}"
    FETCH_REF="pull/$PR_NUM/head"
  else
    FETCH_REF="$HOST_REF"
  fi
  if [ -d "$SMOKE_WORKTREE" ]; then
    # Already exists from a prior run for this slug — update the branch it
    # already has checked out FROM INSIDE that worktree (git refuses to
    # fetch into a branch checked out in a DIFFERENT worktree, which is what
    # re-running the `worktree add` path below would otherwise attempt).
    git -C "$SMOKE_WORKTREE" fetch origin "$FETCH_REF" --quiet
    git -C "$SMOKE_WORKTREE" reset --hard FETCH_HEAD --quiet
  else
    git -C "$HOST_DIR" fetch origin --quiet
    if [ -n "${PR_NUM:-}" ]; then
      git -C "$HOST_DIR" fetch origin "$FETCH_REF:plugin-smoke-pr-$PR_NUM" --quiet
      CHECKOUT_REF="plugin-smoke-pr-$PR_NUM"
    else
      CHECKOUT_REF="$FETCH_REF"
    fi
    git -C "$HOST_DIR" worktree add "$SMOKE_WORKTREE" "$CHECKOUT_REF" --quiet
  fi
  HOST_DIR="$SMOKE_WORKTREE"
elif [ -d "$SMOKE_WORKTREE" ]; then
  HOST_DIR="$SMOKE_WORKTREE"
fi

# Re-check the version gate on the FINAL resolved HOST_DIR (post --host-ref) —
# a stale/old ref would otherwise silently run against the wrong contract.
if [ ! -f "$HOST_DIR/docker-compose.yml" ] || [ ! -f "$HOST_DIR/docker-compose.plugin.yml" ]; then
  echo "ERROR: $HOST_DIR does not have plugin-mount support (docker-compose.plugin.yml missing) — wrong ref?" >&2
  exit 1
fi

# ─── --down ─────────────────────────────────────────────────────────────────

if [ "$DOWN" = "1" ]; then
  # PLUGIN_ROOT/PLUGIN_MOUNT_NAME must still be set — Compose validates
  # required-var interpolation (docker-compose.plugin.yml's `:?`) even for
  # `down`, not just `up`.
  (
    cd "$HOST_DIR"
    PLUGIN_ROOT="$PLUGIN_PKG_ROOT" PLUGIN_MOUNT_NAME="$PLUGIN_NAME" C4S_ENV="$SLUG" \
      docker compose -f docker-compose.yml -f docker-compose.plugin.yml down
  )
  # SMOKE_WORKTREE was resolved earlier (before HOST_DIR was possibly
  # redirected into it) — reuse that value, don't recompute it from the
  # now-possibly-already-redirected HOST_DIR.
  if [ -d "$SMOKE_WORKTREE" ]; then
    MAIN_HOST_DIR="$(cd "$SMOKE_WORKTREE" && git rev-parse --git-common-dir | xargs dirname)"
    git -C "$MAIN_HOST_DIR" worktree remove "$SMOKE_WORKTREE" --force
  fi
  echo "Torn down: C4S_ENV=$SLUG"
  exit 0
fi

# ─── build + introspect ─────────────────────────────────────────────────────

npm run build
PLUGIN_DIST="$PLUGIN_PKG_ROOT/dist"
[ -f "$PLUGIN_DIST/index.js" ] || { echo "ERROR: $PLUGIN_DIST/index.js missing after build" >&2; exit 1; }
if [ -n "$(find src -newer "$PLUGIN_DIST/index.js" -type f 2>/dev/null)" ]; then
  echo "WARNING: src/ has files newer than dist/index.js — rebuild may be stale" >&2
fi

PLUGIN_ENTITY_TYPES_JSON="$(node -e "
import('$PLUGIN_DIST/index.js').then(m => {
  const manifest = m.manifest ?? m.default;
  console.log(JSON.stringify((manifest.contributes.entities || []).map(e => e.type)));
}).catch(err => { console.error('failed to introspect plugin manifest:', err.message); process.exit(1); });
")"
PLUGIN_ENTITY_TYPES_CSV="$(node -e "console.log(JSON.parse(process.argv[1]).join(','))" "$PLUGIN_ENTITY_TYPES_JSON")"
if [ -z "$PLUGIN_ENTITY_TYPES_CSV" ]; then
  echo "ERROR: plugin manifest contributes no entity types — nothing to smoke-test" >&2
  exit 1
fi

# ─── bring up ────────────────────────────────────────────────────────────────

(
  cd "$HOST_DIR"
  ./docker/setup-plugin-env.sh "$SLUG" "--entity-type=$PLUGIN_ENTITY_TYPES_CSV"
  PLUGIN_ROOT="$PLUGIN_PKG_ROOT" PLUGIN_MOUNT_NAME="$PLUGIN_NAME" \
  C4S_ENV="$SLUG" PORT_HOST="$PORT_HOST" \
    docker compose -f docker-compose.yml -f docker-compose.plugin.yml up -d --force-recreate app-registry
)

# Deterministic — same fixed PROJECT_DIR ("/workspace/project") every time,
# so no need to query for it.
PROJECT_ID="$(printf '%s' "/workspace/project" | shasum | cut -c1-12)"
BASE="http://localhost:$PORT_HOST/api/projects/$PROJECT_ID"

SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-90}"
deadline=$(( $(date +%s) + SMOKE_TIMEOUT ))
while :; do
  plugins_json="$(curl -fsS "$BASE/_meta/plugins" 2>/dev/null || true)"
  if [ -n "$plugins_json" ]; then
    ready="$(node -e "
      const d = JSON.parse(process.argv[1]);
      const p = d.packages.find(p => p.package === process.argv[2]);
      console.log(d.trust === true && p && p.status === 'loaded' ? 'ready' : (p ? p.status : 'absent'));
    " "$plugins_json" "$PLUGIN_NAME")"
    if [ "$ready" = "ready" ]; then
      entities_json="$(curl -fsS "$BASE/_meta/entities")"
      all_active="$(node -e "
        const active = new Set(JSON.parse(process.argv[1]).active);
        const types = JSON.parse(process.argv[2]);
        console.log(types.every((t) => active.has(t)) ? '1' : '0');
      " "$entities_json" "$PLUGIN_ENTITY_TYPES_JSON")"
      [ "$all_active" = "1" ] && break
    elif [ "$ready" = "incompatible" ] || [ "$ready" = "failed" ]; then
      echo "ERROR: plugin failed to load (status=$ready) — likely a host/plugin API mismatch or a runtime bug. Full record:" >&2
      node -e "console.log(JSON.stringify(JSON.parse(process.argv[1]).packages.find((p) => p.package === process.argv[2]), null, 2))" \
        "$plugins_json" "$PLUGIN_NAME" >&2
      exit 1
    fi
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "ERROR: timed out after ${SMOKE_TIMEOUT:-90}s waiting for '$PLUGIN_NAME' to become active" >&2
    exit 1
  fi
  sleep 2
done

echo "Plugin '$PLUGIN_NAME' active — entity type(s): $PLUGIN_ENTITY_TYPES_CSV"
echo "http://localhost:$PORT_HOST — project id $PROJECT_ID"
