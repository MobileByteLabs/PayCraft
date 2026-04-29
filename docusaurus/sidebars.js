/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'intro',
    'quick-start',
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'architecture',
        'concepts/provider-agnostic',
        'concepts/device-binding',
        'concepts/smart-sync',
        'concepts/webhook-flow',
      ],
    },
    {
      type: 'category',
      label: 'Platform Guides',
      items: [
        'platforms/android',
        'platforms/ios',
        'platforms/desktop',
        'platforms/web',
      ],
    },
    'providers',
    'customization',
    'security',
    'faq',
  ],
};

module.exports = sidebars;
