resource "cloudflare_zone" "paycraft_cloud" {
  zone = "paycraft.cloud"
  plan = "free"
}

# Vercel production deployment
resource "cloudflare_record" "root" {
  zone_id = cloudflare_zone.paycraft_cloud.id
  name    = "@"
  type    = "A"
  value   = "76.76.21.21"
  proxied = true
}

resource "cloudflare_record" "www_cname" {
  zone_id = cloudflare_zone.paycraft_cloud.id
  name    = "www"
  type    = "CNAME"
  value   = "paycraft.cloud"
  proxied = true
}

# Supabase API endpoint
resource "cloudflare_record" "api" {
  zone_id = cloudflare_zone.paycraft_cloud.id
  name    = "api"
  type    = "CNAME"
  value   = "${var.supabase_project_ref}.supabase.co"
  proxied = false
}

# MX for transactional email (Postmark)
resource "cloudflare_record" "mx" {
  zone_id  = cloudflare_zone.paycraft_cloud.id
  name     = "@"
  type     = "MX"
  priority = 10
  value    = "smtp.postmarkapp.com"
}

# SPF for Postmark
resource "cloudflare_record" "spf" {
  zone_id = cloudflare_zone.paycraft_cloud.id
  name    = "@"
  type    = "TXT"
  value   = "v=spf1 a mx include:spf.mtasv.net ~all"
}

# Cloudflare Rate Limiting on /v2/* edge functions
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = cloudflare_zone.paycraft_cloud.id
  name    = "paycraft-rate-limit"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules {
    action = "block"
    ratelimit {
      characteristics        = ["cf.colo.id", "ip.src"]
      period                 = 60
      requests_per_period    = 100
      mitigation_timeout     = 60
    }
    expression  = "(http.request.uri.path matches \"^/functions/v1/v2-\")"
    description = "Rate limit PayCraft v2 API endpoints"
    enabled     = true
  }
}
