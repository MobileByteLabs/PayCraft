#!/bin/sh

# Pre-push hook — runs quick verification before push
# Full verification: ./scripts/verify.sh --full

cd "$(git rev-parse --show-toplevel)"

echo ""
echo "Pre-push: running checks..."
echo ""

echo "[1/3] Spotless check..."
if ! ./gradlew spotlessCheck --daemon -q 2>/dev/null; then
    echo "Formatting issues. Run: ./scripts/verify.sh --fix"
    exit 1
fi
echo "  PASS spotlessCheck"

echo "[2/3] Detekt..."
if ! ./gradlew detekt --daemon -q 2>/dev/null; then
    echo "Detekt issues. Run: ./scripts/verify.sh"
    exit 1
fi
echo "  PASS detekt"

echo "[3/3] JVM tests..."
if ! ./gradlew :cmp-paycraft:jvmTest --daemon -q 2>/dev/null; then
    echo "Tests failed. Run: ./scripts/verify.sh"
    exit 1
fi
echo "  PASS jvmTest"

echo ""
echo "All pre-push checks passed."
echo ""
exit 0
