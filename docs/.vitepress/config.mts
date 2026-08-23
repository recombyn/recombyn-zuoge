import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Recombyn',
  description: 'Open-source canvas + AI Design Agent',
  lang: 'zh-CN',
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '介绍', link: '/' },
      { text: '计费', link: '/billing' },
      { text: '自托管', link: '/self-hosting' },
      { text: 'GitHub', link: 'https://github.com/recombyn/recombyn' },
    ],
    sidebar: [
      {
        text: '基础',
        items: [
          { text: '介绍', link: '/' },
          { text: '自托管', link: '/self-hosting' },
        ],
      },
      {
        text: '计费',
        items: [
          { text: 'Billing（开源计费）', link: '/billing' },
          { text: 'ADR 0025 Protocol', link: '/adr/0025-billing-protocol' },
          { text: 'ADR 0026 任务制', link: '/adr/0026-task-centric-billing' },
        ],
      },
      {
        text: '扩展',
        items: [
          { text: '插件包', link: '/plugin-packs' },
          { text: 'Skill 扩展', link: '/skill-extensions' },
          { text: '画布插件', link: '/canvas-plugins' },
        ],
      },
    ],
    outline: {
      label: '本页目录',
      level: [2, 3],
    },
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/recombyn/recombyn' },
    ],
  },
});
