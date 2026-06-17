# PayCraft v2.0 Launch Operations Checklist

## T-7 days

- [ ] Final security audit — run paycraft.mobilebytesensei.com through https://securityheaders.com (target A+)
- [ ] Verify Cloudflare DNSSEC is enabled on paycraft.mobilebytesensei.com
- [ ] Confirm Sentry is receiving events (trigger a test exception in staging)
- [ ] Confirm BetterStack uptime monitors are green for 7-day window
- [ ] Run `./gradlew :cmp-paycraft:jvmTest` — all tests pass
- [ ] Test full signup → upgrade → cancel → downgrade flow on production
- [ ] Verify all 6 Postmark email templates send correctly (welcome, invite, limit-warn, limit-hit, webhook-fail, sub-expiry)
- [ ] Check Maven Central publish dry-run (staging deploy, do not promote yet)

## T-3 days

- [ ] Maven Central — tag v2.0.0, push tag, confirm workflow triggers and staging deploy succeeds
- [ ] Promote v2.0.0 from Sonatype staging to Central (https://central.sonatype.com → Publish)
- [ ] Verify `implementation("io.github.mobilebytelabs:cmp-paycraft:2.0.0")` resolves in a fresh project
- [ ] Create `MobileByteLabs/paycraft-sample-cloud` GitHub repo (set to public)
- [ ] Push sample-cloud content to the new repo
- [ ] Verify `./gradlew composeApp:assembleDebug` passes in the sample repo against production paycraft.mobilebytesensei.com
- [ ] Draft announcement copy reviewed and finalized (infra/launch/announcement.md)
- [ ] Product Hunt: schedule submission slot (09:00 UTC on launch day)
- [ ] Set up Hacker News Show HN draft

## T-1 day

- [ ] Final smoke test on production paycraft.mobilebytesensei.com — signup → dashboard → API key → sample app run
- [ ] Verify all email templates work end-to-end (send a real test email to rajanmaurya154@gmail.com)
- [ ] Confirm BetterStack monitors show 0 incidents in last 48h
- [ ] Check Sentry — 0 unresolved issues
- [ ] Pre-load Product Hunt account (product submissions require 3-day-old account)
- [ ] Update paycraft.mobilebytesensei.com homepage CTA to point to sample repo + demo video (if recorded)
- [ ] Prepare CHANGELOG.md v2.0.0 section (final date fill-in)

## T-0 (launch day)

| Time (UTC) | Action |
|---|---|
| 09:00 | Toggle paycraft.mobilebytesensei.com from "coming soon" to live (env var `MAINTENANCE_MODE=false`) |
| 09:10 | Run final acceptance smoke test (curl paycraft.mobilebytesensei.com + paycraft.mobilebytesensei.com/pricing + paycraft.mobilebytesensei.com/docs/quickstart-cloud) |
| 09:15 | Submit Product Hunt listing (24h window starts) |
| 09:30 | Post Show HN submission |
| 10:00 | Twitter / X thread (all 7 tweets scheduled and fired) |
| 10:30 | LinkedIn post |
| 11:00 | r/Kotlin post |
| 11:15 | r/androiddev post |
| 11:30 | Indie Hackers post |
| Hourly | Check Sentry + BetterStack uptime + signup volume |

## T+1

- [ ] Respond to Product Hunt comments
- [ ] Respond to Hacker News thread
- [ ] Log first-day questions → update FAQ in docs
- [ ] Email digest to support@paycraft.mobilebytesensei.com (first 24h support load triage)

## T+7

- [ ] Post-launch retro — what drove signups, what caused support tickets
- [ ] Adjust pricing tiers if signup → paid conversion < 2% target
- [ ] Prioritize roadmap items based on first-week feedback
- [ ] Post-launch blog post: "What we shipped in PayCraft v2.0"
