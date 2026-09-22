export interface SiteConfig {
  name: string;
  title: string;
  subTitle: string;
  description: string;
  keywords: string;
  author: string;
  githubUrl: string;
  telegramUrl?: string;
  enableCreators: boolean;
  enableGithubMatrix: boolean;
  enableTelegramHub: boolean;
}

export const siteConfig: SiteConfig = {
  name: 'SparkNav',
  title: '极客智汇导航 · 全网优质资源与开源矩阵',
  subTitle: 'Modern Cyberpunk Geek Navigation Hub',
  description: '全网优质资源精选导航：深度收录优质工具网站、GitHub开源高星项目、Telegram精选频道机器人及全球技术创作者。',
  keywords: '开源导航, 极客导航, GitHub开源项目, Telegram频道, 开发工具, AI应用, 技术博客',
  author: 'SparkNav Team',
  githubUrl: 'https://github.com/kaiden694/spark-nav',
  telegramUrl: 'https://t.me/your_channel',
  enableCreators: true,
  enableGithubMatrix: true,
  enableTelegramHub: true,
};
