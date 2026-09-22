export interface NavBaseItem {
  id: string;
  title: string;
  url: string;
  description: string;
  category: string;
  subcategory?: string;
  tags: string[];
  is_featured?: boolean;
  is_nsfw?: boolean;
  is_alive?: boolean;
  mirror_urls?: string[];
  feed_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface NavWebsite extends NavBaseItem {
  icon?: string;
  pricing?: 'free' | 'freemium' | 'paid' | 'open_source';
  platform?: string[];
}

export interface NavGithub extends NavBaseItem {
  repo: string; // e.g. "clash-verge-rev/clash-verge-rev"
  owner: string;
  name: string;
  language?: string;
  stars: number;
  forks?: number;
  last_commit?: string;
  license?: string;
  avatar_url?: string;
}

export type TelegramType = 'channel' | 'group' | 'bot';

export interface NavTelegram extends NavBaseItem {
  username: string; // e.g. "huarunying"
  type: TelegramType;
  member_count?: number;
  avatar_url?: string;
  bot_commands?: string[];
}

export type SocialPlatform = 'x' | 'youtube' | 'tiktok' | 'bilibili' | 'github' | 'other';

export interface NavSocialCreator extends NavBaseItem {
  platform: SocialPlatform;
  handle: string; // e.g. "@username"
  name: string;
  avatar_url?: string;
  followers_count?: number;
  field?: string; // e.g. "AI 研究 / 开发 / 出海"
  featured_links?: Array<{
    title: string;
    url: string;
  }>;
}

export interface NavCategory {
  id: string;
  name: string;
  icon: string; // emoji or svg name
  description?: string;
  badge?: string;
  subcategories?: Array<{
    id: string;
    name: string;
    icon?: string;
  }>;
}

export type AnyNavItem =
  | (NavWebsite & { item_type: 'website' })
  | (NavGithub & { item_type: 'github' })
  | (NavTelegram & { item_type: 'telegram' })
  | (NavSocialCreator & { item_type: 'creator' });
