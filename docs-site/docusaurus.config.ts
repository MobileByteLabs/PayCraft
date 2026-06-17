// docs-site/docusaurus.config.ts
//
// Phase 2 T3 of paycraft-v2-production-readiness — Docusaurus config for the
// public docs site that will be served at https://docs.paycraft.mobilebytesensei.com
// after DNS CNAME + Cloudflare Pages deploy (Phase 2 T4-T6).
//
// Source of truth for content: the existing docs/*.md tree at the PayCraft
// repo root — Docusaurus treats `../docs/` as its `docs/` directory so we
// don't duplicate or fork content.

import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const SITE_URL = 'https://docs.paycraft.mobilebytesensei.com'
const GITHUB_REPO = 'https://github.com/MobileByteLabs/PayCraft'

const config: Config = {
  title: 'PayCraft',
  tagline: 'Multi-provider billing infrastructure for KMP apps',
  favicon: 'img/favicon.svg',

  url: SITE_URL,
  baseUrl: '/',

  organizationName: 'MobileByteLabs',
  projectName: 'PayCraft',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          // Read from the repo-root docs/ tree — no content duplication.
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: `${GITHUB_REPO}/tree/main/docs/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'PayCraft',
      logo: {
        alt: 'PayCraft',
        src: 'img/logo.svg',
      },
      items: [
        { type: 'docSidebar', sidebarId: 'main', position: 'left', label: 'Docs' },
        { to: '/REELS_DOWNLOADER_INTEGRATION', label: 'Case study', position: 'left' },
        { href: 'https://paycraft.mobilebytesensei.com', label: 'Dashboard ↗', position: 'right' },
        { href: GITHUB_REPO, label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Product',
          items: [
            { label: 'Dashboard', href: 'https://paycraft.mobilebytesensei.com' },
            { label: 'Pricing', href: 'https://paycraft.mobilebytesensei.com/pricing' },
            { label: 'Status', href: 'https://status.paycraft.mobilebytesensei.com' },
          ],
        },
        {
          title: 'Resources',
          items: [
            { label: 'Quick start', to: '/QUICK_START' },
            { label: 'Case study', to: '/REELS_DOWNLOADER_INTEGRATION' },
            { label: 'PCI scope', to: '/PCI_SCOPE' },
            { label: 'DR runbook', to: '/DR_RUNBOOK' },
          ],
        },
        {
          title: 'Legal',
          items: [
            { label: 'Terms', href: 'https://paycraft.mobilebytesensei.com/legal/terms' },
            { label: 'Privacy', href: 'https://paycraft.mobilebytesensei.com/legal/privacy' },
            { label: 'DPA', href: 'https://paycraft.mobilebytesensei.com/legal/dpa' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} MobileByteSensei Pvt Ltd. Apache-2.0.`,
    },
  } satisfies Preset.ThemeConfig,
}

export default config
