export interface Creator {
  id: string;
  screen_name: string;
  name: string;
  avatar_url: string;
  cover_url?: string;
  followers_count: number;
  description: string;
  verified: number | boolean;
  backed_up_at?: string;
  is_blocked?: number;
  is_suspended?: number;
  clicks_card?: number;
  clicks_timeline?: number;
  clicks_roulette?: number;
  total_clicks?: number;
  last_synced_at?: string;
  category?: string;
  history?: Array<{
    date: string;
    type: string;
    desc: string;
  }>;
}
