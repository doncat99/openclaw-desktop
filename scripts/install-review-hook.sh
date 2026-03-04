#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

git config core.hooksPath .githooks
chmod +x .githooks/pre-push

echo "[review-hook] Installed Git hooks path: .githooks"
echo "[review-hook] Pre-push now runs: bash scripts/codex-review.sh --uncommitted"
echo "[review-hook] To bypass once: SKIP_CODEX_REVIEW=1 git push"
