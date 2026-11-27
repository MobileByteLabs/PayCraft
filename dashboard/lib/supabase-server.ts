import { createServerClient } from "@supabase/ssr"
import { supabaseCookieOptions } from "@/lib/supabase-cookie"
import { cookies } from "next/headers"

// Stays synchronous for its ~70 callers: Next 16's cookies() is a Promise, and @supabase/ssr accepts async
// cookie handlers, so the store is awaited inside them.
export function createClient() {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: supabaseCookieOptions,
      cookies: {
        async getAll() {
          return (await cookieStore).getAll()
        },
        async setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            const store = await cookieStore
            cookiesToSet.forEach(({ name, value, options }) =>
              store.set(name, value, options)
            )
          } catch {
            // Server Component — can't set cookies
          }
        },
      },
    }
  )
}
