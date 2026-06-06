terraform {
  required_version = ">= 1.3"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
  backend "local" {}
}

variable "cloudflare_token" {
  sensitive   = true
  description = "Cloudflare API token with Zone:DNS:Edit permission"
}

variable "supabase_project_ref" {
  description = "Supabase production project reference (e.g. ssuxufoxnjdyqcyfrfev)"
}

provider "cloudflare" {
  api_token = var.cloudflare_token
}
