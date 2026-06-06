import { redirect } from "next/navigation"

// Signup and login are the same Google OAuth flow.
// New users are auto-provisioned in the callback on first sign-in.
export default function SignUpPage() {
  redirect("/auth/login")
}
