import { AlertTriangle, ArrowUpRight, Users } from "lucide-react"
import { clsx } from "clsx"
import { ButtonLink } from "@/components/ui/button"

export interface GraceState {
  graceStartedAt: string | null
  warnedAt: string | null
  active: number
  limit: number | null
}

/** The free-tier grace / warn banner. Data comes from the server layout (GraceBanner) or the Vite shell. */
export function GraceBannerView({ graceStartedAt, warnedAt, active, limit }: GraceState) {
  // AC-44 contract — banner ONLY appears in grace OR warn state.
  if (!graceStartedAt && !warnedAt) return null


  // Render: grace takes precedence over warn (both can be set after a
  // tenant crosses 80% then 100% — show the more urgent one).
  if (graceStartedAt) {
    const elapsedMs = Date.now() - new Date(graceStartedAt).getTime()
    const elapsedDays = Math.floor(elapsedMs / 86_400_000)
    const daysRemaining = Math.max(0, 7 - elapsedDays)
    const lockingSoon = daysRemaining <= 2

    return (
      <div
        role="alert"
        className={clsx(
          "sticky top-0 z-40 border-b px-6 py-3 flex items-center justify-between gap-4 backdrop-blur",
          lockingSoon
            ? "bg-danger-50/95 border-danger-200"
            : "bg-warning-50/95 border-warning-200",
        )}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={clsx(
              "w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0",
              lockingSoon
                ? "bg-danger-100 text-danger-700"
                : "bg-warning-100 text-warning-700",
            )}
          >
            <AlertTriangle className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div
              className={clsx(
                "text-sm font-semibold truncate",
                lockingSoon ? "text-danger-700" : "text-warning-700",
              )}
            >
              {daysRemaining === 0
                ? "Subscriber cap reached — new device registrations will be refused after today."
                : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} until features lock`}
            </div>
            <div
              className={clsx(
                "text-xs mt-0.5 tabular-nums",
                lockingSoon ? "text-danger-600" : "text-warning-600",
              )}
            >
              {active.toLocaleString()} / {limit?.toLocaleString() ?? "?"} subscribers
              {" · "}
              Upgrade to Pro to keep accepting new subscribers.
            </div>
          </div>
        </div>
        <ButtonLink
          href="/billing/upgrade"
          size="sm"
          variant={lockingSoon ? "primary" : "secondary"}
          trailing={<ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2.5} />}
        >
          Upgrade
        </ButtonLink>
      </div>
    )
  }

  // warnedAt branch — 80% threshold crossed, not yet over limit.
  return (
    <div
      role="status"
      className="sticky top-0 z-40 border-b border-warning-200 bg-warning-50/95 px-6 py-3 flex items-center justify-between gap-4 backdrop-blur"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-8 h-8 rounded-md bg-warning-100 text-warning-700 flex items-center justify-center flex-shrink-0">
          <Users className="w-4 h-4" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-warning-700 truncate">
            You&apos;re approaching your Free tier subscriber limit
          </div>
          <div className="text-xs text-warning-600 mt-0.5 tabular-nums">
            {active.toLocaleString()} / {limit?.toLocaleString() ?? "?"} subscribers
            {" · "}
            At 100% you enter a 7-day grace period before new registrations are refused.
          </div>
        </div>
      </div>
      <ButtonLink
        href="/billing/upgrade"
        size="sm"
        variant="secondary"
        trailing={<ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2.5} />}
      >
        Upgrade
      </ButtonLink>
    </div>
  )
}
