#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[pr-auto] Required command not found: $1"
    exit 1
  fi
}

require_cmd git
require_cmd gh

if ! gh auth status >/dev/null 2>&1; then
  echo "[pr-auto] gh is not authenticated. Run: gh auth login"
  exit 1
fi

REMOTE="${PR_AUTO_REMOTE:-origin}"
AUTOBRANCH="${PR_AUTO_AUTOBRANCH:-1}"
ALLOW_DIRTY="${PR_AUTO_ALLOW_DIRTY:-0}"
RUN_REVIEW="${SKIP_CODEX_REVIEW:-0}"
AUTO_COMMIT="${PR_AUTO_AUTOCOMMIT:-1}"
REVIEW_REQUIRED="${PR_AUTO_REVIEW_REQUIRED:-0}"
REPAIR_HISTORY="${PR_AUTO_REPAIR_HISTORY:-1}"
HISTORY_REPAIRED=0
COMMIT_PROMPT_DEFAULT="Generate a git commit message from the currently staged diff.
Requirements:
- Output plain text only (no markdown fences).
- First line: concise imperative title, max 72 chars.
- Optionally add a short body with bullet points for key changes.
- Reflect the real changed files and behavior.
- Do not mention AI, Codex, or automation.
"

is_dirty_tree() {
  if ! git diff --quiet; then return 0; fi
  if ! git diff --cached --quiet; then return 0; fi
  if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then return 0; fi
  return 1
}

generate_commit_message() {
  local out_file="$1"
  local prompt="${PR_AUTO_COMMIT_PROMPT:-$COMMIT_PROMPT_DEFAULT}"

  local codex_bin=""
  if [[ -n "${CODEX_BIN:-}" && -x "${CODEX_BIN}" ]]; then
    codex_bin="${CODEX_BIN}"
  elif command -v codex >/dev/null 2>&1; then
    codex_bin="$(command -v codex)"
  elif [[ -x "/Applications/Codex.app/Contents/Resources/codex" ]]; then
    codex_bin="/Applications/Codex.app/Contents/Resources/codex"
  fi

  if [[ -n "$codex_bin" ]]; then
    local raw_file
    raw_file="$(mktemp)"
    if "$codex_bin" exec --sandbox read-only -a never -C "$ROOT_DIR" -o "$raw_file" "$prompt" >/dev/null 2>&1; then
      # Normalize line endings and trim excessive blank lines.
      awk 'BEGIN{blank=0} {gsub(/\r$/, ""); if ($0 ~ /^[[:space:]]*$/) {blank++; if (blank > 1) next} else {blank=0} print}' "$raw_file" > "$out_file"
      rm -f "$raw_file"
      if [[ -s "$out_file" ]]; then
        return 0
      fi
    else
      rm -f "$raw_file"
    fi
  fi

  local file_count
  file_count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  printf "chore: update %s files\n" "${file_count:-project}" > "$out_file"
  return 0
}

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" == "HEAD" ]]; then
  echo "[pr-auto] Detached HEAD is not supported. Checkout a branch first."
  exit 2
fi

DIRTY_TREE=0
if is_dirty_tree; then
  DIRTY_TREE=1
fi

if [[ "$DIRTY_TREE" == "1" && "$AUTO_COMMIT" != "1" && "$ALLOW_DIRTY" != "1" ]]; then
    echo "[pr-auto] Working tree is dirty. Commit or stash changes first."
    echo "Or override once: PR_AUTO_ALLOW_DIRTY=1 pnpm run pr:auto"
    echo "Or enable auto-commit: PR_AUTO_AUTOCOMMIT=1 pnpm run pr:auto"
    exit 2
fi

if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  if [[ "$AUTOBRANCH" == "1" ]]; then
    NEW_BRANCH="codex/pr-$(date +%Y%m%d-%H%M%S)"
    echo "[pr-auto] Current branch is $CURRENT_BRANCH; creating work branch: $NEW_BRANCH"
    git switch -c "$NEW_BRANCH"
    CURRENT_BRANCH="$NEW_BRANCH"
  else
    echo "[pr-auto] Refusing to open PR directly from $CURRENT_BRANCH."
    echo "Set PR_AUTO_AUTOBRANCH=1 (default) or switch to a feature branch first."
    exit 2
  fi
fi

if [[ "$DIRTY_TREE" == "1" && "$AUTO_COMMIT" == "1" ]]; then
  echo "[pr-auto] Dirty tree detected. Auto-staging + auto-commit enabled."
  git add -A
  if git diff --cached --quiet; then
    echo "[pr-auto] No staged changes found after git add -A. Nothing to commit."
  else
    COMMIT_MSG_FILE="$(mktemp)"
    generate_commit_message "$COMMIT_MSG_FILE"
    echo "[pr-auto] Creating commit with generated message:"
    head -n 1 "$COMMIT_MSG_FILE"
    git commit -F "$COMMIT_MSG_FILE"
    rm -f "$COMMIT_MSG_FILE"
  fi
fi

BASE_BRANCH="${PR_AUTO_BASE:-}"
if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')"
fi

BASE_REMOTE_REF="${REMOTE}/${BASE_BRANCH}"
git fetch "$REMOTE" "$BASE_BRANCH" >/dev/null 2>&1 || true

BASE_COMPARE_REF="$BASE_REMOTE_REF"
if ! git rev-parse --verify "$BASE_COMPARE_REF" >/dev/null 2>&1; then
  BASE_COMPARE_REF="$BASE_BRANCH"
fi

if ! git merge-base "$CURRENT_BRANCH" "$BASE_COMPARE_REF" >/dev/null 2>&1; then
  if [[ "$REPAIR_HISTORY" != "1" ]]; then
    echo "[pr-auto] Branch '$CURRENT_BRANCH' has no common history with '$BASE_BRANCH'."
    echo "Set PR_AUTO_REPAIR_HISTORY=1 to auto-repair ancestry for PR compatibility."
    exit 2
  fi
  BACKUP_BRANCH="${CURRENT_BRANCH}.bak.$(date +%Y%m%d-%H%M%S)"
  PATCH_FILE="$(mktemp)"
  COMMIT_MSG_FILE=""
  echo "[pr-auto] No common history with $BASE_BRANCH. Auto-repairing branch ancestry..."
  echo "[pr-auto] Backup branch created: $BACKUP_BRANCH"
  git branch "$BACKUP_BRANCH" "$CURRENT_BRANCH"
  git diff --binary "$BASE_COMPARE_REF" "$CURRENT_BRANCH" > "$PATCH_FILE"
  git switch -C "$CURRENT_BRANCH" "$BASE_COMPARE_REF"
  if [[ -s "$PATCH_FILE" ]]; then
    git apply --3way --index "$PATCH_FILE"
    COMMIT_MSG_FILE="$(mktemp)"
    {
      echo "chore: align branch history with ${BASE_BRANCH} for PR"
      echo
      echo "- preserve current tree state"
      echo "- rebuild ancestry for GitHub PR compatibility"
    } > "$COMMIT_MSG_FILE"
    git commit -F "$COMMIT_MSG_FILE"
    rm -f "$COMMIT_MSG_FILE"
  else
    echo "[pr-auto] No content diff against $BASE_BRANCH; branch ancestry repaired without new commit."
  fi
  rm -f "$PATCH_FILE"
  HISTORY_REPAIRED=1
fi

if [[ "$RUN_REVIEW" != "1" ]]; then
  echo "[pr-auto] Running Codex review against base: $BASE_BRANCH"
  if ! bash scripts/codex-review.sh --base "$BASE_BRANCH"; then
    if [[ "$REVIEW_REQUIRED" == "1" ]]; then
      echo "[pr-auto] Review failed and PR_AUTO_REVIEW_REQUIRED=1; aborting."
      exit 2
    fi
    echo "[pr-auto] Review unavailable/failed; continuing (set PR_AUTO_REVIEW_REQUIRED=1 to enforce)."
  fi
else
  echo "[pr-auto] SKIP_CODEX_REVIEW=1 set; skipping review."
fi

run_push() {
  local force_flag=""
  if [[ "$HISTORY_REPAIRED" == "1" ]]; then
    force_flag="--force-with-lease"
  fi
  if [[ -n "$force_flag" ]]; then
    SKIP_CODEX_REVIEW=1 git push "$force_flag" -u "$REMOTE" "$CURRENT_BRANCH"
  else
    SKIP_CODEX_REVIEW=1 git push -u "$REMOTE" "$CURRENT_BRANCH"
  fi
}

push_with_retry() {
  local push_output=""
  set +e
  push_output="$(run_push 2>&1)"
  local rc=$?
  set -e
  printf '%s\n' "$push_output"
  if [[ $rc -eq 0 ]]; then
    return 0
  fi

  if printf '%s\n' "$push_output" | grep -Eq "RPC failed; HTTP 400|unexpected disconnect|remote end hung up unexpectedly"; then
    echo "[pr-auto] Push failed with HTTP transport error. Retrying once with HTTP/1.1 settings..."
    local force_flag=""
    if [[ "$HISTORY_REPAIRED" == "1" ]]; then
      force_flag="--force-with-lease"
    fi
    if [[ -n "$force_flag" ]]; then
      SKIP_CODEX_REVIEW=1 git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push "$force_flag" -u "$REMOTE" "$CURRENT_BRANCH"
    else
      SKIP_CODEX_REVIEW=1 git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push -u "$REMOTE" "$CURRENT_BRANCH"
    fi
    return $?
  fi

  if printf '%s\n' "$push_output" | grep -Eq "non-fast-forward|tip of your current branch is behind"; then
    if [[ "$CURRENT_BRANCH" == codex/* || "$HISTORY_REPAIRED" == "1" ]]; then
      echo "[pr-auto] Non-fast-forward on automation branch. Retrying with --force-with-lease..."
      SKIP_CODEX_REVIEW=1 git push --force-with-lease -u "$REMOTE" "$CURRENT_BRANCH"
      return $?
    fi
  fi

  return $rc
}

echo "[pr-auto] Pushing branch with upstream: $REMOTE/$CURRENT_BRANCH"
push_with_retry

PR_EXISTS=0
if gh pr view "$CURRENT_BRANCH" --json number >/dev/null 2>&1; then
  PR_EXISTS=1
fi

TITLE="${PR_AUTO_TITLE:-$(git log -1 --pretty=%s)}"
BODY="${PR_AUTO_BODY:-}"
if [[ -z "$BODY" ]]; then
  BODY=$(cat <<EOT
## Summary
- Automated PR created/updated by \`pnpm run pr:auto\`

## Verification
- [ ] \`pnpm run build\`
- [ ] Manual smoke checks completed
- [ ] Codex review completed (or intentionally skipped)
EOT
)
fi

if [[ "$PR_EXISTS" == "1" ]]; then
  echo "[pr-auto] Updating existing PR for branch: $CURRENT_BRANCH"
  gh pr edit "$CURRENT_BRANCH" --title "$TITLE" --body "$BODY" >/dev/null
else
  echo "[pr-auto] Creating PR: head=$CURRENT_BRANCH base=$BASE_BRANCH"
  gh pr create --base "$BASE_BRANCH" --head "$CURRENT_BRANCH" --title "$TITLE" --body "$BODY" >/dev/null
fi

if [[ -n "${PR_AUTO_REVIEWERS:-}" ]]; then
  IFS=',' read -r -a REVIEWERS <<<"${PR_AUTO_REVIEWERS}"
  ARGS=()
  for r in "${REVIEWERS[@]}"; do
    rr="$(echo "$r" | xargs)"
    [[ -z "$rr" ]] && continue
    ARGS+=(--add-reviewer "$rr")
  done
  if [[ ${#ARGS[@]} -gt 0 ]]; then
    echo "[pr-auto] Adding reviewers: ${PR_AUTO_REVIEWERS}"
    gh pr edit "$CURRENT_BRANCH" "${ARGS[@]}" >/dev/null || true
  fi
fi

if [[ -n "${PR_AUTO_LABELS:-}" ]]; then
  IFS=',' read -r -a LABELS <<<"${PR_AUTO_LABELS}"
  ARGS=()
  for l in "${LABELS[@]}"; do
    ll="$(echo "$l" | xargs)"
    [[ -z "$ll" ]] && continue
    ARGS+=(--add-label "$ll")
  done
  if [[ ${#ARGS[@]} -gt 0 ]]; then
    echo "[pr-auto] Adding labels: ${PR_AUTO_LABELS}"
    gh pr edit "$CURRENT_BRANCH" "${ARGS[@]}" >/dev/null || true
  fi
fi

PR_URL="$(gh pr view "$CURRENT_BRANCH" --json url --jq '.url')"
echo "[pr-auto] Done: $PR_URL"
