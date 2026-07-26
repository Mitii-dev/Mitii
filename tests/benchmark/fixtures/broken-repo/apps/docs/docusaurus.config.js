module.exports = {
  title: 'Reservation System',
  tagline: 'A reservation system with database integration',
  url: 'https://your-domain.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'example', // Usually your GitHub org/user name.
  projectName: 'reservation-app', // Usually your repo name.
  themeConfig: {
    navbar: {
      title: 'Reservation System',
      items: [
        {
          type: 'doc',
          docId: 'index',
          position: 'left',
          label: 'Documentation',
        },
        {
          type: 'github',
          href: 'https://github.com/example/reservation-app',
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
            {
              label: 'Documentation',
              to: '/docs/',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/example/reservation-app',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Reservation System. Built with Docusaurus.`,
    },
  },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebar.js'),
          // Please change this to your repo.
          editUrl:
            'https://github.com/example/reservation-app/edit/main/apps/docs/',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
};