import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
  beforeSend(event) {
    // Strip PII — mask email to first char + domain
    if (event.user?.email) {
      event.user.email = event.user.email.replace(/^(.).*@/, "$1***@")
    }
    return event
  },
})
