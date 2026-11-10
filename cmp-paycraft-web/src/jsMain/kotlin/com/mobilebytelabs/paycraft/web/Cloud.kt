package com.mobilebytelabs.paycraft.web

// PayCraft Cloud — the SAME constants the app SDK uses (cmp-paycraft PayCraftBackend.kt
// CLOUD_SUPABASE_URL / CLOUD_SUPABASE_ANON_KEY), so `new PayCraftWeb(apiKey)` reaches the same
// backend as `PayCraft.initialize(apiKey)`. The anon key is public by design (RLS protects the data);
// it ships in every app binary. Keep these two in step with PayCraftBackend.kt.

internal const val CLOUD_SUPABASE_URL: String = "https://mlwfgytjxlqyfxcgpysm.supabase.co"

internal const val CLOUD_SUPABASE_ANON_KEY: String =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sd2ZneXR" +
        "qeGxxeWZ4Y2dweXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MTk0ODUsImV4cCI6MjA5MjQ5NTQ" +
        "4NX0.q1L5IyffiRObM85yxBK5BFRFsTjObzUeQSCJB96WM1s"
