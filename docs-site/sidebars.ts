// docs-site/sidebars.ts
//
// Phase 2 T3 of paycraft-v2-production-readiness — sidebar config for the
// public docs site. Curated order: getting-started → integration → operations
// → legal/compliance → reference. Files NOT listed here will still resolve at
// /<doc-id> but won't show in the sidebar — so the sidebar is also a curation
// gate against accidentally exposing internal-only docs.

import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  main: [
    {
      type: 'category',
      label: 'Getting started',
      collapsed: false,
      items: [
        'QUICK_START',
        'CUSTOMIZATION',
      ],
    },
    {
      type: 'category',
      label: 'Integration',
      items: [
        'REELS_DOWNLOADER_INTEGRATION',
        'CLAUDE_SKILLS',
      ],
    },
    {
      type: 'category',
      label: 'Production operations',
      items: [
        'PRODUCTION_LAUNCH_RUNBOOK',
        'STRIPE_ACTIVATION',
        'PAYCRAFT_AS_TENANT_ONE',
        'DR_RUNBOOK',
        'INCIDENT_SIMULATION',
        'SLA_DASHBOARD',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'ARCHITECTURE',
        'MIGRATION_V2',
      ],
    },
    {
      type: 'category',
      label: 'Legal & compliance',
      items: [
        'PCI_SCOPE',
      ],
    },
    'FAQ',
  ],
}

export default sidebars
