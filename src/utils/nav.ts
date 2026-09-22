import categoriesData from '../data/nav/categories.json';
import websitesData from '../data/nav/websites.json';
import githubData from '../data/nav/github.json';
import telegramData from '../data/nav/telegram.json';
import creatorsData from '../data/nav/creators.json';
import type {
  NavCategory,
  NavWebsite,
  NavGithub,
  NavTelegram,
  NavSocialCreator,
  AnyNavItem
} from '../types/nav';

export const navCategories: NavCategory[] = categoriesData as NavCategory[];
export const navWebsites: NavWebsite[] = websitesData as NavWebsite[];
export const navGithubs: NavGithub[] = githubData as NavGithub[];
export const navTelegrams: NavTelegram[] = telegramData as NavTelegram[];
export const navCreators: NavSocialCreator[] = creatorsData as NavSocialCreator[];

export function getAllNavItems(): AnyNavItem[] {
  const items: AnyNavItem[] = [
    ...navWebsites.map(item => ({ ...item, item_type: 'website' as const })),
    ...navGithubs.map(item => ({ ...item, item_type: 'github' as const })),
    ...navTelegrams.map(item => ({ ...item, item_type: 'telegram' as const })),
    ...navCreators.map(item => ({ ...item, item_type: 'creator' as const }))
  ];
  return items;
}

export function getFeaturedNavItems(): AnyNavItem[] {
  return getAllNavItems().filter(item => item.is_featured);
}

export function getRandomNavPool(limit: number = 60): AnyNavItem[] {
  const all = getAllNavItems();
  // Shuffle array using Fisher-Yates
  const shuffled = [...all];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, limit);
}

export function isRecentItem(createdAt?: string, days: number = 2): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (isNaN(created)) return false;
  const diffDays = (Date.now() - created) / (1000 * 60 * 60 * 24);
  return diffDays >= -0.5 && diffDays <= days;
}

export function sortNavItemsByFreshness<T extends { created_at?: string; is_featured?: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    // 1. 最新入库日期优先 (created_at 倒序)
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeA !== timeB) return timeB - timeA;

    // 2. 同一天内精选优先
    const featA = a.is_featured ? 1 : 0;
    const featB = b.is_featured ? 1 : 0;
    if (featA !== featB) return featB - featA;

    return 0;
  });
}

