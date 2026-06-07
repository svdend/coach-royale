import { supabase } from './supabase';

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  primary_player_tag: string | null;
  subscription_tier: 'free' | 'pro';
  subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, username, display_name, avatar_url, primary_player_tag, subscription_tier, subscription_id, created_at, updated_at',
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as Profile | null;
}
