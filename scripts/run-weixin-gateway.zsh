#!/bin/zsh
set -eu

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

export HOTFLOW_WORKSPACE_ROOT="${HOTFLOW_WORKSPACE_ROOT:-$REPO_ROOT}"
export DIRECTOR_HOST_API_URL="${DIRECTOR_HOST_API_URL:-http://127.0.0.1:3201}"

cd "$REPO_ROOT"
exec pnpm weixin:start
