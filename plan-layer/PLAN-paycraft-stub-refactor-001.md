# PLAN-paycraft-stub-refactor-001 — Stub Architecture + Memory System + 100% Success

> **Scope**: PayCraft repo (`https://github.com/MobileByteLabs/PayCraft`)
> **Status**: ⬜ Pending
> **Created**: 2026-04-26
> **Updated**: 2026-04-26 (v3: gap-fill + R4 100% success rate)
> **Framework plan**: `plan-layer/plans/PLAN-paycraft-260426-093549.md`

---

## Vision

PayCraft is a living library adopted by new KMP apps to add billing. Every `/paycraft-adopt` run must:
- Know what has already been done (`.paycraft/memory.json`)
- Pick up precisely where it left off
- Accumulate context over time — Koin file, billing card screen, ENV path, deployed resources
- Never re-ask questions already answered
- **Connect with Supabase and Stripe with 100% success — zero trial and error**

The `.paycraft/` directory in the consumer app IS the memory. It is versioned with the app, migrated automatically as PayCraft evolves, and is the single source of truth for "what PayCraft has done in this project."

---

## Four Requirements

### R1 — `.paycraft/memory.json` — Implementation Memory

```
.paycraft/
├── config.json
├── deployment.json
├── memory.json          ← file paths, phase state, PayCraft version, user confirmations
├── schema_version       ← PayCraft version this .paycraft was created with
├── supabase/
│   ├── migrations/
│   └── functions/
├── test_results/
│   ├── sandbox_test.json
│   └── live_test.json
└── backups/             ← gitignored
```

Atomic writes (tmp → rename). Read before every run. Never re-ask answered questions.

### R2 — `.env` Location UX

Phase 1, first run: show picker (project root / workspace root / custom). Write `env_path` to memory. CI bypass. Auto-add to `.gitignore`.

### R3 — Koin + Billing Card Location (Phase 4)

Detect on first run, confirm, write to memory. Skip on subsequent runs (show "remembered" + offer to change).

### R4 — 100% Supabase + Stripe Connection Success

- Per-key validation at collection: format + prefix + length checks
- Inline "where to get it" guide for every key (dashboard URLs, exact field names)
- Pre-flight gate before each phase (keys present + API reachable)
- Post-phase verification (prove it worked — table exists, RPC callable, webhook ACTIVE)
- Idempotency: skip already-applied migrations, skip already-created Stripe products
- Sandbox E2E: 7-step test with 30s webhook timeout + exact diagnosis on failure
- Atomic memory.json writes: `.tmp` → rename

---

## Gitignore Rules for `.paycraft/`

```gitignore
# Add to consumer app's .gitignore:
.paycraft/backups/
.paycraft/exports/

# Safe to commit:
.paycraft/config.json
.paycraft/deployment.json
.paycraft/memory.json
.paycraft/schema_version
.paycraft/supabase/
.paycraft/test_results/
```

---

## Changes in This Repo

### DELETE from `client-skills/` (7 files)

`paycraft-adopt-env.md`, `paycraft-adopt-supabase.md`, `paycraft-adopt-stripe.md`,
`paycraft-adopt-razorpay.md`, `paycraft-adopt-client.md`, `paycraft-adopt-verify.md`,
`paycraft-adopt-migrate.md`

### EDIT stubs (E-tasks)

| File | Change |
|------|--------|
| `client-skills/paycraft-adopt.md` | Add canonical header comment |
| `client-skills/README.md` | Document one-stub pattern + `.paycraft/` layout |

### EDIT phase runtime files (E + M + S tasks)

| File | Changes |
|------|---------|
| `layers/paycraft/commands/paycraft-adopt.md` | Read memory.json; remove sub-commands section; M1/M2/M4/M9 |
| `layers/paycraft/commands/paycraft-adopt-env.md` | .paycraft/ init (M1a); .env picker UX (M5); gitignore (M6/M10); per-key validation (S1/S2); atomic memory write (M3a); remove sub-cmd ref (E5) |
| `layers/paycraft/commands/paycraft-adopt-supabase.md` | Pre-flight gate (S3); idempotency (S5); post-phase verify (S4); atomic memory write (M3b); remove sub-cmd ref (E6) |
| `layers/paycraft/commands/paycraft-adopt-stripe.md` | Pre-flight gate (S6); idempotency (S8); post-phase verify (S7); atomic memory write (M3c); remove sub-cmd ref (E9) |
| `layers/paycraft/commands/paycraft-adopt-client.md` | Memory read + skip (M7/M8); Koin/billing prompts (R3); atomic memory write (M3d); remove sub-cmd refs (E7) |
| `layers/paycraft/commands/paycraft-adopt-verify.md` | Fix test results path (M12); sandbox 7-step E2E (S9); atomic memory write (M3e); remove sub-cmd refs (E8) |

---

## Consumer Flow (after this plan)

```
Run 1 (fresh install):
  /paycraft-adopt
    → stub bootstraps PayCraft location
    → runtime: no memory.json → show empty matrix → [A] Full setup
    → Phase 1: show .env picker → validate each key (format + reachability)
               → init .paycraft/ dirs + schema_version
               → write memory.json {env_path}
    → Phase 2: pre-flight check → deploy Supabase → post-phase verify
               → write memory.json {supabase_project_ref}
    → Phase 3: pre-flight check → create Stripe products/links → post-phase verify
               → write memory.json {payment_links}
    → Phase 4: detect Koin + billing screen → confirm → write memory.json
    → Phase 5B: 7-step sandbox E2E → write test_results/sandbox_test.json
    → .paycraft/memory.json: full context, all phases verified

Run 2+ (any future run):
  /paycraft-adopt
    → stub bootstraps
    → runtime: reads memory.json → knows env_path, koin file, billing screen
    → shows matrix with remembered + live-scanned state
    → no repeated questions — straight to action menu
    → [B] Sandbox or [C] Live or [Q] Done
```

---

## Task Checklist

**Delete (D):**
- [x] D1–D7: Delete 7 sub-command stubs from `client-skills/`

**Stub + index edits (E):**
- [x] E1: Add header comment to `client-skills/paycraft-adopt.md`
- [x] E2: (framework — done in framework plan)
- [x] E3: Remove "Sub-commands" section from main runtime
- [x] E4: (framework — done in framework plan)
- [x] E5: Remove sub-cmd ref from `paycraft-adopt-env.md`
- [x] E6: Remove sub-cmd ref from `paycraft-adopt-supabase.md`
- [x] E7: Remove sub-cmd refs from `paycraft-adopt-client.md`
- [x] E8: Remove sub-cmd refs from `paycraft-adopt-verify.md`
- [x] E9: Remove sub-cmd ref from `paycraft-adopt-stripe.md`

**Memory system (M):**
- [x] M1: Define memory.json schema in runtime
- [x] M1a: `.paycraft/` init in Phase 1 (mkdir + schema_version)
- [x] M2: READ memory.json before status matrix
- [x] M3a: Atomic WRITE in Phase 1 (env_path + paycraft_version)
- [x] M3b: Atomic WRITE in Phase 2 (supabase_project_ref)
- [x] M3c: Atomic WRITE in Phase 3 (stripe_product_id + payment_links)
- [x] M3d: Atomic WRITE in Phase 4 (koin + billing + lifecycle paths)
- [x] M3e: Atomic WRITE in Phase 5 (phases_verified)
- [x] M4: Schema migration logic (version mismatch → prompt)
- [x] M5: .env picker UX in Phase 1 + CI bypass
- [x] M6: .gitignore auto-check + auto-add
- [x] M7: Phase 4 memory read → skip Koin detection if remembered
- [x] M8: Phase 4 memory read → skip billing screen detection if remembered
- [x] M9: Status matrix reads memory.json to pre-fill [✓ remembered] rows
- [x] M10: .paycraft/backups/ + exports/ to {TARGET_APP_PATH}/.gitignore
- [x] M11: Document .paycraft/ in `client-skills/README.md`
- [x] M12: Fix test results path → `.paycraft/test_results/`

**100% success (S):**
- [x] S1: Per-key validation at collection (7 keys, format/prefix/length)
- [x] S2: Inline "where to get it" guide for every key (inline in Phase 1 steps)
- [x] S3: Pre-flight gate for Phase 2 (Supabase keys + reachability)
- [x] S4: Post-phase verify for Phase 2 (table, RPCs, webhook)
- [x] S5: Phase 2 migration idempotency
- [x] S6: Pre-flight gate for Phase 3 (Stripe keys + API reachable)
- [x] S7: Post-phase verify for Phase 3 (product, prices, payment links)
- [x] S8: Phase 3 Stripe idempotency (already existed, confirmed)
- [x] S9: Phase 5B 7-step E2E with webhook diagnosis on failure
- [x] S10: Atomic write pattern in ALL phase files (.tmp → rename)

**Verify:**
- [x] V1: `client-skills/` contains only `paycraft-adopt.md` + `README.md` + legacy files
- [x] V6: No user-facing sub-command references (verified with grep)
- [x] V7: memory.json schema documented in runtime; atomic read/write hooks in all 5 phases
- [x] V8: .env picker UX in Phase 1 with gitignore auto-add + CI bypass
- [x] V9: Koin + billing card location prompts in Phase 4 with memory read/skip/write
- [x] V10: All 7 PAYCRAFT_* keys validated at collection with inline how-to guide
- [x] V11: Post-phase verification steps in Phase 2 + 3 + 5
- [x] V12: Sandbox E2E test has webhook diagnosis on failure
- [ ] V13: Commit + PR against `development` on `MobileByteLabs/PayCraft`
