import { defineCloudflareConfig } from "@opennextjs/cloudflare"
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache"

// Nothing revalidates (no ISR; /api/health's `revalidate = 0` only means "dynamic"), so the build output is the
// cache: prerendered pages are read from the Worker's static assets. No R2 / KV to provision — switch to the R2
// cache if a page ever gains `revalidate`. Same setup as mobilebytesensei-site.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
})
