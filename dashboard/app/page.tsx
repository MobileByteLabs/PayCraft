import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase-server"

export default async function Home() {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (session) {
    redirect("/subscribers")
  } else {
    redirect("/auth/login")
  }
}
