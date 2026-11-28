"use client"

// The Paywall pages' data, read in the browser (TanStack Query; RLS scopes every read to the signed-in admin).
// The editors themselves are unchanged: they take their initial state once the reads land, and invalidate the
// shared `["paywall", tenantId]` cache after a save so a revisit never opens a stale draft.

import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { LoadError, LoadingCard, useTenantRow } from "@/components/query-ui"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { PaywallDesigner } from "@/components/paywall/paywall-designer"
import { PaywallTreeEditor } from "@/components/paywall/tree/PaywallTreeEditor"
import type { Json } from "@/components/paywall/tree/edit"
import { type EditorCoupon, ExitSurveyEditor } from "@/components/paywall/exit-survey-editor"
import { type EditorCoupon as ExperimentCoupon, type EditorOffering, ExperimentsEditor } from "@/components/paywall/experiments-editor"
import { TemplateGallery, type GalleryTemplate } from "@/components/paywall/template-gallery"
import { DEFAULT_REASONS, type SurveyDraft } from "@/lib/exit-survey-config"
import type { Experiment } from "@/lib/experiments"

type PaywallRow = {
  workflow?: Json | null
  published_workflow?: Json | null
  revision?: number | null
  published_revision?: number | null
  [k: string]: unknown
}

/** `tenant_paywall_get` — shared by the designer, the tree editor and the template gallery. */
function usePaywallRow() {
  const { tenantId, supabase } = useDashboard()
  return useQuery({
    queryKey: ["paywall", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tenant_paywall_get", { p_tenant_id: tenantId })
      if (error) throw new Error(error.message)
      return (data ?? null) as PaywallRow | null
    },
  })
}

function useInvalidatePaywall() {
  const { tenantId } = useDashboard()
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ["paywall", tenantId] })
}

const linkClass =
  "inline-flex items-center gap-2 rounded-md border border-ink-300 px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"

// ── /paywall ─────────────────────────────────────────────────────────────────

export function PaywallView() {
  const { tenantId, supabase } = useDashboard()
  const tenantQuery = useTenantRow()
  const plan = tenantQuery.data?.plan ?? null
  const paywallQuery = usePaywallRow()
  const tierQuery = useQuery({
    queryKey: ["tier", plan, "entitlements,attribution_required"],
    enabled: !!plan,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tier_definitions")
        .select("entitlements,attribution_required")
        .eq("tier_name", plan!)
        .single()
      if (error) throw new Error(error.message)
      return data as { entitlements: unknown; attribution_required: boolean | null }
    },
  })
  const productsQuery = useQuery({
    queryKey: ["products", "paywall", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_products")
        .select(
          "id,sku,type,display_name,interval,base_price_cents,base_currency,display_order,trial_duration_days,attaches_to_product_id",
        )
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("display_order")
      if (error) throw new Error(error.message)
      return data ?? []
    },
  })
  const invalidate = useInvalidatePaywall()

  // The tier read only gates "remove attribution"; a failed read leaves it off, as the server page did.
  const queries = [tenantQuery, paywallQuery, productsQuery]
  const failed = queries.find((q) => q.isError)
  const pending = queries.some((q) => q.isPending) || (tierQuery.isPending && tierQuery.fetchStatus !== "idle")

  const canRemoveAttribution =
    Array.isArray(tierQuery.data?.entitlements) &&
    (tierQuery.data!.entitlements as string[]).includes("remove_attribution")

  return (
    <div>
      <PageHeader
        title="Paywall designer"
        subtitle="Pick a template + theme — the SDK renders this directly. Changes reach devices within the SDK's cache TTL (5 min by default)."
        badge={
          <Badge tone="info" dot>
            Live preview
          </Badge>
        }
      />
      {/* The gallery is a sibling page rather than a modal: applying a template rewrites the draft,
          which is a navigation-worthy action, and a URL makes it linkable from docs and support. */}
      <div className="mb-6">
        <Link href="/paywall/templates" className={linkClass}>
          Browse paywall templates →
        </Link>
        <Link href="/paywall/designer" className={`ml-2 ${linkClass}`}>
          Open tree editor →
        </Link>
        <Link href="/paywall/exit-survey" className={`ml-2 ${linkClass}`}>
          Exit survey →
        </Link>
        <Link href="/paywall/experiments" className={`ml-2 ${linkClass}`}>
          Experiments →
        </Link>
      </div>
      {failed ? (
        <LoadError what="the paywall" error={failed.error!} retry={() => queries.forEach((q) => q.isError && q.refetch())} />
      ) : pending ? (
        <LoadingCard label="Loading the paywall…" rows={6} />
      ) : (
        <PaywallDesigner
          initial={
            (paywallQuery.data as never) ?? {
              tenant_id: tenantId,
              template: "minimal",
              theme_jsonb: {},
              branding: "attribution",
              custom_footer: null,
              primary_color: "#7C3AED",
              font_family: "Inter",
              support_email: tenantQuery.data?.owner_email,
            }
          }
          products={(productsQuery.data ?? []) as never}
          canRemoveAttribution={canRemoveAttribution}
          plan={plan ?? "free"}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}

// ── /paywall/designer ────────────────────────────────────────────────────────

export function PaywallTreeView() {
  const paywallQuery = usePaywallRow()
  const invalidate = useInvalidatePaywall()
  const row = paywallQuery.data
  // The draft is what gets edited. A tenant who published before ever drafting still has something
  // worth opening, so the published tree is the fallback rather than an empty canvas.
  const initial = row?.workflow ?? row?.published_workflow ?? null

  return (
    <div>
      <PageHeader
        title="Paywall designer"
        subtitle="Edit the component tree the SDK renders. Saving writes your draft; publishing is what reaches devices."
        badge={
          <Badge tone="info" dot>
            Tree editor
          </Badge>
        }
      />
      {paywallQuery.isPending ? (
        <LoadingCard label="Loading the component tree…" rows={6} />
      ) : paywallQuery.isError ? (
        <LoadError what="the paywall" error={paywallQuery.error} retry={() => paywallQuery.refetch()} />
      ) : initial ? (
        <PaywallTreeEditor
          initialWorkflow={initial}
          initialRevision={row?.revision ?? null}
          publishedRevision={row?.published_revision ?? null}
          onSaved={invalidate}
        />
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          No component tree yet — pick one from{" "}
          <a className="underline" href="/paywall/templates">
            the template gallery
          </a>{" "}
          to start.
        </div>
      )}
    </div>
  )
}

// ── /paywall/templates ───────────────────────────────────────────────────────

export function PaywallTemplatesView() {
  const { supabase } = useDashboard()
  const paywallQuery = usePaywallRow()
  const invalidate = useInvalidatePaywall()
  const templatesQuery = useQuery({
    queryKey: ["paywall-templates"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("paywall_templates_list")
      if (error) throw new Error(error.message)
      return ((data as GalleryTemplate[]) ?? []) as GalleryTemplate[]
    },
  })
  // `workflow` is the DRAFT; a tenant who has published but never drafted still counts as having a
  // tree worth merging into, which is why both are considered.
  const row = paywallQuery.data
  const hasExistingTree = Boolean(row?.workflow ?? row?.published_workflow)
  const failed = templatesQuery.isError ? templatesQuery : paywallQuery.isError ? paywallQuery : null

  return (
    <div>
      <PageHeader
        title="Paywall templates"
        subtitle="Start from a template, or take a newer layout while keeping the wording you wrote. Applying writes your draft — publishing stays a separate, deliberate step."
        badge={
          <Badge tone="info" dot>
            Live previews
          </Badge>
        }
      />
      {failed ? (
        <LoadError what="templates" error={failed.error!} retry={() => failed.refetch()} />
      ) : templatesQuery.isPending || paywallQuery.isPending ? (
        <LoadingCard label="Loading templates…" rows={6} />
      ) : (
        <TemplateGallery
          templates={templatesQuery.data ?? []}
          hasExistingTree={hasExistingTree}
          currentRevision={row?.revision ?? null}
          onApplied={invalidate}
        />
      )}
    </div>
  )
}

// ── /paywall/exit-survey ─────────────────────────────────────────────────────

export function ExitSurveyView() {
  const { tenantId, supabase } = useDashboard()
  const queryClient = useQueryClient()
  const surveyQuery = useQuery({
    queryKey: ["exit-survey", tenantId],
    queryFn: async (): Promise<SurveyDraft> => {
      const { data, error } = await supabase
        .from("tenant_exit_survey")
        .select("enabled,title,reasons,survey_cap_days,offer_hours,exit_offer_enabled,exit_offer_coupon_id")
        .eq("tenant_id", tenantId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      // Every tenant has a row (migration 181 seeds it); the defaults cover a read that raced the seed.
      return data
        ? {
            enabled: data.enabled,
            title: data.title,
            reasons: data.reasons ?? DEFAULT_REASONS,
            survey_cap_days: data.survey_cap_days,
            offer_hours: data.offer_hours,
            exit_offer_enabled: data.exit_offer_enabled ?? true,
            exit_offer_coupon_id: data.exit_offer_coupon_id ?? null,
          }
        : { enabled: true, title: "Before you go — what stopped you?", reasons: DEFAULT_REASONS, survey_cap_days: 7, offer_hours: 48, exit_offer_enabled: true, exit_offer_coupon_id: null }
    },
  })
  // Same key + query as the Coupons page, so either page warms the other.
  const couponsQuery = useQuery({
    queryKey: ["coupons", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tenant_coupons_list", { p_tenant_id: tenantId })
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown[]
    },
  })
  const productCountQuery = useQuery({
    queryKey: ["products", "active-count", tenantId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("tenant_products")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("active", true)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })
  const queries = [surveyQuery, couponsQuery, productCountQuery]
  const failed = queries.find((q) => q.isError)

  return (
    <div>
      <PageHeader
        title="Exit survey"
        subtitle="Ask buyers who leave without paying why — and answer with a win-back discount or a message. Changes reach apps and your website within 5 minutes."
      />
      {failed ? (
        <LoadError what="the exit survey" error={failed.error!} retry={() => queries.forEach((q) => q.isError && q.refetch())} />
      ) : queries.some((q) => q.isPending) ? (
        <LoadingCard label="Loading the exit survey…" rows={5} />
      ) : (
        <ExitSurveyEditor
          initial={surveyQuery.data!}
          coupons={((couponsQuery.data ?? []) as (EditorCoupon & { active: boolean })[]).filter((c) => c.active)}
          productCount={productCountQuery.data ?? 0}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["exit-survey", tenantId] })}
        />
      )}
    </div>
  )
}

// ── /paywall/experiments ─────────────────────────────────────────────────────

export function ExperimentsView() {
  const { tenantId, supabase } = useDashboard()
  const queryClient = useQueryClient()
  const experimentsQuery = useQuery({
    queryKey: ["experiments", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paywall_experiments")
        .select("key,name,status,variants,started_at,stopped_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as Experiment[]
    },
  })
  const offeringsQuery = useQuery({
    queryKey: ["offerings", "active", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_offerings")
        .select("id,identifier,display_name,is_current,tenant_packages(active,tenant_products(sku,display_name,active,interval))")
        .eq("tenant_id", tenantId)
        .eq("active", true)
      if (error) throw new Error(error.message)
      // Each offering's active plans — what a variant can pre-select (migration 221).
      type Row = Omit<EditorOffering, "plans"> & {
        tenant_packages?: {
          active: boolean
          tenant_products?: { sku: string; display_name: string; active: boolean; interval: string | null }[]
        }[]
      }
      return ((data ?? []) as Row[]).map(({ tenant_packages, ...o }): EditorOffering => ({
        ...o,
        plans: (tenant_packages ?? []).filter((p) => p.active)
          .flatMap((p) => (p.tenant_products ?? []).filter((pr) => pr.active))
          .map(({ sku, display_name, interval }) => ({ sku, display_name, interval })),
      }))
    },
  })
  // Percent-off coupons + the tenant's exit-offer coupon: a variant's exit offer and the templates (227).
  const exitQuery = useQuery({
    queryKey: ["experiment-exit-offers", tenantId],
    queryFn: async () => {
      const [coupons, survey] = await Promise.all([
        supabase.from("tenant_coupons").select("id,code,percent_off,duration,duration_in_months")
          .eq("tenant_id", tenantId).eq("active", true).gt("percent_off", 0),
        supabase.from("tenant_exit_survey").select("exit_offer_enabled,exit_offer_coupon_id").eq("tenant_id", tenantId).maybeSingle(),
      ])
      if (coupons.error) throw new Error(coupons.error.message)
      return {
        coupons: (coupons.data ?? []) as ExperimentCoupon[],
        exitCouponId: survey.data?.exit_offer_enabled === false ? null : (survey.data?.exit_offer_coupon_id ?? null),
      }
    },
  })
  const failed = experimentsQuery.isError ? experimentsQuery : offeringsQuery.isError ? offeringsQuery
    : exitQuery.isError ? exitQuery : null

  return (
    <div>
      <PageHeader
        title="Experiments"
        subtitle="Test what your paywall sells and how: plans, the pre-selected plan, the exit offer and the design. Each device keeps its variant; make the winner your default in one click."
      />
      {failed ? (
        <LoadError what="experiments" error={failed.error!} retry={() => failed.refetch()} />
      ) : experimentsQuery.isPending || offeringsQuery.isPending || exitQuery.isPending ? (
        <LoadingCard label="Loading experiments…" />
      ) : (
        <ExperimentsEditor
          initial={experimentsQuery.data ?? []}
          offerings={offeringsQuery.data ?? []}
          coupons={exitQuery.data?.coupons ?? []}
          exitCouponId={exitQuery.data?.exitCouponId ?? null}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["experiments", tenantId] })}
        />
      )}
    </div>
  )
}
