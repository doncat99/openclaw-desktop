#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

resolve_codex_bin() {
  if [[ -n "${CODEX_BIN:-}" && -x "${CODEX_BIN}" ]]; then
    echo "${CODEX_BIN}"
    return 0
  fi
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  local app_bin="/Applications/Codex.app/Contents/Resources/codex"
  if [[ -x "$app_bin" ]]; then
    echo "$app_bin"
    return 0
  fi
  return 1
}

if ! CODEX_BIN_RESOLVED="$(resolve_codex_bin)"; then
  echo "[codex-review] codex CLI not found."
  echo "Tried: PATH and /Applications/Codex.app/Contents/Resources/codex"
  echo "Set CODEX_BIN=/absolute/path/to/codex if installed elsewhere."
  exit 1
fi

MODE="base"
BASE_BRANCH="${CODEX_REVIEW_BASE:-}"
TITLE="${CODEX_REVIEW_TITLE:-}"
PROMPT="${CODEX_REVIEW_PROMPT:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uncommitted)
      MODE="uncommitted"
      shift
      ;;
    --base)
      BASE_BRANCH="${2:-}"
      if [[ -z "$BASE_BRANCH" ]]; then
        echo "[codex-review] --base requires a branch name"
        exit 2
      fi
      shift 2
      ;;
    --title)
      TITLE="${2:-}"
      if [[ -z "$TITLE" ]]; then
        echo "[codex-review] --title requires a value"
        exit 2
      fi
      shift 2
      ;;
    --prompt)
      PROMPT="${2:-}"
      if [[ -z "$PROMPT" ]]; then
        echo "[codex-review] --prompt requires a value"
        exit 2
      fi
      shift 2
      ;;
    *)
      echo "[codex-review] Unknown argument: $1"
      echo "Usage: bash scripts/codex-review.sh [--uncommitted] [--base <branch>] [--title <text>] [--prompt <text>]"
      exit 2
      ;;
  esac
done

if [[ "$MODE" == "base" && -z "$BASE_BRANCH" ]]; then
  for candidate in origin/main origin/master main master; do
    if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
      BASE_BRANCH="$candidate"
      break
    fi
  done
fi

if [[ "$MODE" == "base" && -z "$BASE_BRANCH" ]]; then
  echo "[codex-review] Could not resolve a base branch."
  echo "Run with: bash scripts/codex-review.sh --base origin/main"
  exit 2
fi

CMD=("$CODEX_BIN_RESOLVED" review)
if [[ "$MODE" == "uncommitted" ]]; then
  CMD+=(--uncommitted)
  if [[ -n "${CODEX_REVIEW_PROMPT:-}" ]]; then
    echo "[codex-review] Note: codex review --uncommitted does not accept a custom prompt; using default review rubric."
  fi
else
  CMD+=(--base "$BASE_BRANCH")
fi

if [[ -n "$TITLE" ]]; then
  CMD+=(--title "$TITLE")
fi

echo "[codex-review] Running: ${CMD[*]}"
if [[ -n "$PROMPT" ]]; then
  echo "[codex-review] Note: custom prompt is ignored for compatibility with this Codex CLI version."
fi
"${CMD[@]}"
