import { createBrowserClient } from "@supabase/ssr"
import { supabaseCookieOptions } from "@/lib/supabase-cookie"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: supabaseCookieOptions },
  )
}
