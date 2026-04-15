#!/usr/bin/env bash
# PayCraft Release Script
# ─────────────────────────────────────────────────────────────────────────────
# Merges development → main, runs the full quality gate locally, creates a
# git tag on main, and pushes to GitHub.
# Pushing the tag triggers release.yml → creates GitHub Release →
# which triggers publish.yml → publishes to Maven Central.
#
# Usage:
#   ./scripts/release.sh                   # auto-reads version from build.gradle.kts
#   ./scripts/release.sh --version 1.2.0   # explicit version
#   ./scripts/release.sh --local-maven     # also publish to local Maven (~/.m2)
#   ./scripts/release.sh --dry-run         # run checks only, no merge/tag/push
#   ./scripts/release.sh --skip-merge      # skip development→main merge (already on main)
#
# Prerequisites:
#   - .env file exists (cp .env.example .env && fill it in)
#   - git is clean (no uncommitted changes)
#   - gh CLI installed (required for PR-based merge fallback)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Load .env ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo "⚠️  .env file not found at $ENV_FILE"
  echo "   Creating from .env.example — fill in your values first."
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo ""
  echo "   Open .env and set at minimum:"
  echo "   - PAYCRAFT_MAVEN_CENTRAL_USERNAME"
  echo "   - PAYCRAFT_MAVEN_CENTRAL_PASSWORD"
  echo "   - PAYCRAFT_SIGNING_KEY_ID"
  echo "   - PAYCRAFT_SIGNING_PASSWORD"
  echo "   - PAYCRAFT_GPG_KEY_CONTENTS"
  echo ""
  echo "   Then re-run: ./scripts/release.sh"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

# ── Parse arguments ──────────────────────────────────────────────────────────
EXPLICIT_VERSION=""
LOCAL_MAVEN=false
DRY_RUN=false
SKIP_MERGE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)     EXPLICIT_VERSION="$2"; shift 2 ;;
    --local-maven) LOCAL_MAVEN=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    --skip-merge)  SKIP_MERGE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Resolve version ───────────────────────────────────────────────────────────
if [ -n "$EXPLICIT_VERSION" ]; then
  VERSION="$EXPLICIT_VERSION"
else
  VERSION=$(grep -E '^version\s*=' "$ROOT_DIR/cmp-paycraft/build.gradle.kts" \
    | head -1 | sed 's/.*"\(.*\)".*/\1/')
fi

if [ -z "$VERSION" ]; then
  echo "❌  Could not determine version. Use --version X.Y.Z"
  exit 1
fi

TAG="v$VERSION"
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  PayCraft Release: $TAG"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ── Check git state ───────────────────────────────────────────────────────────
cd "$ROOT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌  Uncommitted changes detected. Commit or stash first."
  git status --short
  exit 1
fi

# ── Step 1: Merge development → main ─────────────────────────────────────────
if [ "$SKIP_MERGE" = false ] && [ "$DRY_RUN" = false ]; then
  echo "▶  [1/6] Merging development → main..."

  git fetch origin development main

  BEHIND=$(git rev-list origin/main..origin/development --count 2>/dev/null || echo "0")

  if [ "$BEHIND" = "0" ]; then
    echo "✅  main is already up-to-date with development"
  else
    echo "   development is $BEHIND commit(s) ahead of main — merging..."

    git checkout main
    git pull origin main --ff-only

    if git merge --ff-only origin/development 2>/dev/null; then
      echo "   Fast-forward merge succeeded"
      git push origin main
      echo "✅  development merged into main (fast-forward)"
    else
      echo "   Fast-forward not possible — creating PR via gh CLI..."
      if ! command -v gh &>/dev/null; then
        echo "❌  gh CLI required for non-fast-forward merge. Install: https://cli.github.com"
        exit 1
      fi

      PR_URL=$(gh pr create \
        --base main \
        --head development \
        --title "chore: release $TAG" \
        --body "Automated merge of development → main for release $TAG" \
        2>&1 | tail -1)

      PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
      echo "   Created PR #$PR_NUMBER — merging..."
      gh pr merge "$PR_NUMBER" --merge --admin
      git pull origin main --ff-only
      echo "✅  development merged into main via PR #$PR_NUMBER"
    fi
  fi

  # Ensure we're on main for tagging
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$CURRENT_BRANCH" != "main" ]; then
    git checkout main
    git pull origin main --ff-only
  fi
else
  echo "▶  [1/6] Skipping merge (--skip-merge or --dry-run)"
fi

# ── Check tag doesn't already exist ──────────────────────────────────────────
if [ "$DRY_RUN" = false ]; then
  if git tag -l | grep -q "^$TAG$"; then
    echo "❌  Tag $TAG already exists locally."
    exit 1
  fi

  if git ls-remote --tags origin | grep -q "refs/tags/$TAG$"; then
    echo "❌  Tag $TAG already exists on remote."
    exit 1
  fi
fi

# ── Gate 2: Spotless ─────────────────────────────────────────────────────────
echo "▶  [2/6] Running Spotless check..."
./gradlew spotlessCheck --quiet
echo "✅  Spotless passed"

# ── Gate 3: Detekt ───────────────────────────────────────────────────────────
echo "▶  [3/6] Running Detekt..."
./gradlew detekt --quiet
echo "✅  Detekt passed"

# ── Gate 4: JVM tests ────────────────────────────────────────────────────────
echo "▶  [4/6] Running JVM tests..."
./gradlew jvmTest --quiet
echo "✅  JVM tests passed"

# ── Gate 5: Build library (all targets) ──────────────────────────────────────
# Matches exactly what CI runs in release.yml and gradle.yml
echo "▶  [5/6] Building cmp-paycraft (all targets — same as CI)..."
./gradlew :cmp-paycraft:assemble --quiet
echo "✅  Library build passed (all targets)"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "✅  Dry run complete. All checks passed."
  echo "   Re-run without --dry-run to merge, tag, and push."
  exit 0
fi

# ── Gate 6: Local Maven (optional) ──────────────────────────────────────────
if [ "$LOCAL_MAVEN" = true ]; then
  echo "▶  [6/6] Publishing to local Maven (~/.m2)..."
  ./gradlew publishToMavenLocal \
    -PmavenCentralUsername="${PAYCRAFT_MAVEN_CENTRAL_USERNAME:-}" \
    -PmavenCentralPassword="${PAYCRAFT_MAVEN_CENTRAL_PASSWORD:-}" \
    -PsigningInMemoryKeyId="${PAYCRAFT_SIGNING_KEY_ID:-}" \
    -PsigningInMemoryKeyPassword="${PAYCRAFT_SIGNING_PASSWORD:-}" \
    -PsigningInMemoryKey="${PAYCRAFT_GPG_KEY_CONTENTS:-}" \
    --quiet
  echo "✅  Published to ~/.m2 — artifact: io.github.mobilebytelabs:paycraft:$VERSION"
else
  echo "▶  [6/6] Skipping local Maven (use --local-maven to enable)"
fi

# ── Tag and push ─────────────────────────────────────────────────────────────
echo ""
echo "▶  Creating tag $TAG on main..."
git tag -a "$TAG" -m "PayCraft $TAG"

echo "▶  Pushing tag to GitHub..."
git push origin "$TAG"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  ✅  $TAG pushed!"
echo "║"
echo "║  GitHub Actions will now:"
echo "║  1. release.yml  → run quality gate + create GitHub Release"
echo "║  2. publish.yml  → publish to Maven Central (~10 min)"
echo "║"
echo "║  Track progress:"
echo "║  https://github.com/MobileByteLabs/PayCraft/actions"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
