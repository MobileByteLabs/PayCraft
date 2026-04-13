#!/usr/bin/env bash
# PayCraft Release Script
# ─────────────────────────────────────────────────────────────────────────────
# Runs the full quality gate locally, creates a git tag, and pushes to GitHub.
# Pushing the tag triggers release.yml → creates GitHub Release →
# which triggers publish.yml → publishes to Maven Central.
#
# Usage:
#   ./scripts/release.sh                   # auto-reads version from build.gradle.kts
#   ./scripts/release.sh --version 1.2.0   # explicit version
#   ./scripts/release.sh --local-maven     # also publish to local Maven (~/.m2)
#   ./scripts/release.sh --dry-run         # run checks only, no tag/push
#
# Prerequisites:
#   - .env file exists (cp .env.example .env && fill it in)
#   - git is clean (no uncommitted changes)
#   - gh CLI installed (for release notes, optional)
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) EXPLICIT_VERSION="$2"; shift 2 ;;
    --local-maven) LOCAL_MAVEN=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
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

if [ "$DRY_RUN" = false ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌  Uncommitted changes detected. Commit or stash first."
    git status --short
    exit 1
  fi

  if git tag -l | grep -q "^$TAG$"; then
    echo "❌  Tag $TAG already exists locally."
    exit 1
  fi
fi

# ── Gate 1: Spotless ─────────────────────────────────────────────────────────
echo "▶  [1/5] Running Spotless check..."
./gradlew spotlessCheck --quiet
echo "✅  Spotless passed"

# ── Gate 2: Detekt ───────────────────────────────────────────────────────────
echo "▶  [2/5] Running Detekt..."
./gradlew detekt --quiet
echo "✅  Detekt passed"

# ── Gate 3: JVM tests ────────────────────────────────────────────────────────
echo "▶  [3/5] Running JVM tests..."
./gradlew jvmTest --quiet
echo "✅  JVM tests passed"

# ── Gate 4: Build ────────────────────────────────────────────────────────────
echo "▶  [4/5] Building all targets..."
./gradlew assemble --quiet
echo "✅  Build passed"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "✅  Dry run complete. All checks passed."
  echo "   Re-run without --dry-run to tag and push."
  exit 0
fi

# ── Gate 5: Local Maven (optional) ──────────────────────────────────────────
if [ "$LOCAL_MAVEN" = true ]; then
  echo "▶  [5/5] Publishing to local Maven (~/.m2)..."
  ./gradlew publishToMavenLocal \
    -PmavenCentralUsername="${PAYCRAFT_MAVEN_CENTRAL_USERNAME:-}" \
    -PmavenCentralPassword="${PAYCRAFT_MAVEN_CENTRAL_PASSWORD:-}" \
    -PsigningInMemoryKeyId="${PAYCRAFT_SIGNING_KEY_ID:-}" \
    -PsigningInMemoryKeyPassword="${PAYCRAFT_SIGNING_PASSWORD:-}" \
    -PsigningInMemoryKey="${PAYCRAFT_GPG_KEY_CONTENTS:-}" \
    --quiet
  echo "✅  Published to ~/.m2 — artifact: io.github.mobilebytelabs:paycraft:$VERSION"
else
  echo "▶  [5/5] Skipping local Maven (use --local-maven to enable)"
fi

# ── Tag and push ─────────────────────────────────────────────────────────────
echo ""
echo "▶  Creating tag $TAG..."
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
echo "║  https://github.com/MobileByteLabs/KmpToolkit/actions"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
