// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'PayCraft',
  tagline: 'Craft your own billing. Any provider. Any platform.',
  favicon: 'img/favicon.ico',

  url: 'https://mobilebytelabs.github.io',
  baseUrl: '/PayCraft/',

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
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/MobileByteLabs/PayCraft/tree/main/docusaurus/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'PayCraft',
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docs',
            position: 'left',
            label: 'Docs',
          },
          {
            href: 'https://github.com/MobileByteLabs/PayCraft',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Quick Start', to: '/docs/quick-start' },
              { label: 'Architecture', to: '/docs/architecture' },
              { label: 'Providers', to: '/docs/providers' },
            ],
          },
          {
            title: 'Community',
            items: [
              { label: 'GitHub', href: 'https://github.com/MobileByteLabs/PayCraft' },
              { label: 'Issues', href: 'https://github.com/MobileByteLabs/PayCraft/issues' },
            ],
          },
        ],
        copyright: `Copyright ${new Date().getFullYear()} MobileByteLabs. Built with Docusaurus.`,
      },
      prism: {
        theme: require('prism-react-renderer').themes.github,
        darkTheme: require('prism-react-renderer').themes.dracula,
        additionalLanguages: ['kotlin', 'bash', 'sql', 'typescript'],
      },
    }),
};

module.exports = config;
