# PayCraft → Maven Central Publish Setup

> Phase 5 T1 of paycraft-v2-production-readiness — one-time Sonatype Central
> Portal setup so `./gradlew publishToMavenCentral` from the cmp-paycraft
> module lands `io.github.mobilebytelabs:cmp-paycraft:2.0.0` to Maven Central.

**Window:** 1-2 hours (mostly waiting for Sonatype to verify the namespace)
**Blocker classification:** Phase 5 acceptance gate — no Maven publish, no SDK adoption.

---

## Pre-flight

- [ ] You have admin access to the `io.github.mobilebytelabs` GitHub org. Sonatype
  uses namespace ownership of `io.github.<your-org>` as the verification anchor.
- [ ] GPG installed locally (`gpg --version`).
- [ ] PayCraft build config already has vanniktech-mavenPublish wired —
  verified at `cmp-paycraft/build.gradle.kts` (lines 128-159).
- [ ] You're running this once on the founder workstation; this is NOT a
  per-deploy operation. After setup, the publish runs in CI.

---

## Step 1 — Register on Central Portal (≤ 10 min)

1. Visit `https://central.sonatype.com/account` and sign up.
2. Generate a **User Token** (gear icon → "Generate User Token"). Save:
   - `username` (alphanumeric, ~20 chars)
   - `password` (~32-char token)
3. Verify the namespace `io.github.mobilebytelabs`:
   - Open `https://central.sonatype.com/publishing/namespaces`
   - Click "Add Namespace"
   - Enter `io.github.mobilebytelabs`
   - Sonatype issues a challenge: create a GitHub repo named
     `<random-hash>` under the `MobileByteLabs` org. Empty repo is fine.
   - Wait ≤ 5 min, refresh the namespace list — status flips to VERIFIED.
   - Delete the challenge repo.

---

## Step 2 — Generate a GPG signing key (≤ 5 min)

Maven Central requires every artifact be GPG-signed.

```bash
# Generate a new key (RSA 4096, no expiry — rotate manually)
gpg --batch --gen-key <<EOF
%no-protection
Key-Type: RSA
Key-Length: 4096
Subject-Type: RSA
Subject-Length: 4096
Name-Real: PayCraft Release Signing
Name-Email: releases@paycraft.mobilebytesensei.com
Expire-Date: 0
EOF

# List + grab the key ID
gpg --list-secret-keys --keyid-format=long
# Look for: sec   rsa4096/<KEYID> 2026-…
#                       ^^^^^^^^^

# Export the public key + push to the 3 default keyservers
KEYID=<the-16-char-hex-id>
gpg --armor --export "$KEYID" > paycraft-pgp-public.asc
gpg --keyserver hkp://keys.openpgp.org --send-keys "$KEYID"
gpg --keyserver hkp://keyserver.ubuntu.com --send-keys "$KEYID"
gpg --keyserver hkp://pgp.mit.edu --send-keys "$KEYID"

# Export the secret key for vault + CI use
gpg --armor --export-secret-keys "$KEYID" > paycraft-pgp-secret.asc
```

> ⚠ Never commit `paycraft-pgp-secret.asc`. Delete after you push to the vault.

---

## Step 3 — Push credentials to vault (zero-chat-secret path)

Per RULE-SECRETS-MACOS-001 (Pattern 5):

```bash
FW_ROOT=/Users/therajanmaurya/project-development/claude-product-cycle

# Stage Sonatype creds in Keychain (secure interactive prompts)
bash $FW_ROOT/core/scripts/secrets-keychain-load.sh \
     --init paycraft-sonatype username:SONATYPE_USERNAME
bash $FW_ROOT/core/scripts/secrets-keychain-load.sh \
     --init paycraft-sonatype password:SONATYPE_PASSWORD

# Stage GPG key + key ID + passphrase (passphrase blank if --no-protection used)
bash $FW_ROOT/core/scripts/secrets-keychain-load.sh \
     --init paycraft-sonatype gpg-key-id:GPG_KEY_ID
# GPG secret key — load via file (not paste; the multi-line ASCII would mangle)
security add-generic-password \
  -s paycraft-sonatype \
  -a gpg-secret-key \
  -w "$(cat paycraft-pgp-secret.asc)"

# Push each to vault
for k in username password gpg-key-id gpg-secret-key; do
    security find-generic-password -s paycraft-sonatype -a "$k" -w \
      | bash $FW_ROOT/core/scripts/secrets-push.sh \
             --vault mbs \
             --id paycraft-sonatype-${k} \
             --stdin
done

# Wipe the secret file
shred -u paycraft-pgp-secret.asc 2>/dev/null || rm -f paycraft-pgp-secret.asc
```

Push the 3 corresponding GitHub Actions secrets (one-time):

```bash
gh secret set SONATYPE_USERNAME --body "$(bash $FW_ROOT/core/scripts/secrets-get.sh paycraft-sonatype-username --allow-claude-stdout)"
gh secret set SONATYPE_PASSWORD --body "$(bash $FW_ROOT/core/scripts/secrets-get.sh paycraft-sonatype-password --allow-claude-stdout)"
gh secret set GPG_KEY_ID        --body "$(bash $FW_ROOT/core/scripts/secrets-get.sh paycraft-sonatype-gpg-key-id --allow-claude-stdout)"
gh secret set GPG_SECRET_KEY    --body "$(bash $FW_ROOT/core/scripts/secrets-get.sh paycraft-sonatype-gpg-secret-key --allow-claude-stdout)"
```

---

## Step 4 — Smoke test a local publish (≤ 5 min)

Publish to a local Maven repo first to validate the gradle config end-to-end
without touching Central:

```bash
cd workspaces/mbs/PayCraft/source/PayCraft

# Materialize SONATYPE_USERNAME etc into the gradle env
export SONATYPE_USERNAME=$(bash core/scripts/secrets-get.sh paycraft-sonatype-username --allow-claude-stdout)
export SONATYPE_PASSWORD=$(bash core/scripts/secrets-get.sh paycraft-sonatype-password --allow-claude-stdout)
export ORG_GRADLE_PROJECT_signingInMemoryKeyId=$(bash core/scripts/secrets-get.sh paycraft-sonatype-gpg-key-id --allow-claude-stdout)
export ORG_GRADLE_PROJECT_signingInMemoryKey=$(bash core/scripts/secrets-get.sh paycraft-sonatype-gpg-secret-key --allow-claude-stdout)
export ORG_GRADLE_PROJECT_signingInMemoryKeyPassword=""

# Local maven publish
./gradlew :cmp-paycraft:publishToMavenLocal

# Verify the artifact landed
ls ~/.m2/repository/io/github/mobilebytelabs/cmp-paycraft/2.0.0/
# Expected: cmp-paycraft-2.0.0.jar, cmp-paycraft-2.0.0.pom, *.module, plus
# .asc signatures alongside each.
```

---

## Step 5 — Real publish to Maven Central (production)

After the smoke test passes, push the `v2.0.0` tag — the publish workflow
(`.github/workflows/publish.yml`) handles the rest:

```bash
# Bump VERSION (already 2.0.0 at gradle.properties#paycraft.version)
git tag -a v2.0.0 -m "PayCraft v2.0 — multi-tenant SaaS launch"
git push origin v2.0.0
```

The workflow:

1. Checks out `v2.0.0`
2. Decodes `GPG_SECRET_KEY` into the runner's gnupg ring
3. Runs `./gradlew publishAndReleaseToMavenCentral --no-configuration-cache`
4. Polls `https://central.sonatype.com/api/v1/publisher/status/<deployment-id>`
   until status flips to `VALIDATED` (≤ 15 min) or `FAILED`
5. On success: closes the staging repo, releases it to Central
6. Artifact appears on `https://central.sonatype.com/artifact/io.github.mobilebytelabs/cmp-paycraft/2.0.0`
   within ~ 30 min of release.

---

## Step 6 — Verify the artifact (≤ 30 min later)

```bash
# Maven Central indexer is async; expect ≤ 30 min between release and visibility
curl -sI "https://repo1.maven.org/maven2/io/github/mobilebytelabs/cmp-paycraft/2.0.0/cmp-paycraft-2.0.0.pom" \
  | head -1
# Expected: HTTP/2 200

# Pull from a fresh project as a smoke test
mkdir -p /tmp/paycraft-pull-test && cd /tmp/paycraft-pull-test
cat > build.gradle.kts <<'EOF'
plugins { kotlin("jvm") version "2.0.0" }
repositories { mavenCentral() }
dependencies { implementation("io.github.mobilebytelabs:cmp-paycraft:2.0.0") }
EOF
gradle build --offline 2>&1 | grep -i "could not resolve" && echo "✗ NOT YET INDEXED" || echo "✓ Indexed."
```

---

## What goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `Insufficient permissions to publish to staging` | User Token lacks scope | Re-generate token with `central.sonatype.org/publishing` scope |
| `No public key for namespace io.github.mobilebytelabs` | Key not on default keyservers | Re-run `gpg --send-keys` to all 3 keyservers; wait 15 min |
| Validation FAILED — `pom.xml missing SCM` | SCM url empty | Fixed already in `cmp-paycraft/build.gradle.kts` mavenPublishing.pom.scm block |
| Validation FAILED — `signatures invalid` | GPG key passphrase mismatch in CI | Ensure `ORG_GRADLE_PROJECT_signingInMemoryKeyPassword` matches actual passphrase (likely empty in our setup) |

---

## After publish lands

- [ ] reels-downloader PR (`feat/paycraft-2.0.0-bump`) becomes mergeable —
  the Gradle build resolves `cmp-paycraft:2.0.0` from Central
- [ ] cmp-paycraft/README.md Maven badge populates with 2.0.0
- [ ] Run S16 scenario in reels-downloader's `paycraft-matrix.yaml` end-to-end

---

## Related

- `cmp-paycraft/build.gradle.kts` lines 128-159 — vanniktech config
- `gradle.properties#paycraft.version` — single version source
- `gradle/libs.versions.toml#vanniktech-mavenPublish` — plugin version
- `GOAL.md` AC43-AC47 — Phase 5 acceptance criteria
