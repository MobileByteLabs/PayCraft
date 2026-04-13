# /release-paycraft — Release PayCraft to Maven Central

Runs the full quality gate, creates a git tag, pushes to GitHub, and opens a PR.

## Steps

### Step 1: Confirm version

Read current version from `cmp-library/build.gradle.kts`:
```bash
grep -E '^version\s*=' cmp-library/build.gradle.kts | head -1
```

Ask user:
> Current version is **X.Y.Z**. Release this version, or bump?
> [Release X.Y.Z] [Bump patch → X.Y.Z+1] [Bump minor → X.Y+1.0] [Bump major → X+1.0.0]

If bump chosen, update version in `cmp-library/build.gradle.kts` and commit:
```bash
# After editing build.gradle.kts:
git add cmp-library/build.gradle.kts
git commit -m "chore(release): bump version to X.Y.Z"
```

### Step 2: Run release script

```bash
chmod +x scripts/release.sh
./scripts/release.sh --dry-run
```

If dry run passes, ask:
> ✅ All checks passed (spotless, detekt, tests, build). Push tag v{VERSION}?
> [Yes, release] [Cancel]

On confirm:
```bash
./scripts/release.sh
```

The script will:
- Re-run spotless, detekt, jvmTest, assemble
- Create git tag `v{VERSION}`
- Push the tag → triggers `release.yml` → creates GitHub Release → triggers `publish.yml` → Maven Central

### Step 3: Create PR (if on feature branch)

Check current branch:
```bash
git branch --show-current
```

If not on `main`:
```bash
gh pr create \
  --title "chore(release): PayCraft v{VERSION}" \
  --body "$(cat <<'EOF'
## PayCraft v{VERSION}

### Release checklist
- [x] All quality checks passed (spotless, detekt, tests)
- [x] Git tag `v{VERSION}` pushed
- [x] GitHub Release created automatically by `release.yml`
- [x] Maven Central publish triggered by `publish.yml`

### What's in this release
{CHANGELOG — summarize commits since last tag}

### Maven Central
Available at `io.github.mobilebytelabs:paycraft:{VERSION}` within ~10 minutes of merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
  --base main
```

Show PR URL to user.

### Step 4: Report

```
╔═══════════════════════════════════════════════════╗
║  ✅  PayCraft v{VERSION} release initiated!       ║
╠═══════════════════════════════════════════════════╣
║  Tag:     v{VERSION} pushed                       ║
║  PR:      {PR_URL}                                ║
║  Actions: https://github.com/MobileByteLabs/      ║
║           PayCraft/actions                        ║
╠═══════════════════════════════════════════════════╣
║  Pipeline:                                        ║
║  release.yml  → quality gate + GitHub Release     ║
║  publish.yml  → Maven Central (~10 min)           ║
╚═══════════════════════════════════════════════════╝
```
