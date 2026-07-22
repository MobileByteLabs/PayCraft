// supabase/scripts/consolidate-backend-sot.ts
//
// D11 / AC11: supabase/migrations is the single source of truth; the parallel server/ path must
// never hold a divergent migration set. Historically this repo shipped the INVERSE alias —
// supabase/migrations was a symlink → ../server/migrations, with the real directory under
// server/migrations. Either way, this consolidator normalizes to ONE invariant and is idempotent:
//
//   INVARIANT: supabase/migrations is a REAL directory (the SoT); server/migrations is a symlink
//              → ../supabase/migrations. `supabase start` reads supabase/migrations either way.
//
// Run:  deno run --allow-read --allow-write supabase/scripts/consolidate-backend-sot.ts

import { existsSync } from "https://deno.land/std@0.208.0/fs/mod.ts";

const REPO = new URL("../../", import.meta.url).pathname; // → PayCraft/
const supaMig = `${REPO}supabase/migrations`;
const serverMig = `${REPO}server/migrations`;
const archive = `${REPO}server/_archived_migrations_pre_v2.1`;

function isSymlink(path: string): boolean {
  try {
    return Deno.lstatSync(path).isSymlink;
  } catch {
    return false;
  }
}
function isRealDir(path: string): boolean {
  try {
    const st = Deno.lstatSync(path);
    return st.isDirectory && !st.isSymlink;
  } catch {
    return false;
  }
}

// 1. Promote the SoT: if supabase/migrations is a legacy symlink alias, replace it with the real
//    directory it points at, so supabase/migrations becomes the physical single source of truth.
if (isSymlink(supaMig)) {
  const realTarget = Deno.realPathSync(supaMig); // the physical dir (legacy: server/migrations)
  Deno.removeSync(supaMig); // drop the alias symlink
  if (realTarget !== supaMig && existsSync(realTarget)) {
    Deno.renameSync(realTarget, supaMig); // promote the real dir into the SoT location
    console.log(`promoted ${realTarget} → supabase/migrations (single SoT)`);
  }
}
if (!isRealDir(supaMig)) {
  throw new Error(
    "consolidate: supabase/migrations is not a real directory after normalization — aborting to avoid data loss",
  );
}

// 2. Reconcile server/migrations to a symlink at the SoT. Archive a real divergent copy once.
if (isRealDir(serverMig)) {
  if (!existsSync(archive)) {
    Deno.renameSync(serverMig, archive);
    console.log(`archived divergent server/migrations → ${archive}`);
  } else {
    Deno.removeSync(serverMig, { recursive: true });
  }
} else if (isSymlink(serverMig)) {
  // Already a symlink — leave it untouched if it already targets the SoT; otherwise re-point.
  if (Deno.readLinkSync(serverMig) !== "../supabase/migrations") {
    Deno.removeSync(serverMig);
  }
}
if (!existsSync(serverMig) && !isSymlink(serverMig)) {
  Deno.symlinkSync("../supabase/migrations", serverMig);
  console.log("linked server/migrations → ../supabase/migrations");
}

console.log("server/migrations now points at the single SoT (supabase/migrations).");
